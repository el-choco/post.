const crypto = require("node:crypto");
const express = require("express");
const db = require("./db");
const calendar = require("./calendarOAuth");
const network = require("./filesNetwork");
const { encrypt, decrypt, sha256 } = require("./crypto");
const { fail } = require("./calendarNetwork");
const { invalidate } = require("./cache");
const refreshing = new Map();
async function init() {
  await db.run(
    "CREATE TABLE IF NOT EXISTS mail_oauth_configs(account_id INTEGER NOT NULL REFERENCES mail_accounts(id) ON DELETE CASCADE,provider TEXT NOT NULL,config_enc TEXT NOT NULL,PRIMARY KEY(account_id,provider))",
  );
  await db.run(
    "CREATE TABLE IF NOT EXISTS mail_oauth_tokens(account_id INTEGER PRIMARY KEY REFERENCES mail_accounts(id) ON DELETE CASCADE,provider TEXT NOT NULL,credentials_enc TEXT NOT NULL)",
  );
  await db.run(
    "CREATE TABLE IF NOT EXISTS mail_oauth_states(state_hash TEXT PRIMARY KEY,account_id INTEGER NOT NULL,session_hash TEXT NOT NULL,provider TEXT NOT NULL,verifier TEXT NOT NULL,expires_at INTEGER NOT NULL,config_enc TEXT NOT NULL,email TEXT NOT NULL)",
  );
  await db.run("DELETE FROM mail_oauth_states WHERE expires_at<?", [
    Date.now(),
  ]);
}
async function load(provider, id) {
  const row = await db.get(
    "SELECT config_enc FROM mail_oauth_configs WHERE account_id=? AND provider=?",
    [id, provider],
  );
  return row
    ? JSON.parse(decrypt(row.config_enc))
    : calendar.load(provider, id);
}
function config(provider, profile) {
  const result = calendar.config(provider, profile);
  result.redirectUri =
    profile.baseUrl + "/api/mail/oauth/" + provider + "/callback";
  result.scope =
    provider === "google"
      ? "https://mail.google.com/"
      : "offline_access https://outlook.office.com/IMAP.AccessAsUser.All https://outlook.office.com/SMTP.Send";
  return result;
}
async function settings(id) {
  const result = { oauthSetup: {} };
  for (const provider of ["google", "microsoft"]) {
    const value = await load(provider, id);
    try {
      config(provider, value);
      result[provider] = true;
    } catch {
      result[provider] = false;
    }
    result.oauthSetup[provider] = {
      baseUrl: value.baseUrl,
      clientId: value.clientId,
      secretSaved: !!value.clientSecret,
      tenant: value.tenant,
    };
  }
  return result;
}
async function exchange(provider, profile, params) {
  const cfg = config(provider, profile);
  const data = await network.json(cfg.token, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      redirect_uri: cfg.redirectUri,
      ...params,
    }).toString(),
  });
  if (!data.access_token) throw fail("multiuser.reconnect", 502);
  return {
    ...data,
    expiresAt: Date.now() + Number(data.expires_in || 3600) * 1000,
    oauth: profile,
  };
}
async function access(account) {
  if (!refreshing.has(account.id))
    refreshing.set(
      account.id,
      (async () => {
        const row = await db.get(
          "SELECT * FROM mail_oauth_tokens WHERE account_id=?",
          [account.id],
        );
        if (!row) throw fail("multiuser.reconnect", 409);
        const data = JSON.parse(decrypt(row.credentials_enc));
        if (data.expiresAt > Date.now() + 60000) return data.access_token;
        if (!data.refresh_token) throw fail("multiuser.reconnect", 409);
        const updated = await exchange(row.provider, data.oauth, {
          grant_type: "refresh_token",
          refresh_token: data.refresh_token,
        });
        const merged = {
          ...data,
          ...updated,
          refresh_token: updated.refresh_token || data.refresh_token,
        };
        await db.run(
          "UPDATE mail_oauth_tokens SET credentials_enc=? WHERE account_id=? AND credentials_enc=?",
          [encrypt(JSON.stringify(merged)), account.id, row.credentials_enc],
        );
        return merged.access_token;
      })().finally(() => refreshing.delete(account.id)),
    );
  return refreshing.get(account.id);
}
async function attach(req, email, password, cfg, oauthTokens) {
  await db.transaction(async (run, query) => {
    const current = (
      await query(
        "SELECT workspace_id,permissions FROM users WHERE id=? AND status='active'",
        [req.user.id],
      )
    )[0];
    if (!current || current.workspace_id !== req.account.id)
      throw fail("multiuser.input", 409);
    if (JSON.parse(current.permissions).mail === false)
      throw fail("multiuser.forbidden", 403);
    if (
      !(
        await query(
          "SELECT token_hash FROM sessions WHERE token_hash=? AND user_id=? AND account_id=? AND expires_at>?",
          [req.tokenHash, req.user.id, req.account.id, Date.now()],
        )
      ).length
    )
      throw fail("multiuser.loginFailed", 403);
    const existing = (
      await query("SELECT id FROM mail_accounts WHERE email=?", [email])
    )[0];
    let id = req.account.id;
    if (existing && existing.id !== id) {
      if (
        (
          await query("SELECT id FROM users WHERE workspace_id=?", [
            existing.id,
          ])
        ).length
      )
        throw fail("multiuser.mailOwned", 409);
      for (const table of [
        "contacts",
        "file_nodes",
        "file_connections",
        "calendar_connections",
      ]) {
        if (
          (
            await query(`SELECT 1 FROM ${table} WHERE account_id=? LIMIT 1`, [
              id,
            ])
          ).length
        )
          throw fail("multiuser.migrationNotEmpty", 409);
      }
      if (
        (
          await query(
            "SELECT 1 FROM calendar_events e JOIN calendars c ON c.id=e.calendar_id WHERE c.account_id=? LIMIT 1",
            [id],
          )
        ).length
      )
        throw fail("multiuser.migrationNotEmpty", 409);
      for (const sql of [
        "SELECT 1 FROM address_books WHERE account_id=? AND is_default=0",
        "SELECT 1 FROM contact_groups WHERE account_id=?",
        "SELECT 1 FROM calendars WHERE account_id=? AND is_default=0",
        "SELECT 1 FROM file_uploads WHERE account_id=? AND state IN ('pending','committing','office')",
      ]) {
        if ((await query(sql, [id])).length)
          throw fail("multiuser.migrationNotEmpty", 409);
      }
      const configs = await query(
        "SELECT * FROM mail_oauth_configs WHERE account_id=?",
        [id],
      );
      for (const config of configs)
        await run("INSERT OR REPLACE INTO mail_oauth_configs VALUES(?,?,?)", [
          existing.id,
          config.provider,
          config.config_enc,
        ]);
      await run("UPDATE users SET workspace_id=? WHERE id=?", [
        existing.id,
        req.user.id,
      ]);
      await run("UPDATE sessions SET account_id=? WHERE user_id=?", [
        existing.id,
        req.user.id,
      ]);
      await run("DELETE FROM mail_accounts WHERE id=?", [id]);
      id = existing.id;
    }
    const previous = (
      await query("SELECT email,imap_host FROM mail_accounts WHERE id=?", [id])
    )[0];
    if (previous.imap_host && previous.email !== email)
      throw fail("multiuser.disconnectFirst", 409);
    await run(
      "UPDATE mail_accounts SET email=?,password_enc=?,imap_host=?,imap_port=?,imap_secure=?,imap_user=?,smtp_host=?,smtp_port=?,smtp_secure=?,smtp_user=? WHERE id=?",
      [
        email,
        encrypt(password),
        cfg.imap.host,
        cfg.imap.port,
        cfg.imap.secure ? 1 : 0,
        cfg.imap.user,
        cfg.smtp.host,
        cfg.smtp.port,
        cfg.smtp.secure ? 1 : 0,
        cfg.smtp.user,
        id,
      ],
    );
    if (oauthTokens)
      await run(
        "INSERT INTO mail_oauth_tokens VALUES(?,?,?) ON CONFLICT(account_id) DO UPDATE SET provider=excluded.provider,credentials_enc=excluded.credentials_enc",
        [id, oauthTokens.provider, encrypt(JSON.stringify(oauthTokens.tokens))],
      );
    else await run("DELETE FROM mail_oauth_tokens WHERE account_id=?", [id]);
    invalidate(id);
    invalidate(req.account.id);
  });
}
function router(auth, wrap) {
  const router = express.Router();
  router.get(
    "/oauth/:provider/callback",
    wrap(async (req, res) => {
      const state = String(req.query.state || ""),
        provider = req.params.provider;
      const cookie = String(req.headers.cookie || "")
        .split(";")
        .map((x) => x.trim())
        .find((x) => x.startsWith("post_mail_state="))
        ?.slice(16);
      if (!cookie || !state || sha256(cookie) !== sha256(state))
        throw fail("multiuser.oauthState", 400);
      const saved = await db.transaction(async (run, query) => {
        const rows = await query(
          "SELECT o.*,u.id user_id FROM mail_oauth_states o JOIN sessions s ON s.token_hash=o.session_hash JOIN users u ON u.id=s.user_id WHERE o.state_hash=? AND o.provider=? AND o.expires_at>? AND s.expires_at>? AND u.status='active' AND u.workspace_id=o.account_id AND s.account_id=o.account_id",
          [sha256(state), provider, Date.now(), Date.now()],
        );
        await run("DELETE FROM mail_oauth_states WHERE state_hash=?", [
          sha256(state),
        ]);
        return rows[0];
      });
      if (!saved) throw fail("multiuser.oauthState", 400);
      const profile = JSON.parse(decrypt(saved.config_enc));
      res.clearCookie("post_mail_state", {
        path: "/api/mail/oauth",
        httpOnly: true,
        sameSite: "lax",
        secure: profile.baseUrl.startsWith("https:"),
      });
      const redirect = (value) =>
        res.redirect(
          profile.baseUrl +
            "/?view=settings&settingsTab=account&mailResult=" +
            value,
        );
      if (req.query.error || !req.query.code) return redirect("denied");
      try {
        const tokens = await exchange(provider, profile, {
          grant_type: "authorization_code",
          code: String(req.query.code),
          code_verifier: saved.verifier,
        });
        const personal = /@(outlook|hotmail|live|msn)\.[a-z.]+$/.test(
          saved.email,
        );
        const cfg = {
          imap: {
            host:
              provider === "google"
                ? "imap.gmail.com"
                : "outlook.office365.com",
            port: 993,
            secure: true,
            user: saved.email,
          },
          smtp: {
            host:
              provider === "google"
                ? "smtp.gmail.com"
                : personal
                  ? "smtp-mail.outlook.com"
                  : "smtp.office365.com",
            port: 587,
            secure: false,
            user: saved.email,
          },
        };
        const client = require("./imap").makeClient({
          imap_host: cfg.imap.host,
          imap_port: 993,
          imap_secure: 1,
          imap_user: saved.email,
          accessToken: tokens.access_token,
        });
        try {
          await client.connect();
        } finally {
          client.close();
        }
        const account = await db.get("SELECT * FROM mail_accounts WHERE id=?", [
          saved.account_id,
        ]);
        await attach(
          {
            user: { id: saved.user_id },
            account,
            tokenHash: saved.session_hash,
          },
          saved.email,
          "oauth:" + provider,
          cfg,
          { provider, tokens },
        );
        return redirect("connected");
      } catch {
        return redirect("failed");
      }
    }),
  );
  router.use(auth);
  router.use((req, res, next) =>
    req.user.permissions.mail
      ? next()
      : res.status(403).json({ error: "multiuser.forbidden" }),
  );
  router.get(
    "/config",
    wrap(async (req, res) =>
      res.json({
        ...(await settings(req.account.id)),
        connected: !!req.account.imap_host,
        email: req.account.imap_host ? req.account.email : "",
        kind: req.account.password.startsWith("oauth:")
          ? req.account.password.slice(6)
          : "password",
      }),
    ),
  );
  router.post(
    "/connect",
    require("./identity").limiter,
    wrap(async (req, res) => {
      const email = String(req.body.email || "")
          .trim()
          .toLowerCase(),
        password = String(req.body.password || "");
      if (
        !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ||
        email.length > 254 ||
        !password ||
        password.length > 1000
      )
        throw fail("multiuser.input");
      let cfg;
      try {
        cfg = await require("./autodiscover").resolveAccount(email, password);
      } catch {
        throw fail("multiuser.oauthFailed", 502);
      }
      await attach(req, email, password, cfg);
      res.json({ success: true });
    }),
  );
  router.delete(
    "/connection",
    wrap(async (req, res) => {
      await db.run(
        "UPDATE mail_accounts SET email=?,imap_host='',smtp_host='',imap_user='',smtp_user='',password_enc='' WHERE id=?",
        [crypto.randomUUID() + "@post.internal", req.account.id],
      );
      await db.run("DELETE FROM mail_oauth_tokens WHERE account_id=?", [
        req.account.id,
      ]);
      await db.run("DELETE FROM mail_oauth_states WHERE account_id=?", [
        req.account.id,
      ]);
      await db.run("DELETE FROM local_drafts WHERE account_id=?", [
        req.account.id,
      ]);
      await db.run("DELETE FROM draft_refs WHERE account_id=?", [
        req.account.id,
      ]);
      invalidate(req.account.id);
      res.json({ success: true });
    }),
  );
  router.post(
    "/oauth/:provider/config",
    wrap(async (req, res) => {
      const provider = req.params.provider,
        old = await load(provider, req.account.id);
      const profile = calendar.validate(provider, {
        ...req.body,
        clientSecret:
          req.body.clientSecret ||
          (req.body.clientId === old.clientId ? old.clientSecret : ""),
      });
      await db.run(
        "INSERT INTO mail_oauth_configs VALUES(?,?,?) ON CONFLICT(account_id,provider) DO UPDATE SET config_enc=excluded.config_enc",
        [req.account.id, provider, encrypt(JSON.stringify(profile))],
      );
      res.json(await settings(req.account.id));
    }),
  );
  router.post(
    "/oauth/:provider/start",
    wrap(async (req, res) => {
      const provider = req.params.provider,
        profile = await load(provider, req.account.id),
        cfg = config(provider, profile);
      const email = String(req.body.email || "")
        .trim()
        .toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 254)
        throw fail("multiuser.input");
      if (req.headers.origin && req.headers.origin !== profile.baseUrl)
        throw fail("multiuser.oauthState", 403);
      const state = crypto.randomBytes(32).toString("hex"),
        verifier = crypto.randomBytes(48).toString("base64url");
      await db.run("DELETE FROM mail_oauth_states WHERE expires_at<?", [
        Date.now(),
      ]);
      await db.run("INSERT INTO mail_oauth_states VALUES(?,?,?,?,?,?,?,?)", [
        sha256(state),
        req.account.id,
        req.tokenHash,
        provider,
        verifier,
        Date.now() + 600000,
        encrypt(JSON.stringify(profile)),
        email,
      ]);
      const url = new URL(cfg.authorize);
      url.search = new URLSearchParams({
        client_id: cfg.clientId,
        redirect_uri: cfg.redirectUri,
        response_type: "code",
        scope: cfg.scope,
        state,
        login_hint: email,
        code_challenge: crypto
          .createHash("sha256")
          .update(verifier)
          .digest("base64url"),
        code_challenge_method: "S256",
        ...(provider === "google"
          ? { access_type: "offline", prompt: "consent" }
          : { response_mode: "query" }),
      });
      res.cookie("post_mail_state", state, {
        httpOnly: true,
        sameSite: "lax",
        secure: cfg.redirectUri.startsWith("https:"),
        path: "/api/mail/oauth",
        maxAge: 600000,
      });
      res.json({ url: url.href });
    }),
  );
  return router;
}
module.exports = { init, router, config, settings, access, attach };
