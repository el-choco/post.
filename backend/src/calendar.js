const express = require("express");
const crypto = require("node:crypto");
const db = require("./db");
const { encrypt, decrypt, sha256 } = require("./crypto");
const oauth = require("./calendarOAuth");
const providers = require("./calendarProviders");
const ics = require("./calendarIcs");
const { calendarUrl, fail } = require("./calendarNetwork");

async function initCalendar() {
  await db.run(`CREATE TABLE IF NOT EXISTS calendar_connections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,account_id INTEGER NOT NULL REFERENCES mail_accounts(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,name TEXT NOT NULL,url TEXT NOT NULL DEFAULT '',credentials_enc TEXT NOT NULL)`);
  await db.run(`CREATE TABLE IF NOT EXISTS calendars (
    id INTEGER PRIMARY KEY AUTOINCREMENT,account_id INTEGER NOT NULL REFERENCES mail_accounts(id) ON DELETE CASCADE,
    connection_id INTEGER REFERENCES calendar_connections(id) ON DELETE CASCADE,name TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#3477d4',remote_id TEXT,read_only INTEGER NOT NULL DEFAULT 0,
    is_default INTEGER NOT NULL DEFAULT 0,timezone TEXT NOT NULL DEFAULT 'UTC',last_sync INTEGER)`);
  await db.run(
    "CREATE UNIQUE INDEX IF NOT EXISTS default_calendar_account ON calendars(account_id) WHERE is_default=1",
  );
  await db.run(
    "CREATE UNIQUE INDEX IF NOT EXISTS remote_calendar_connection ON calendars(connection_id,remote_id)",
  );
  await db.run(`CREATE TABLE IF NOT EXISTS calendar_events (
    id TEXT PRIMARY KEY,calendar_id INTEGER NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
    uid TEXT NOT NULL,ics TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 1,UNIQUE(calendar_id,uid))`);
  await db.run(`CREATE TABLE IF NOT EXISTS calendar_oauth_states (
    state_hash TEXT PRIMARY KEY,account_id INTEGER NOT NULL REFERENCES mail_accounts(id) ON DELETE CASCADE,
    session_hash TEXT NOT NULL,provider TEXT NOT NULL,verifier TEXT NOT NULL,expires_at INTEGER NOT NULL)`);
  const stateColumns = await db.all("PRAGMA table_info(calendar_oauth_states)");
  if (!stateColumns.some((column) => column.name === "config_enc"))
    await db.run(
      "ALTER TABLE calendar_oauth_states ADD COLUMN config_enc TEXT",
    );
  await db.run(`CREATE TABLE IF NOT EXISTS calendar_oauth_configs (
    account_id INTEGER NOT NULL REFERENCES mail_accounts(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,config_enc TEXT NOT NULL,PRIMARY KEY(account_id,provider))`);
  await db.run("DELETE FROM calendar_oauth_states WHERE expires_at<?", [
    Date.now(),
  ]);
}
async function ensureDefault(accountId) {
  await db.run(
    "INSERT OR IGNORE INTO calendars(account_id,name,is_default) VALUES(?,'Persönlich',1)",
    [accountId],
  );
}
function publicCalendar(c) {
  return {
    id: c.id,
    name: c.name,
    color: c.color,
    kind: c.kind || "local",
    connectionId: c.connection_id,
    readOnly: !!c.read_only,
    isDefault: !!c.is_default,
    timezone: c.timezone,
    lastSync: c.last_sync,
  };
}
async function owned(req, id) {
  const row = await db.get(
    "SELECT c.*,x.kind FROM calendars c LEFT JOIN calendar_connections x ON x.id=c.connection_id WHERE c.id=? AND c.account_id=?",
    [id, req.account.id],
  );
  if (!row) throw fail("calendar.errors.notFound", 404);
  return row;
}
async function connection(c) {
  return db.get(
    "SELECT * FROM calendar_connections WHERE id=? AND account_id=?",
    [c.connection_id, c.account_id],
  );
}
function name(value) {
  const n = String(value || "").trim();
  if (!n || n.length > 150) throw fail("calendar.errors.input");
  return n;
}
function color(value) {
  return /^#[0-9a-f]{6}$/i.test(value || "") ? value : "#3477d4";
}
function range(req) {
  const start = new Date(req.query.start),
    end = new Date(req.query.end);
  if (
    !Number.isFinite(start.getTime()) ||
    !Number.isFinite(end.getTime()) ||
    end <= start ||
    end - start > 100 * 86400000
  )
    throw fail("calendar.errors.range");
  return [start.toISOString(), end.toISOString()];
}
async function addConnection(accountId, conn, calendars) {
  if (!calendars.length) throw fail("calendar.errors.noCalendars");
  return db.transaction(async (run) => {
    const row = await run(
      "INSERT INTO calendar_connections(account_id,kind,name,url,credentials_enc) VALUES(?,?,?,?,?)",
      [accountId, conn.kind, conn.name, conn.url || "", conn.credentials_enc],
    );
    for (const c of calendars)
      await run(
        "INSERT INTO calendars(account_id,connection_id,name,color,remote_id,read_only,timezone) VALUES(?,?,?,?,?,?,?)",
        [
          accountId,
          row.lastID,
          String(c.name || conn.name).slice(0, 150),
          color(c.color),
          c.remoteId,
          c.readOnly ? 1 : 0,
          c.timezone || "UTC",
        ],
      );
    return row.lastID;
  });
}
function createCalendarRouter(auth, wrap) {
  const router = express.Router();
  router.get(
    "/oauth/:provider/callback",
    wrap(async (req, res) => {
      res.set("Cache-Control", "no-store");
      const provider = req.params.provider;
      if (!["google", "microsoft"].includes(provider))
        return res.sendStatus(404);
      const cookie = String(req.headers.cookie || "")
        .split(";")
        .map((s) => s.trim())
        .find((s) => s.startsWith("post_calendar_state="))
        ?.slice("post_calendar_state=".length);
      const state = String(req.query.state || "");
      if (!state || !cookie || sha256(state) !== sha256(cookie))
        return res
          .status(400)
          .send("Invalid or expired calendar authorization.");
      const saved = await db.transaction(async (run, query) => {
        const rows = await query(
          `SELECT o.* FROM calendar_oauth_states o JOIN sessions s ON s.token_hash=o.session_hash
        WHERE o.state_hash=? AND o.provider=? AND o.expires_at>? AND s.expires_at>? AND s.account_id=o.account_id`,
          [sha256(state), provider, Date.now(), Date.now()],
        );
        await run("DELETE FROM calendar_oauth_states WHERE state_hash=?", [
          sha256(state),
        ]);
        return rows[0];
      });
      if (!saved)
        return res
          .status(400)
          .send("Invalid or expired calendar authorization.");
      const profile = saved.config_enc
        ? JSON.parse(decrypt(saved.config_enc))
        : await oauth.load(provider, saved.account_id);
      res.clearCookie("post_calendar_state", {
        path: "/api/calendar/oauth",
        sameSite: "lax",
        httpOnly: true,
        secure: providers
          .config(provider, profile)
          .redirectUri.startsWith("https:"),
      });
      if (req.query.error || !req.query.code)
        return res.redirect("/?view=calendar&calendarError=denied");
      let connectionId;
      try {
        const tokens = await providers.exchange(
          provider,
          {
            grant_type: "authorization_code",
            code: String(req.query.code),
            code_verifier: saved.verifier,
          },
          profile,
        );
        const result = await db.run(
          "INSERT INTO calendar_connections(account_id,kind,name,credentials_enc) VALUES(?,?,?,?)",
          [
            saved.account_id,
            provider,
            provider === "google" ? "Google" : "Microsoft",
            encrypt(JSON.stringify({ ...tokens, oauth: profile })),
          ],
        );
        connectionId = result.lastID;
        const conn = await db.get(
          "SELECT * FROM calendar_connections WHERE id=?",
          [connectionId],
        );
        const calendars = await providers.discover(conn);
        if (!calendars.length) throw fail("calendar.errors.noCalendars");
        await db.transaction(async (run) => {
          for (const c of calendars)
            await run(
              "INSERT INTO calendars(account_id,connection_id,name,color,remote_id,read_only,timezone) VALUES(?,?,?,?,?,?,?)",
              [
                saved.account_id,
                connectionId,
                String(c.name).slice(0, 150),
                color(c.color),
                c.remoteId,
                c.readOnly ? 1 : 0,
                c.timezone || "UTC",
              ],
            );
        });
        return res.redirect("/?view=calendar&calendarConnected=1");
      } catch {
        if (connectionId)
          await db.run("DELETE FROM calendar_connections WHERE id=?", [
            connectionId,
          ]);
        return res.redirect("/?view=calendar&calendarError=connect");
      }
    }),
  );
  router.use(auth);
  router.get(
    "/config",
    wrap(async (req, res) => {
      res.set("Cache-Control", "no-store");
      res.json(await providers.availability(req.account.id));
    }),
  );
  router.post(
    "/oauth/:provider/config",
    wrap(async (req, res) => {
      res.set("Cache-Control", "no-store");
      res.json(await oauth.save(req.params.provider, req.account.id, req.body));
    }),
  );
  router.post(
    "/oauth/:provider/start",
    wrap(async (req, res) => {
      const provider = req.params.provider;
      if (!["google", "microsoft"].includes(provider))
        throw fail("calendar.errors.input");
      const profile = await oauth.load(provider, req.account.id);
      const providerConfig = providers.config(provider, profile);
      if (
        req.headers.origin &&
        req.headers.origin !== new URL(profile.baseUrl).origin
      )
        throw fail("calendar.errors.oauthOrigin");
      const state = crypto.randomBytes(32).toString("hex"),
        verifier = crypto.randomBytes(48).toString("base64url");
      const url = providers.authorize(provider, state, verifier, profile);
      await db.run("DELETE FROM calendar_oauth_states WHERE expires_at<?", [
        Date.now(),
      ]);
      await db.run(
        "INSERT INTO calendar_oauth_states(state_hash,account_id,session_hash,provider,verifier,expires_at,config_enc) VALUES(?,?,?,?,?,?,?)",
        [
          sha256(state),
          req.account.id,
          req.tokenHash,
          provider,
          verifier,
          Date.now() + 600000,
          encrypt(JSON.stringify(profile)),
        ],
      );
      res.cookie("post_calendar_state", state, {
        httpOnly: true,
        sameSite: "lax",
        secure: providerConfig.redirectUri.startsWith("https:"),
        path: "/api/calendar/oauth",
        maxAge: 600000,
      });
      res.json({ url });
    }),
  );
  router.get(
    "/calendars",
    wrap(async (req, res) => {
      await ensureDefault(req.account.id);
      const calendars = await db.all(
        "SELECT c.*,x.kind FROM calendars c LEFT JOIN calendar_connections x ON x.id=c.connection_id WHERE c.account_id=? ORDER BY c.is_default DESC,c.id",
        [req.account.id],
      );
      const connections = await db.all(
        "SELECT id,kind,name FROM calendar_connections WHERE account_id=?",
        [req.account.id],
      );
      res.json({ calendars: calendars.map(publicCalendar), connections });
    }),
  );
  router.post(
    "/calendars",
    wrap(async (req, res) => {
      const r = await db.run(
        "INSERT INTO calendars(account_id,name,color) VALUES(?,?,?)",
        [req.account.id, name(req.body.name), color(req.body.color)],
      );
      res.json({ id: r.lastID });
    }),
  );
  router.patch(
    "/calendars/:id",
    wrap(async (req, res) => {
      const c = await owned(req, req.params.id);
      await db.run("UPDATE calendars SET name=?,color=? WHERE id=?", [
        name(req.body.name),
        color(req.body.color),
        c.id,
      ]);
      res.json({ success: true });
    }),
  );
  router.delete(
    "/calendars/:id",
    wrap(async (req, res) => {
      const c = await owned(req, req.params.id);
      if (c.connection_id || c.is_default || req.body.confirm !== true)
        throw fail("calendar.errors.deleteCalendar");
      await db.run("DELETE FROM calendars WHERE id=?", [c.id]);
      res.json({ success: true });
    }),
  );
  router.post(
    "/connections",
    wrap(async (req, res) => {
      const kind = req.body.kind;
      if (!["caldav", "ics"].includes(kind))
        throw fail("calendar.errors.input");
      const url = calendarUrl(req.body.url).href;
      const conn = {
        kind,
        name: name(req.body.name),
        url: kind === "ics" ? "" : url,
        credentials_enc: encrypt(
          JSON.stringify(
            kind === "caldav"
              ? {
                  username: name(req.body.username),
                  password: String(req.body.password || ""),
                }
              : { url },
          ),
        ),
      };
      if (kind === "caldav" && !req.body.password)
        throw fail("calendar.errors.input");
      const calendars = await providers.discover(conn);
      const id = await addConnection(req.account.id, conn, calendars);
      res.json({ id, count: calendars.length });
    }),
  );
  router.delete(
    "/connections/:id",
    wrap(async (req, res) => {
      if (req.body.confirm !== true) throw fail("calendar.errors.input");
      const r = await db.run(
        "DELETE FROM calendar_connections WHERE id=? AND account_id=?",
        [req.params.id, req.account.id],
      );
      if (!r.changes) throw fail("calendar.errors.notFound", 404);
      res.json({ success: true });
    }),
  );
  router.get(
    "/events",
    wrap(async (req, res) => {
      const [start, end] = range(req);
      const ids = String(req.query.calendars || "")
        .split(",")
        .map(Number)
        .filter(Number.isSafeInteger);
      if (ids.length > 50) throw fail("calendar.errors.input");
      const rows = await db.all(
        "SELECT c.*,x.kind FROM calendars c LEFT JOIN calendar_connections x ON x.id=c.connection_id WHERE c.account_id=?",
        [req.account.id],
      );
      const events = [],
        errors = [];
                                                                                              
      const loadCalendar = async (c) => {
        try {
          let list;
          if (c.connection_id)
            list = await providers.listEvents(
              c,
              await connection(c),
              start,
              end,
            );
          else {
            const local = await db.all(
              "SELECT * FROM calendar_events WHERE calendar_id=?",
              [c.id],
            );
            list = local.flatMap((e) =>
              ics.expand(e.ics, start, end, {
                id: e.id,
                revision: String(e.revision),
              }),
            );
          }
          events.push(
            ...list.map((e) => ({
              ...e,
              calendarId: c.id,
              readOnly: !!c.read_only,
              color: c.color,
            })),
          );
          await db.run("UPDATE calendars SET last_sync=? WHERE id=?", [
            Date.now(),
            c.id,
          ]);
        } catch (error) {
          errors.push({
            calendarId: c.id,
            error: error.message.startsWith("calendar.errors.")
              ? error.message
              : "calendar.errors.remote",
          });
        }
      };
      const selected = rows.filter((c) => ids.includes(c.id));
      for (let index = 0; index < selected.length; index += 3)
        await Promise.all(selected.slice(index, index + 3).map(loadCalendar));
      res.json({ events, errors, syncedAt: Date.now() });
    }),
  );
  router.post(
    "/events",
    wrap(async (req, res) => {
      const c = await owned(req, req.body.calendarId);
      if (c.read_only) throw fail("calendar.errors.readOnly", 403);
      const data = ics.validate(req.body.event),
        id = req.body.id ? String(req.body.id) : null;
      if (c.connection_id) {
        if (data.recurrence && c.kind !== "caldav")
          throw fail("calendar.errors.remoteRecurrence");
        await providers.writeEvent(
          c,
          await connection(c),
          id,
          data,
          req.body.revision,
        );
      } else {
        if (id) {
          const existing = await db.get(
            "SELECT * FROM calendar_events WHERE id=? AND calendar_id=?",
            [id, c.id],
          );
          if (!existing) throw fail("calendar.errors.notFound", 404);
          const text = ics.build(data, existing.ics);
          const r = await db.run(
            "UPDATE calendar_events SET ics=?,revision=revision+1 WHERE id=? AND calendar_id=? AND revision=?",
            [text, id, c.id, req.body.revision],
          );
          if (!r.changes) throw fail("calendar.errors.conflict", 409);
        } else {
          const text = ics.build(data),
            uid = ics.eventData(ics.master(ics.parse(text))).uid;
          await db.run(
            "INSERT INTO calendar_events(id,calendar_id,uid,ics) VALUES(?,?,?,?)",
            [crypto.randomUUID(), c.id, uid, text],
          );
        }
      }
      res.json({ success: true });
    }),
  );
  router.post(
    "/events/delete",
    wrap(async (req, res) => {
      const c = await owned(req, req.body.calendarId);
      if (c.read_only) throw fail("calendar.errors.readOnly", 403);
      if (req.body.confirm !== true || !req.body.id)
        throw fail("calendar.errors.input");
      if (c.connection_id)
        await providers.writeEvent(
          c,
          await connection(c),
          String(req.body.id),
          null,
          req.body.revision,
          true,
        );
      else {
        const r = await db.run(
          "DELETE FROM calendar_events WHERE id=? AND calendar_id=? AND revision=?",
          [req.body.id, c.id, req.body.revision],
        );
        if (!r.changes) throw fail("calendar.errors.conflict", 409);
      }
      res.json({ success: true });
    }),
  );
  router.post(
    "/calendars/:id/import",
    wrap(async (req, res) => {
      const c = await owned(req, req.params.id);
      if (c.connection_id) throw fail("calendar.errors.localImport");
      let records;
      try {
        records = ics.split(req.body.ics);
      } catch {
        throw fail("calendar.errors.ics");
      }
      const result = await db.transaction(async (run) => {
        let imported = 0;
        for (const r of records) {
          const row = await run(
            "INSERT OR IGNORE INTO calendar_events(id,calendar_id,uid,ics) VALUES(?,?,?,?)",
            [crypto.randomUUID(), c.id, r.uid, r.ics],
          );
          imported += row.changes;
        }
        return { imported, duplicates: records.length - imported };
      });
      res.json(result);
    }),
  );
  router.get(
    "/calendars/:id/export",
    wrap(async (req, res) => {
      const c = await owned(req, req.params.id);
      if (c.connection_id) throw fail("calendar.errors.localImport");
      const rows = await db.all(
        "SELECT ics FROM calendar_events WHERE calendar_id=?",
        [c.id],
      );
      res
        .set("Content-Type", "text/calendar; charset=utf-8")
        .set("Content-Disposition", 'attachment; filename="post-calendar.ics"')
        .send(ics.merge(rows.map((r) => r.ics)));
    }),
  );
  return router;
}
module.exports = { initCalendar, createCalendarRouter, ensureDefault };
