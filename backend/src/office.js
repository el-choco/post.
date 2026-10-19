const express = require("express");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const { Readable } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const db = require("./db");
const storage = require("./filesStorage");
const cloud = require("./filesCloud");
const network = require("./officeNetwork");
const { encrypt, decrypt, sha256 } = require("./crypto");
const { fail } = require("./calendarNetwork");
const TTL = 24 * 3600000;
const formats = {
  pdf: "pdf",
  docx: "word",
  doc: "word",
  odt: "word",
  rtf: "word",
  dotx: "word",
  xlsx: "cell",
  xls: "cell",
  ods: "cell",
  xltx: "cell",
  pptx: "slide",
  ppt: "slide",
  odp: "slide",
  potx: "slide",
};
const editable = new Set([
  "pdf",
  "docx",
  "xlsx",
  "pptx",
  "odt",
  "ods",
  "odp",
  "rtf",
]);
function fileType(item) {
  if (item.folder || item.native || /^image\/|^text\//.test(item.mime || ""))
    return null;
  const ext = /\.([a-z0-9]+)$/i.exec(item.name || "")?.[1].toLowerCase();
  return formats[ext]
    ? { ext, documentType: formats[ext], editable: editable.has(ext) }
    : null;
}
function sign(payload, secret) {
  const header = Buffer.from(
    JSON.stringify({ alg: "HS256", typ: "JWT" }),
  ).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto
    .createHmac("sha256", secret)
    .update(header + "." + body)
    .digest("base64url");
  return header + "." + body + "." + sig;
}
function verify(token, secret) {
  try {
    if (typeof token !== "string" || token.length > 100000) throw Error();
    const [head, body, sig, extra] = token.split(".");
    const header = JSON.parse(Buffer.from(head, "base64url"));
    if (extra || header.alg !== "HS256") throw Error();
    const expected = crypto
      .createHmac("sha256", secret)
      .update(head + "." + body)
      .digest();
    const actual = Buffer.from(sig || "", "base64url");
    if (
      actual.length !== expected.length ||
      !crypto.timingSafeEqual(actual, expected)
    )
      throw Error();
    const payload = JSON.parse(Buffer.from(body, "base64url"));
    if (
      payload.exp !== undefined &&
      (!Number.isFinite(payload.exp) || payload.exp <= Date.now() / 1000)
    )
      throw Error();
    return payload;
  } catch {
    throw fail("office.errors.access", 403);
  }
}
async function initOffice() {
  await db.run(`CREATE TABLE IF NOT EXISTS office_sessions (
    id TEXT PRIMARY KEY, account_id INTEGER NOT NULL REFERENCES mail_accounts(id) ON DELETE CASCADE,
    source TEXT NOT NULL,item_id TEXT NOT NULL,name TEXT NOT NULL,file_type TEXT NOT NULL,
    document_type TEXT NOT NULL,mode TEXT NOT NULL,document_key TEXT NOT NULL,
    snapshot_id TEXT NOT NULL,revision_enc TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'active',
    error TEXT,recovery_id TEXT,recovery_name TEXT,last_hash TEXT,saved_at INTEGER,can_edit INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL)`);
  await db.run(
    `CREATE TABLE IF NOT EXISTS office_saves(session_id TEXT NOT NULL REFERENCES office_sessions(id) ON DELETE CASCADE,hash TEXT NOT NULL,PRIMARY KEY(session_id,hash))`,
  );
  await db.run(
    "CREATE INDEX IF NOT EXISTS office_item ON office_sessions(account_id,source,item_id,mode,state)",
  );
  await cleanup();
}
async function cleanup() {
  await db.run("DELETE FROM office_sessions WHERE expires_at<?", [Date.now()]);
}
async function closeSession(row) {
  await db.run("UPDATE office_sessions SET state='closed' WHERE id=?", [
    row.id,
  ]);
  await fs
    .rm(storage.blobPath(row.snapshot_id), { force: true })
    .catch(() => {});
  await db.run("DELETE FROM file_uploads WHERE id=?", [row.snapshot_id]);
}
async function connection(accountId, sourceId) {
  if (sourceId === "local") return null;
  if (!/^[1-9]\d*$/.test(String(sourceId)))
    throw fail("files.errors.notFound", 404);
  const row = await db.get(
    "SELECT * FROM file_connections WHERE account_id=? AND id=?",
    [accountId, sourceId],
  );
  if (!row) throw fail("files.errors.notFound", 404);
  return row;
}
async function descriptor(accountId, sourceId, itemId) {
  await require("./fileAcl").actor(accountId);
  if (sourceId === "shared") {
    const { row, rights } = await require("./fileAcl").access(
      accountId,
      itemId,
    );
    return {
      item: { ...storage.publicNode(row), readOnly: !(rights & 2) },
      revision: { blob: row.blob_id, modified: row.modified_at },
      row,
      conn: null,
    };
  }
  const conn = await connection(accountId, sourceId);
  if (conn) return { ...(await cloud.officeDescriptor(conn, itemId)), conn };
  const row = await storage.owned(accountId, itemId);
  return {
    item: storage.publicNode(row),
    revision: { blob: row.blob_id, modified: row.modified_at },
    row,
    conn,
  };
}
async function collect(stream, max) {
  const chunks = [];
  let total = 0;
  for await (const bytes of stream) {
    total += bytes.length;
    if (total > max) {
      stream.destroy();
      throw fail("office.errors.size", 413);
    }
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}
async function stage(accountId, name, mime, bytes) {
  const started = await storage.begin(accountId, "office", {
    name,
    mime,
    size: bytes.length,
  });
  try {
    for (
      let offset = 0, index = 0;
      offset < bytes.length;
      offset += storage.CHUNK_SIZE, index++
    )
      await storage.chunk(
        accountId,
        started.id,
        index,
        bytes.subarray(offset, offset + storage.CHUNK_SIZE),
      );
    await db.run(
      "UPDATE file_uploads SET state='office',expires_at=? WHERE id=?",
      [Date.now() + TTL, started.id],
    );
    return storage.upload(accountId, started.id);
  } catch (e) {
    await fs.rm(storage.blobPath(started.id), { force: true });
    await db.run("DELETE FROM file_uploads WHERE id=?", [started.id]);
    throw e;
  }
}
async function session(id, accountId) {
  const row = await db.get(
    "SELECT * FROM office_sessions WHERE id=? AND expires_at>?",
    [id, Date.now()],
  );
  if (!row || (accountId !== undefined && row.account_id !== accountId))
    throw fail("office.errors.notFound", 404);
  return row;
}
function configFor(row, user, language, cfg) {
  const token = (purpose) =>
    sign(
      { sid: row.id, purpose, exp: Math.floor(row.expires_at / 1000) },
      cfg.secret,
    );
  const editor = {
    type: "desktop",
    width: "100%",
    height: "100%",
    documentType: row.document_type,
    document: {
      title: row.name,
      fileType: row.file_type,
      key: row.document_key,
      url: `${cfg.callbackBase}/api/office/documents/${row.id}?token=${token("read")}`,
      permissions: {
        edit: row.mode === "edit",
        download: true,
        print: true,
        comment: row.mode === "edit",
        review: row.mode === "edit",
      },
    },
    editorConfig: {
      mode: row.mode,
      lang: language === "en" ? "en" : "de",
      callbackUrl: `${cfg.callbackBase}/api/office/callback/${row.id}?token=${token("callback")}`,
      user: {
        id: String(row.account_id),
        name: String(
          user.settings?.identityName ||
            user.display_name ||
            user.email ||
            "post.",
        ).slice(0, 128),
      },
      customization: { forcesave: true, autosave: true, compactHeader: true },
    },
  };
  return {
    id: row.id,
    mode: row.mode,
    canEdit: !!row.can_edit,
    url: cfg.publicUrl,
    config: { ...editor, token: sign(editor, cfg.secret) },
  };
}
async function start(account, sourceId, itemId, mode, language) {
  const cfg = network.config();
  if (!cfg.enabled) throw fail("office.errors.disabled", 503);
  if (!["edit", "view"].includes(mode)) throw fail("files.errors.input");
  return storage.locked(
    `office-open:${account.id}:${sourceId}:${itemId}`,
    async () => {
      const data = await descriptor(account.id, sourceId, itemId),
        type = fileType(data.item);
      if (!type || data.item.downloadable === false)
        throw fail("office.errors.format", 400);
      if (mode === "edit" && (data.item.readOnly || !type.editable))
        throw fail("office.errors.readOnly", 403);
      if (data.item.size > cfg.maxSize) throw fail("office.errors.size", 413);
      if (
        mode === "edit" &&
        (await db.get(
          "SELECT id FROM office_sessions WHERE account_id=? AND source=? AND item_id=? AND mode='edit' AND state='active' AND expires_at>?",
          [account.id, sourceId, itemId, Date.now()],
        ))
      )
        throw fail("office.errors.busy", 409);
      const bytes = data.conn
        ? await collect(
            (await cloud.download(data.conn, itemId)).stream,
            cfg.maxSize,
          )
        : await collect(
            Readable.from(storage.readBlob(data.row.blob_id, data.row.key_enc)),
            cfg.maxSize,
          );
      const check = await descriptor(account.id, sourceId, itemId);
      if (JSON.stringify(check.revision) !== JSON.stringify(data.revision))
        throw fail("office.errors.conflict", 409);
      const snapshot = await stage(
        account.id,
        data.item.name,
        data.item.mime,
        bytes,
      );
      const row = {
        id: crypto.randomUUID(),
        account_id: account.id,
        source: sourceId,
        item_id: itemId,
        name: data.item.name,
        file_type: type.ext,
        document_type: type.documentType,
        mode,
        document_key: crypto.randomBytes(24).toString("hex"),
        snapshot_id: snapshot.id,
        revision_enc: encrypt(JSON.stringify(data.revision)),
        can_edit: type.editable && !data.item.readOnly ? 1 : 0,
        created_at: Date.now(),
        expires_at: Date.now() + TTL,
      };
      await db.run(
        `INSERT INTO office_sessions(id,account_id,source,item_id,name,file_type,document_type,mode,document_key,snapshot_id,revision_enc,can_edit,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          row.id,
          row.account_id,
          row.source,
          row.item_id,
          row.name,
          row.file_type,
          row.document_type,
          row.mode,
          row.document_key,
          row.snapshot_id,
          row.revision_enc,
          row.can_edit,
          row.created_at,
          row.expires_at,
        ],
      );
      return configFor(row, account, language, cfg);
    },
  );
}
async function save(row, payload) {
  await require("./fileAcl").actor(row.account_id);
  if (row.source === "shared")
    await require("./fileAcl").access(row.account_id, row.item_id, 3);
  const cfg = network.config();
  const bytes = await network.download(payload.url, cfg);
  const hash = sha256(bytes);
  if (
    await db.get(
      "SELECT hash FROM office_saves WHERE session_id=? AND hash=?",
      [row.id, hash],
    )
  ) {
    if (payload.status === 2) await closeSession(row);
    return;
  }
  const staged = await stage(
    row.account_id,
    row.name,
    "application/octet-stream",
    bytes,
  );

  const recoveryName =
    payload.filetype && formats[payload.filetype.toLowerCase()]
      ? row.name.replace(/\.[^.]+$/, "." + payload.filetype.toLowerCase())
      : row.name;
  await db.run(
    "UPDATE office_sessions SET recovery_id=?,recovery_name=?,error=NULL WHERE id=?",
    [staged.id, recoveryName, row.id],
  );
  if (
    row.recovery_id &&
    !(await db.get("SELECT id FROM file_nodes WHERE blob_id=?", [
      row.recovery_id,
    ]))
  ) {
    await fs.rm(storage.blobPath(row.recovery_id), { force: true });
    await db.run("DELETE FROM file_uploads WHERE id=?", [row.recovery_id]);
  }
  try {
    if (payload.filetype && payload.filetype.toLowerCase() !== row.file_type)
      throw fail("office.errors.formatChanged", 409);
    const data = await descriptor(row.account_id, row.source, row.item_id);
    if (data.item.readOnly) throw fail("office.errors.readOnly", 403);
    const expected = JSON.parse(decrypt(row.revision_enc));
    if (JSON.stringify(data.revision) !== JSON.stringify(expected))
      throw fail("office.errors.conflict", 409);
    let revision;
    if (data.conn)
      revision = await cloud.officeReplace(
        data.conn,
        row.item_id,
        bytes,
        row.file_type,
        expected,
      );
    else
      revision = await storage.replaceContent(
        data.row.account_id,
        row.item_id,
        expected,
        staged,
      );
    await db.run(
      "UPDATE office_sessions SET revision_enc=?,last_hash=?,saved_at=?,error=NULL,recovery_id=NULL,state=? WHERE id=?",
      [
        encrypt(JSON.stringify(revision)),
        hash,
        Date.now(),
        payload.status === 2 ? "closed" : "active",
        row.id,
      ],
    );
    await db.run("INSERT OR IGNORE INTO office_saves VALUES(?,?)", [
      row.id,
      hash,
    ]);
    if (payload.status === 2) await closeSession(row);
    if (data.conn) {
      await fs.rm(storage.blobPath(staged.id), { force: true });
      await db.run("DELETE FROM file_uploads WHERE id=?", [staged.id]);
    }
  } catch (e) {
    const reason = /^(office|files)\.errors\./.test(e.message)
      ? e.message
      : "office.errors.save";
    await db.run("UPDATE office_sessions SET error=? WHERE id=?", [
      reason,
      row.id,
    ]);
    await db.run("UPDATE file_uploads SET expires_at=? WHERE id=?", [
      Date.now() + 7 * TTL,
      staged.id,
    ]);
    await db.run("UPDATE office_sessions SET expires_at=? WHERE id=?", [
      Date.now() + 7 * TTL,
      row.id,
    ]);
    throw e;
  }
}
function createOfficeRouter(auth, wrap) {
  const router = express.Router();
  router.use((req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  router.get(
    "/documents/:id",
    wrap(async (req, res) => {
      const cfg = network.config(),
        payload = verify(req.query.token, cfg.secret);
      if (
        !cfg.enabled ||
        payload.sid !== req.params.id ||
        payload.purpose !== "read"
      )
        throw fail("office.errors.access", 403);
      const row = await session(req.params.id);
      if (!["active", "waiting"].includes(row.state))
        throw fail("office.errors.access", 403);
      await descriptor(row.account_id, row.source, row.item_id);
      const snapshot = await storage.upload(row.account_id, row.snapshot_id);
      res.set({
        "Content-Type": "application/octet-stream",
        "X-Content-Type-Options": "nosniff",
        "Content-Length": String(snapshot.size),
        "Content-Security-Policy": "sandbox; default-src 'none'",
      });
      res.attachment(row.name);
      await pipeline(
        Readable.from(storage.readBlob(snapshot.id, snapshot.key_enc)),
        res,
      );
    }),
  );
  router.post(
    "/callback/:id",
    wrap(async (req, res) => {
      const cfg = network.config();
      if (!cfg.enabled) throw fail("office.errors.access", 403);
      const access = verify(req.query.token, cfg.secret);
      if (access.sid !== req.params.id || access.purpose !== "callback")
        throw fail("office.errors.access", 403);
      const header = req.headers.authorization || "";
      const raw = verify(
        header.startsWith("Bearer ") ? header.slice(7) : req.body.token,
        cfg.secret,
      );
      const payload = raw.payload || raw;

      let saveError = false;
      await storage.locked("office-save:" + req.params.id, async () => {
        const row = await session(req.params.id);
        if (
          payload.key !== row.document_key ||
          ![1, 2, 3, 4, 6, 7].includes(payload.status)
        )
          throw fail("office.errors.access", 403);
        if (row.mode !== "edit") return;
        if ([3, 7].includes(payload.status)) {
          await db.run("UPDATE office_sessions SET error=? WHERE id=?", [
            "office.errors.save",
            row.id,
          ]);
          return;
        }
        if (payload.status === 4) {
          if (row.error) return;
          await closeSession(row);
          return;
        }
        if ([2, 6].includes(payload.status)) {
          if (!["active", "waiting"].includes(row.state)) return;
          try {
            await save(row, payload);
          } catch (e) {
            await db.run("UPDATE office_sessions SET error=? WHERE id=?", [
              /^(office|files)\.errors\./.test(e.message)
                ? e.message
                : "office.errors.save",
              row.id,
            ]);
            saveError = true;
          }
        }
      });
      res.json({ error: saveError ? 1 : 0 });
    }),
  );
  router.use(auth);
  router.get(
    "/config",
    wrap(async (req, res) => {
      try {
        const cfg = network.config();
        res.json({ enabled: cfg.enabled, maxSize: cfg.maxSize });
      } catch {
        res.json({ enabled: false, error: "office.errors.config" });
      }
    }),
  );
  router.get(
    "/recoveries",
    wrap(async (req, res) => {
      const rows = await db.all(
        "SELECT id,recovery_name,name,expires_at,error FROM office_sessions WHERE account_id=? AND recovery_id IS NOT NULL AND expires_at>? ORDER BY created_at DESC LIMIT 20",
        [req.account.id, Date.now()],
      );
      res.json({
        items: rows.map((r) => ({
          id: r.id,
          name: r.recovery_name || r.name,
          expiresAt: r.expires_at,
          error: r.error,
        })),
      });
    }),
  );
  router.post(
    "/sessions/:id/keep",
    wrap(async (req, res) => {
      const result = await storage.locked(
        "office-save:" + req.params.id,
        async () => {
          const row = await session(req.params.id, req.account.id);
          if (!row.recovery_id) throw fail("office.errors.notFound", 404);
          let staged = await storage.upload(row.account_id, row.recovery_id);

          if (
            await db.get("SELECT id FROM file_nodes WHERE blob_id=?", [
              staged.id,
            ])
          ) {
            const bytes = await collect(
              Readable.from(storage.readBlob(staged.id, staged.key_enc)),
              100 * 1024 ** 2,
            );
            staged = await stage(
              row.account_id,
              row.recovery_name || row.name,
              staged.mime,
              bytes,
            );
          }
          const folder = await storage.mkdir(
            row.account_id,
            "root",
            req.body.language === "en"
              ? "Recovered documents"
              : "Wiederhergestellte Dokumente",
          );
          const original = row.recovery_name || row.name,
            ext = /\.[^.]+$/.exec(original)?.[0] || "";
          const name = storage.name(
            original.slice(0, original.length - ext.length).slice(0, 60) +
              " (" +
              crypto.randomBytes(4).toString("hex") +
              ")" +
              ext,
          );
          const id = await storage.finishLocal({
            ...staged,
            parent_id: folder.id,
            name,
          });
          await db.transaction(async (run) => {
            await run(
              "UPDATE file_uploads SET state='completed',result_id=? WHERE id=?",
              [id, staged.id],
            );
            await run(
              "UPDATE office_sessions SET recovery_id=NULL,error=NULL,state='waiting' WHERE id=?",
              [row.id],
            );
          });
          return { id, name, folderId: folder.id };
        },
      );
      res.json(result);
    }),
  );
  router.post(
    "/sessions",
    wrap(async (req, res) =>
      res.json(
        await start(
          req.account,
          String(req.body.source),
          String(req.body.itemId),
          req.body.mode || "view",
          req.body.language,
        ),
      ),
    ),
  );
  router.get(
    "/sessions/:id",
    wrap(async (req, res) => {
      const row = await session(req.params.id, req.account.id);
      res.json({
        state: row.state,
        error: row.error,
        savedAt: row.saved_at,
        recovery: !!row.recovery_id,
        recoveryName: row.recovery_name,
        mode: row.mode,
      });
    }),
  );
  router.post(
    "/sessions/:id/close",
    wrap(async (req, res) => {
      const row = await session(req.params.id, req.account.id);
      if (row.mode === "view") await closeSession(row);
      else if (req.body.detach === true)
        await db.run(
          "UPDATE office_sessions SET state='waiting' WHERE id=? AND state='active'",
          [row.id],
        );
      res.json({ success: true });
    }),
  );
  router.get(
    "/sessions/:id/recovery",
    wrap(async (req, res) => {
      const row = await session(req.params.id, req.account.id);
      if (!row.recovery_id) throw fail("office.errors.notFound", 404);
      const snapshot = await storage.upload(row.account_id, row.recovery_id);
      res.attachment(row.recovery_name || row.name);
      res.type("application/octet-stream");
      res.set("X-Content-Type-Options", "nosniff");
      await pipeline(
        Readable.from(storage.readBlob(snapshot.id, snapshot.key_enc)),
        res,
      );
    }),
  );
  return router;
}
module.exports = {
  initOffice,
  cleanup,
  createOfficeRouter,
  fileType,
  formats,
  sign,
  verify,
  descriptor,
  stage,
  start,
  save,
};
