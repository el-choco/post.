const express = require("express");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const { Readable, Transform } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const db = require("./db");
const storage = require("./filesStorage");
const oauth = require("./filesOAuth");
const cloud = require("./filesCloud");
const { encrypt, decrypt, sha256 } = require("./crypto");
const { fail } = require("./calendarNetwork");

async function source(accountId, value) {
  if (value === "local") return null;
  if (!/^[1-9]\d*$/.test(String(value)))
    throw fail("files.errors.notFound", 404);
  const row = await db.get(
    "SELECT * FROM file_connections WHERE account_id=? AND id=?",
    [accountId, value],
  );
  if (!row) throw fail("files.errors.notFound", 404);
  return row;
}
async function transfer(accountId, sourceId, itemId, res, maxSize) {
  const conn = await source(accountId, sourceId);
  let download;
  if (conn) download = await cloud.download(conn, itemId);
  else {
    const row = await storage.owned(accountId, itemId);
    if (row.folder) throw fail("files.errors.notFile");
    download = {
      name: row.name,
      size: row.size,
      stream: Readable.from(storage.readBlob(row.blob_id, row.key_enc)),
    };
  }
  if (maxSize && download.size > maxSize) {
    download.stream.destroy();
    throw fail("files.errors.preview", 413);
  }
  res.attachment(download.name);
  res.set({
    "Content-Type": "application/octet-stream",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "sandbox; default-src 'none'",
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
  });
  if (download.size !== undefined)
    res.set("Content-Length", String(download.size));
  if (maxSize) {
    let count = 0;
    const limited = new Transform({
      transform(bytes, encoding, done) {
        count += bytes.length;
        done(
          count > maxSize ? fail("files.errors.preview", 413) : null,
          count > maxSize ? undefined : bytes,
        );
      },
    });
    await pipeline(download.stream, limited, res);
  } else await pipeline(download.stream, res);
}
async function commit(accountId, uploadId) {
  try {
    const row = await storage.upload(accountId, uploadId),
      conn = await source(accountId, row.source);
    const resultId = conn
      ? await cloud.upload(conn, row, async (sent) =>
          db.run("UPDATE file_uploads SET progress=?,expires_at=? WHERE id=?", [
            Math.round((sent / Math.max(1, row.size)) * 100),
            Date.now() + 3600000,
            row.id,
          ]),
        )
      : await storage.finishLocal(row);
    await db.run(
      "UPDATE file_uploads SET state='completed',result_id=?,progress=100 WHERE id=?",
      [resultId, row.id],
    );
    if (conn) await fs.rm(storage.blobPath(row.id), { force: true });
  } catch (e) {
    const message = /^(files|calendar)\.errors\./.test(e.message)
      ? e.message
      : e.code === "ENOSPC"
        ? "files.errors.quota"
        : "files.errors.remote";
    await db
      .run(
        "UPDATE file_uploads SET state='failed',error=? WHERE id=? AND account_id=?",
        [message, uploadId, accountId],
      )
      .catch(() => {});
  }
}
function createFilesRouter(auth, wrap) {
  const router = express.Router();
  router.use((req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  router.get(
    "/oauth/:provider/callback",
    wrap(async (req, res) => {
      const provider = req.params.provider;
      if (!["google", "microsoft"].includes(provider))
        return res.sendStatus(404);
      const state = String(req.query.state || ""),
        cookie = String(req.headers.cookie || "")
          .split(";")
          .map((s) => s.trim())
          .find((s) => s.startsWith("post_files_state="))
          ?.slice("post_files_state=".length);
      if (!state || !cookie || sha256(state) !== sha256(cookie))
        return res.status(400).send("Invalid or expired file authorization.");
      const saved = await db.transaction(async (run, query) => {
        const rows = await query(
          "SELECT f.* FROM file_oauth_states f JOIN sessions s ON s.token_hash=f.session_hash WHERE f.state_hash=? AND f.provider=? AND f.expires_at>? AND s.expires_at>? AND s.account_id=f.account_id",
          [sha256(state), provider, Date.now(), Date.now()],
        );
        await run("DELETE FROM file_oauth_states WHERE state_hash=?", [
          sha256(state),
        ]);
        return rows[0];
      });
      if (!saved)
        return res.status(400).send("Invalid or expired file authorization.");
      const profile = JSON.parse(decrypt(saved.config_enc));
      res.clearCookie("post_files_state", {
        path: "/api/files/oauth",
        sameSite: "lax",
        httpOnly: true,
        secure: profile.baseUrl.startsWith("https:"),
      });
      const redirect = (query) =>
        res.redirect(profile.baseUrl + "/?view=files&" + query);
      if (req.query.error || !req.query.code)
        return redirect("filesError=denied");
      try {
        const tokens = {
          ...(await oauth.exchange(
            provider,
            {
              grant_type: "authorization_code",
              code: String(req.query.code),
              code_verifier: saved.verifier,
            },
            profile,
          )),
          oauth: profile,
        };
        Object.assign(tokens, await cloud.discover(provider, tokens));
        const result = await db.run(
          "INSERT INTO file_connections(account_id,kind,name,credentials_enc) VALUES(?,?,?,?)",
          [
            saved.account_id,
            provider,
            String(tokens.label || provider).slice(0, 150),
            encrypt(JSON.stringify(tokens)),
          ],
        );
        return redirect("filesConnected=" + result.lastID);
      } catch {
        return redirect("filesError=connect");
      }
    }),
  );
  router.get(
    "/downloads/:token",
    wrap(async (req, res) => {
      if (req.method !== "GET") return res.sendStatus(405);
      const saved = await db.transaction(async (run, query) => {
        const rows = await query(
          "SELECT d.* FROM file_downloads d JOIN sessions s ON s.token_hash=d.session_hash WHERE d.token_hash=? AND d.expires_at>? AND s.expires_at>? AND s.account_id=d.account_id",
          [sha256(req.params.token), Date.now(), Date.now()],
        );
        await run("DELETE FROM file_downloads WHERE token_hash=?", [
          sha256(req.params.token),
        ]);
        return rows[0];
      });
      if (!saved) throw fail("files.errors.notFound", 404);
      await transfer(saved.account_id, saved.source, saved.item_id, res);
    }),
  );
  router.use(auth);
  router.get(
    "/config",
    wrap(async (req, res) =>
      res.json({
        ...(await oauth.settings(req.account.id)),
        ...storage.limits(),
      }),
    ),
  );
  router.post(
    "/oauth/:provider/config",
    wrap(async (req, res) =>
      res.json(await oauth.save(req.params.provider, req.account.id, req.body)),
    ),
  );
  router.post(
    "/oauth/:provider/start",
    wrap(async (req, res) => {
      const provider = req.params.provider,
        profile = await oauth.load(provider, req.account.id),
        cfg = oauth.config(provider, profile);
      if (req.headers.origin && req.headers.origin !== profile.baseUrl)
        throw fail("calendar.errors.oauthOrigin");
      const state = crypto.randomBytes(32).toString("hex"),
        verifier = crypto.randomBytes(48).toString("base64url");
      await db.run("DELETE FROM file_oauth_states WHERE expires_at<?", [
        Date.now(),
      ]);
      await db.run("INSERT INTO file_oauth_states VALUES(?,?,?,?,?,?,?)", [
        sha256(state),
        req.account.id,
        req.tokenHash,
        provider,
        verifier,
        Date.now() + 600000,
        encrypt(JSON.stringify(profile)),
      ]);
      res.cookie("post_files_state", state, {
        httpOnly: true,
        sameSite: "lax",
        secure: cfg.redirectUri.startsWith("https:"),
        path: "/api/files/oauth",
        maxAge: 600000,
      });
      res.json({ url: oauth.authorize(provider, state, verifier, profile) });
    }),
  );
  router.get(
    "/sources",
    wrap(async (req, res) => {
      const rows = await db.all(
        "SELECT id,kind,name FROM file_connections WHERE account_id=? ORDER BY id",
        [req.account.id],
      );
      res.json({
        sources: [
          { id: "local", kind: "local", name: "files.private", trash: true },
          ...rows.map((r) => ({
            ...r,
            id: String(r.id),
            trash: r.kind === "google",
          })),
        ],
      });
    }),
  );
  router.delete(
    "/sources/:source",
    wrap(async (req, res) => {
      const conn = await source(req.account.id, req.params.source);
      if (!conn || req.body.confirm !== true) throw fail("files.errors.input");
      await db.run("DELETE FROM file_connections WHERE id=? AND account_id=?", [
        conn.id,
        req.account.id,
      ]);
      res.json({ success: true });
    }),
  );
  router.get(
    "/sources/:source/items",
    wrap(async (req, res) => {
      const conn = await source(req.account.id, req.params.source);
      const options = {
        parent: String(req.query.parent || "root"),
        trash: req.query.trash === "1",
        query: String(req.query.q || ""),
        cursor: String(req.query.cursor || (conn ? "" : "0")),
        folders: req.query.folders === "1",
      };
      const result = conn
        ? await cloud.list(conn, options)
        : await storage.list(req.account.id, options);
      const breadcrumbs = options.trash
        ? []
        : conn
          ? await cloud.breadcrumbs(conn, options.parent)
          : await storage.ancestors(req.account.id, options.parent);
      res.json({ ...result, breadcrumbs });
    }),
  );
  router.post(
    "/sources/:source/folders",
    wrap(async (req, res) => {
      const conn = await source(req.account.id, req.params.source);
      const result = conn
        ? await storage.locked("cloud:" + conn.id, () =>
            cloud.mkdir(conn, req.body.parentId, req.body.path),
          )
        : await storage.mkdir(req.account.id, req.body.parentId, req.body.path);
      res.json(result);
    }),
  );
  router.patch(
    "/sources/:source/items/:id",
    wrap(async (req, res) => {
      const conn = await source(req.account.id, req.params.source);
      res.json(
        conn
          ? await cloud.change(conn, req.params.id, req.body)
          : await storage.change(req.account.id, req.params.id, req.body),
      );
    }),
  );
  router.post(
    "/sources/:source/items/:id/trash",
    wrap(async (req, res) => {
      if (req.body.confirm !== true) throw fail("files.errors.input");
      const conn = await source(req.account.id, req.params.source);
      if (conn) await cloud.remove(conn, req.params.id);
      else await storage.remove(req.account.id, req.params.id);
      res.json({ success: true });
    }),
  );
  router.post(
    "/sources/:source/items/:id/restore",
    wrap(async (req, res) => {
      const conn = await source(req.account.id, req.params.source);
      if (conn) await cloud.remove(conn, req.params.id, true);
      else await storage.restore(req.account.id, req.params.id);
      res.json({ success: true });
    }),
  );
  router.delete(
    "/sources/:source/items/:id",
    wrap(async (req, res) => {
      if (req.params.source !== "local" || req.body.confirm !== true)
        throw fail("files.errors.input");
      await storage.remove(req.account.id, req.params.id, true);
      res.json({ success: true });
    }),
  );
  router.get(
    "/sources/:source/items/:id/content",
    wrap(async (req, res) =>
      transfer(
        req.account.id,
        req.params.source,
        req.params.id,
        res,
        req.query.preview === "1" ? 10 * 1024 ** 2 : undefined,
      ),
    ),
  );
  router.post(
    "/sources/:source/items/:id/download",
    wrap(async (req, res) => {
      const conn = await source(req.account.id, req.params.source);
      if (conn) await cloud.item(conn, req.params.id);
      else await storage.owned(req.account.id, req.params.id);
      const token = crypto.randomBytes(32).toString("hex");
      await db.run("INSERT INTO file_downloads VALUES(?,?,?,?,?,?)", [
        sha256(token),
        req.account.id,
        req.tokenHash,
        req.params.source,
        req.params.id,
        Date.now() + 60000,
      ]);
      res.json({ url: "/api/files/downloads/" + token });
    }),
  );
  router.post(
    "/sources/:source/uploads",
    wrap(async (req, res) => {
      const conn = await source(req.account.id, req.params.source);
      if (conn) await cloud.folder(conn, req.body.parentId || "root");
      res.json(
        await storage.begin(req.account.id, req.params.source, req.body),
      );
    }),
  );
  router.put(
    "/uploads/:id/chunks/:index",
    express.raw({ type: "application/octet-stream", limit: "11mb" }),
    wrap(async (req, res) =>
      res.json(
        await storage.chunk(
          req.account.id,
          req.params.id,
          req.params.index,
          req.body,
        ),
      ),
    ),
  );
  router.get(
    "/uploads/:id",
    wrap(async (req, res) => {
      const row = await storage.upload(req.account.id, req.params.id);
      res.json({
        state: row.state,
        received: row.received,
        progress: row.progress,
        error: row.error,
        resultId: row.result_id,
      });
    }),
  );
  router.post(
    "/uploads/:id/commit",
    wrap(async (req, res) => {
      const started = await storage.locked(
        "upload:" + req.params.id,
        async () => {
          const row = await storage.upload(req.account.id, req.params.id);
          if (row.state === "committing" || row.state === "completed")
            return false;
          if (row.state !== "pending" || row.received !== row.size)
            throw fail("files.errors.chunk", 409);
          await db.run(
            "UPDATE file_uploads SET state='committing' WHERE id=?",
            [row.id],
          );
          return true;
        },
      );
      if (started) void commit(req.account.id, req.params.id);
      res.status(202).json({ success: true });
    }),
  );
  router.delete(
    "/uploads/:id",
    wrap(async (req, res) =>
      storage.locked("upload:" + req.params.id, async () => {
        const row = await storage.upload(req.account.id, req.params.id);
        if (row.state === "committing") throw fail("files.errors.busy", 409);
        if (row.state !== "completed")
          await fs.rm(storage.blobPath(row.id), { force: true });
        await db.run("DELETE FROM file_uploads WHERE id=? AND account_id=?", [
          row.id,
          req.account.id,
        ]);
        res.json({ success: true });
      }),
    ),
  );
  return router;
}
module.exports = { createFilesRouter, source, transfer, commit };
