const crypto = require("node:crypto");
const { promisify } = require("node:util");
const fs = require("node:fs");
const path = require("node:path");
const express = require("express");
const db = require("./db");
const { encrypt, decrypt, sha256 } = require("./crypto");
const { fail } = require("./calendarNetwork");
const scrypt = promisify(crypto.scrypt);
const SESSION_MS = 30 * 86400000;
const attempts = new Map();
const setupPath = path.join(db.dataDir, "admin-setup-token");
const defaults = { mail: true, calendar: true, files: true };
let hashing = 0;
async function derive(password, salt) {
  if (hashing >= 4) throw fail("multiuser.rate", 429);
  hashing++;
  try {
    return await scrypt(password, salt, 64, {
      N: 131072,
      r: 8,
      p: 1,
      maxmem: 268435456,
    });
  } finally {
    hashing--;
  }
}

async function hashPassword(password) {
  if (
    typeof password !== "string" ||
    password.length < 12 ||
    password.length > 256
  )
    throw fail("multiuser.passwordLength", 400);
  const salt = crypto.randomBytes(16).toString("hex");
  const value = await derive(password, salt);
  return `scrypt$${salt}$${value.toString("hex")}`;
}
async function verifyPassword(password, encoded) {
  if (typeof password !== "string" || password.length > 256) return false;
  const [algorithm, salt, hash] = String(encoded).split("$");
  if (algorithm !== "scrypt" || !salt || !/^[a-f0-9]{128}$/.test(hash || ""))
    return false;
  const result = await derive(password, salt);
  return crypto.timingSafeEqual(result, Buffer.from(hash, "hex"));
}
function publicUser(row) {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    status: row.status,
    permissions: { ...defaults, ...JSON.parse(row.permissions) },
  };
}
async function init() {
  await db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name TEXT NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('admin','user')),
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('active','pending','disabled')),
    permissions TEXT NOT NULL DEFAULT '{}', workspace_id INTEGER NOT NULL UNIQUE REFERENCES mail_accounts(id), created_at INTEGER NOT NULL)`);
  const columns = await db.all("PRAGMA table_info(sessions)");
  if (!columns.some((c) => c.name === "user_id")) {
    await db.run("DELETE FROM sessions");
    await db.run(
      "ALTER TABLE sessions ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE",
    );
  }
  await db.run(
    "CREATE TABLE IF NOT EXISTS user_groups(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL UNIQUE)",
  );
  await db.run(
    "CREATE TABLE IF NOT EXISTS user_group_members(group_id INTEGER NOT NULL REFERENCES user_groups(id) ON DELETE CASCADE,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,PRIMARY KEY(group_id,user_id))",
  );
  await db.run(
    "CREATE TABLE IF NOT EXISTS system_settings(key TEXT PRIMARY KEY,value TEXT NOT NULL)",
  );
  if (
    !(await db.get("SELECT id FROM users LIMIT 1")) &&
    !fs.existsSync(setupPath)
  ) {
    fs.writeFileSync(setupPath, crypto.randomBytes(24).toString("hex"), {
      mode: 0o600,
      flag: "wx",
    });
    console.info(
      "post. 2.0: Administrator-Einrichtung: Code in /app/data/admin-setup-token (DATA_DIR/admin-setup-token).",
    );
  }
  await require("./mailOAuth").init();
  await require("./fileAcl").init();
}
async function session(user) {
  const token = crypto.randomBytes(32).toString("hex");
  const { current, account } = await db.transaction(async (run, query) => {
    const current = (
      await query(
        "SELECT * FROM users WHERE id=? AND status='active' AND password_hash=?",
        [user.id, user.password_hash],
      )
    )[0];
    if (!current) throw fail("multiuser.loginFailed", 401);
    await run(
      "INSERT INTO sessions(token_hash,account_id,expires_at,user_id) VALUES(?,?,?,?)",
      [
        sha256(token),
        current.workspace_id,
        Date.now() + SESSION_MS,
        current.id,
      ],
    );
    return {
      current,
      account: (
        await query("SELECT * FROM mail_accounts WHERE id=?", [
          current.workspace_id,
        ])
      )[0],
    };
  });
  return {
    token,
    account: {
      ...publicUser(current),
      hasMail: !!account.imap_host,
      mailEmail: account.imap_host ? account.email : "",
    },
  };
}
function limiter(req, res, next) {
  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body))
    return res.status(400).json({ error: "multiuser.input" });
  const now = Date.now(),
    ip = req.socket.remoteAddress || "unknown";
  const key =
    ip +
    ":" +
    String(req.body.email || "")
      .toLowerCase()
      .slice(0, 254);
  for (const k of [ip, key]) {
    const list = (attempts.get(k) || []).filter((t) => t > now - 600000);
    if (list.length >= (k === ip ? 40 : 10))
      return res.status(429).json({ error: "multiuser.rate" });
    list.push(now);
    attempts.set(k, list);
  }
  if (attempts.size > 10000)
    for (const [k, v] of attempts)
      if (v.at(-1) < now - 600000) attempts.delete(k);
  next();
}
async function auth(req, res, next) {
  try {
    const token = (req.headers.authorization || "").replace(/^Bearer /, "");
    const row =
      token &&
      (await db.get(
        "SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND s.account_id=u.workspace_id AND u.status='active'",
        [sha256(token), Date.now()],
      ));
    if (!row) return res.status(401).json({ error: "Unauthorized" });
    req.user = publicUser(row);
    req.account = await db.get("SELECT * FROM mail_accounts WHERE id=?", [
      row.workspace_id,
    ]);
    req.account.display_name = row.name;
    req.account.password = req.account.password_enc
      ? decrypt(req.account.password_enc)
      : "";
    req.tokenHash = sha256(token);
    const feature = /^\/api\/(files|office)(\/|$)/.test(req.originalUrl)
      ? "files"
      : /^\/api\/calendar(\/|$)/.test(req.originalUrl)
        ? "calendar"
        : /^\/api\/(folders|messages|message|send|search|poll|attachment|source|draft)(\/|\?|$)/.test(
              req.originalUrl,
            )
          ? "mail"
          : "";
    if (feature && !req.user.permissions[feature])
      throw fail("multiuser.forbidden", 403);
    if (
      req.originalUrl.split("?")[0] === "/api/attachment/save" &&
      !req.user.permissions.files
    )
      throw fail("multiuser.forbidden", 403);
    if (feature === "mail" && !req.account.imap_host)
      throw fail("multiuser.noMail", 409);
    if (feature === "mail" && req.account.password.startsWith("oauth:")) {
      req.account.accessToken = await require("./mailOAuth").access(
        req.account,
      );
      req.account.display_name = row.name;
      req.account.password = "";
    }
    next();
  } catch (e) {
    next(e);
  }
}
function admin(req, res, next) {
  if (req.user.role !== "admin")
    return res.status(403).json({ error: "multiuser.forbidden" });
  next();
}
function router(wrap) {
  const router = express.Router();
  router.get(
    "/auth/status",
    wrap(async (req, res) => {
      const setup = !(await db.get("SELECT id FROM users LIMIT 1"));
      const registration =
        (
          await db.get(
            "SELECT value FROM system_settings WHERE key='registration'",
          )
        )?.value !== "closed";
      res.json({ setup, registration });
    }),
  );
  router.post(
    "/register",
    limiter,
    wrap(async (req, res) => {
      const email = String(req.body.email || "")
        .trim()
        .toLowerCase();
      const name = String(req.body.name || "")
        .trim()
        .slice(0, 100);
      if (
        !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ||
        email.length > 254 ||
        !name
      )
        throw fail("multiuser.input");
      const passwordHash = await hashPassword(req.body.password);
      const user = await db.transaction(async (run, query) => {
        const first = !(await query("SELECT id FROM users LIMIT 1")).length;
        if (first) {
          const expected = fs.readFileSync(setupPath, "utf8").trim();
          if (sha256(String(req.body.setupToken || "")) !== sha256(expected))
            throw fail("multiuser.setupInvalid", 403);
        } else if (
          (
            await query(
              "SELECT value FROM system_settings WHERE key='registration'",
            )
          )[0]?.value === "closed"
        )
          throw fail("multiuser.registrationClosed", 403);
        if ((await query("SELECT id FROM users WHERE email=?", [email])).length)
          throw fail("multiuser.registrationFailed", 409);
        const workspace = await run(
          "INSERT INTO mail_accounts(email,password_enc,imap_host,imap_port,imap_secure,imap_user,smtp_host,smtp_port,smtp_secure,smtp_user,created_at) VALUES(?,'','',993,1,'','',465,1,'',?)",
          [crypto.randomUUID() + "@post.internal", Date.now()],
        );
        const created = await run(
          "INSERT INTO users(email,name,password_hash,role,status,workspace_id,created_at) VALUES(?,?,?,?,?,?,?)",
          [
            email,
            name,
            passwordHash,
            first ? "admin" : "user",
            first ? "active" : "pending",
            workspace.lastID,
            Date.now(),
          ],
        );
        return (
          await query("SELECT * FROM users WHERE id=?", [created.lastID])
        )[0];
      });
      if (user.role === "admin") fs.rmSync(setupPath, { force: true });
      res
        .status(201)
        .json(
          user.status === "active" ? await session(user) : { pending: true },
        );
    }),
  );
  router.post(
    "/login",
    limiter,
    wrap(async (req, res) => {
      const user = await db.get("SELECT * FROM users WHERE email=?", [
        String(req.body.email || "")
          .trim()
          .toLowerCase(),
      ]);
      const valid = await verifyPassword(
        req.body.password,
        user?.password_hash ||
          `scrypt$00000000000000000000000000000000$${"0".repeat(128)}`,
      );
      if (!valid || !user || user.status !== "active")
        throw fail("multiuser.loginFailed", 401);
      res.json(await session(user));
    }),
  );
  router.get("/me", auth, (req, res) =>
    res.json({
      ...req.user,
      hasMail: !!req.account.imap_host,
      mailEmail: req.account.imap_host ? req.account.email : "",
    }),
  );
  router.post(
    "/account/password",
    auth,
    limiter,
    wrap(async (req, res) => {
      const user = await db.get("SELECT password_hash FROM users WHERE id=?", [
        req.user.id,
      ]);
      if (!(await verifyPassword(req.body.currentPassword, user.password_hash)))
        throw fail("multiuser.loginFailed", 403);
      const updated = await hashPassword(req.body.password);
      await db.transaction(async (run) => {
        const changed = await run(
          "UPDATE users SET password_hash=? WHERE id=? AND password_hash=? AND status='active'",
          [updated, req.user.id, user.password_hash],
        );
        if (changed.changes !== 1) throw fail("multiuser.loginFailed", 409);
        await run("DELETE FROM sessions WHERE user_id=? AND token_hash<>?", [
          req.user.id,
          req.tokenHash,
        ]);
      });
      res.json({ success: true });
    }),
  );
  router.get(
    "/directory",
    auth,
    wrap(async (req, res) =>
      res.json({
        users: await db.all(
          "SELECT id,name,email FROM users WHERE status='active' ORDER BY name",
        ),
        groups: await db.all("SELECT id,name FROM user_groups ORDER BY name"),
      }),
    ),
  );
  router.use("/admin", auth, admin);
  router.get(
    "/admin",
    wrap(async (req, res) =>
      res.json({
        users: (await db.all("SELECT * FROM users ORDER BY id")).map(
          publicUser,
        ),
        groups: await db.all(
          "SELECT g.*, COALESCE((SELECT json_group_array(user_id) FROM user_group_members WHERE group_id=g.id),'[]') members FROM user_groups g ORDER BY name",
        ),
        registration:
          (
            await db.get(
              "SELECT value FROM system_settings WHERE key='registration'",
            )
          )?.value !== "closed",
      }),
    ),
  );
  router.put(
    "/admin/registration",
    wrap(async (req, res) => {
      await db.run(
        "INSERT INTO system_settings VALUES('registration',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        [req.body.enabled === true ? "open" : "closed"],
      );
      res.json({ success: true });
    }),
  );
  router.patch(
    "/admin/users/:id",
    wrap(async (req, res) => {
      const id = Number(req.params.id);
      if (
        !["admin", "user"].includes(req.body.role) ||
        !["active", "disabled", "pending"].includes(req.body.status)
      )
        throw fail("multiuser.input");
      const permissions = Object.fromEntries(
        Object.keys(defaults).map((k) => [
          k,
          req.body.permissions?.[k] !== false,
        ]),
      );
      await db.transaction(async (run, query) => {
        const user = (await query("SELECT * FROM users WHERE id=?", [id]))[0];
        if (!user) throw fail("multiuser.input", 404);
        if (
          user.role === "admin" &&
          user.status === "active" &&
          (req.body.role !== "admin" || req.body.status !== "active") &&
          (
            await query(
              "SELECT id FROM users WHERE role='admin' AND status='active'",
            )
          ).length < 2
        )
          throw fail("multiuser.lastAdmin", 409);
        await run("UPDATE users SET role=?,status=?,permissions=? WHERE id=?", [
          req.body.role,
          req.body.status,
          JSON.stringify(permissions),
          id,
        ]);
        await run("DELETE FROM sessions WHERE user_id=?", [id]);
      });
      res.json({ success: true });
    }),
  );
  router.post(
    "/admin/groups",
    wrap(async (req, res) => {
      const name = String(req.body.name || "").trim();
      if (!name || name.length > 100) throw fail("multiuser.input");
      try {
        const row = await db.run("INSERT INTO user_groups(name) VALUES(?)", [
          name,
        ]);
        res.json({ id: row.lastID, name });
      } catch (e) {
        if (e.code?.startsWith("SQLITE_CONSTRAINT"))
          throw fail("multiuser.input", 409);
        throw e;
      }
    }),
  );
  router.delete(
    "/admin/users/:id",
    wrap(async (req, res) => {
      const id = Number(req.params.id);
      if (req.body.confirm !== true || id === req.user.id)
        throw fail("multiuser.input");
      const blobs = await db.transaction(async (run, query) => {
        const user = (await query("SELECT * FROM users WHERE id=?", [id]))[0];
        if (!user) throw fail("multiuser.input", 404);
        if (
          user.role === "admin" &&
          user.status === "active" &&
          (
            await query(
              "SELECT id FROM users WHERE role='admin' AND status='active'",
            )
          ).length < 2
        )
          throw fail("multiuser.lastAdmin", 409);
        const rows = await query(
          "SELECT blob_id id FROM file_nodes WHERE account_id=? AND blob_id IS NOT NULL UNION SELECT id FROM file_uploads WHERE account_id=?",
          [user.workspace_id, user.workspace_id],
        );
        await run("DELETE FROM users WHERE id=?", [id]);
        await run("DELETE FROM mail_accounts WHERE id=?", [user.workspace_id]);
        return rows;
      });
      for (const blob of blobs) {
        if (
          !(await db.get("SELECT id FROM file_nodes WHERE blob_id=?", [
            blob.id,
          ]))
        )
          await require("node:fs/promises")
            .rm(require("./filesStorage").blobPath(blob.id), { force: true })
            .catch(() => {});
      }
      res.json({ success: true });
    }),
  );
  router.put(
    "/admin/groups/:id",
    wrap(async (req, res) => {
      if (!Array.isArray(req.body.members)) throw fail("multiuser.input");
      const ids = [...new Set(req.body.members)];
      if (ids.length > 1000 || !ids.every(Number.isSafeInteger))
        throw fail("multiuser.input");
      await db.transaction(async (run, query) => {
        if (
          !(
            await query("SELECT id FROM user_groups WHERE id=?", [
              req.params.id,
            ])
          ).length
        )
          throw fail("multiuser.input", 404);
        await run("DELETE FROM user_group_members WHERE group_id=?", [
          req.params.id,
        ]);
        for (const id of ids)
          await run("INSERT INTO user_group_members VALUES(?,?)", [
            req.params.id,
            id,
          ]);
      });
      res.json({ success: true });
    }),
  );
  router.delete(
    "/admin/groups/:id",
    wrap(async (req, res) => {
      await db.run("DELETE FROM user_groups WHERE id=?", [req.params.id]);
      res.json({ success: true });
    }),
  );
  return router;
}
module.exports = {
  init,
  auth,
  router,
  hashPassword,
  verifyPassword,
  publicUser,
  limiter,
};
