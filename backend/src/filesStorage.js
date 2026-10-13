const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const db = require("./db");
const { encrypt, decrypt } = require("./crypto");
const { fail } = require("./calendarNetwork");

const CHUNK_SIZE = 10 * 1024 * 1024;
const root = path.join(db.dataDir, "files");
const locks = new Map();
async function locked(key, fn) {
  const previous = locks.get(key) || Promise.resolve();
  let release;
  const current = new Promise((resolve) => {
    release = resolve;
  });
  locks.set(key, current);
  await previous;
  try {
    return await fn();
  } finally {
    release();
    if (locks.get(key) === current) locks.delete(key);
  }
}
function limit(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value > 0
    ? value * 1024 * 1024
    : fallback;
}
const limits = () => ({
  chunkSize: CHUNK_SIZE,
  maxFileSize: limit("FILES_MAX_UPLOAD_MB", 1024 ** 3),
  quota: limit("FILES_QUOTA_MB", 5 * 1024 ** 3),
});
function name(value) {
  if (typeof value !== "string") throw fail("files.errors.name");
  const result = value.trim().normalize("NFC");
  if (
    !result ||
    result === "." ||
    result === ".." ||
    /[\\/:*?"<>|\x00-\x1f\x7f]/.test(result) ||
    Buffer.byteLength(result) > 240 ||
    /[. ]$/.test(result)
  )
    throw fail("files.errors.name");
  return result;
}
function parts(value) {
  if (
    typeof value !== "string" ||
    value.startsWith("/") ||
    value.includes("\\")
  )
    throw fail("files.errors.name");
  const result = value.split("/");
  if (result.length > 40) throw fail("files.errors.depth");
  return result.map(name);
}
function blobPath(id) {
  if (!/^[a-f0-9-]{36}$/.test(id || ""))
    throw fail("files.errors.notFound", 404);
  return path.join(root, id + ".bin");
}
const parentId = (id) => (!id || id === "root" ? null : String(id));
function publicNode(row) {
  return {
    id: row.id,
    parentId: row.parent_id || "root",
    name: row.name,
    folder: !!row.folder,
    size: row.size,
    mime: row.mime,
    modifiedAt: row.modified_at,
    trashed: !!row.deleted_at,
  };
}
async function initFiles() {
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  await db.run(`CREATE TABLE IF NOT EXISTS file_nodes (
    id TEXT PRIMARY KEY,account_id INTEGER NOT NULL REFERENCES mail_accounts(id) ON DELETE CASCADE,
    parent_id TEXT REFERENCES file_nodes(id) ON DELETE CASCADE,name TEXT NOT NULL,folder INTEGER NOT NULL,
    size INTEGER NOT NULL DEFAULT 0,mime TEXT NOT NULL DEFAULT '',key_enc TEXT,blob_id TEXT,
    modified_at INTEGER NOT NULL,deleted_at INTEGER,trash_root TEXT)`);
  await db.run(
    "CREATE UNIQUE INDEX IF NOT EXISTS file_name_parent ON file_nodes(account_id,COALESCE(parent_id,''),name) WHERE deleted_at IS NULL",
  );
  await db.run(
    "CREATE INDEX IF NOT EXISTS file_account_parent ON file_nodes(account_id,parent_id)",
  );
  await db.run(`CREATE TABLE IF NOT EXISTS file_uploads (
    id TEXT PRIMARY KEY,account_id INTEGER NOT NULL REFERENCES mail_accounts(id) ON DELETE CASCADE,
    source TEXT NOT NULL,parent_id TEXT,name TEXT NOT NULL,size INTEGER NOT NULL,mime TEXT NOT NULL,key_enc TEXT NOT NULL,
    received INTEGER NOT NULL DEFAULT 0,chunks INTEGER NOT NULL DEFAULT 0,state TEXT NOT NULL DEFAULT 'pending',
    progress INTEGER NOT NULL DEFAULT 0,error TEXT,result_id TEXT,expires_at INTEGER NOT NULL)`);
  await db.run(
    `CREATE TABLE IF NOT EXISTS file_downloads (token_hash TEXT PRIMARY KEY,account_id INTEGER NOT NULL REFERENCES mail_accounts(id) ON DELETE CASCADE,session_hash TEXT NOT NULL,source TEXT NOT NULL,item_id TEXT NOT NULL,expires_at INTEGER NOT NULL)`,
  );
  await require("./filesOAuth").init();
  await db.run(
    "UPDATE file_uploads SET state='failed',error='files.errors.interrupted' WHERE state IN ('pending','committing')",
  );
  await cleanup();
}
async function cleanup() {
  const rows = await db.all("SELECT id FROM file_uploads WHERE expires_at<?", [
    Date.now(),
  ]);
  for (const row of rows)
    await locked("upload:" + row.id, async () => {
      const current = await db.get(
        "SELECT expires_at FROM file_uploads WHERE id=?",
        [row.id],
      );
      if (!current || current.expires_at >= Date.now()) return;
      if (
        !(await db.get("SELECT id FROM file_nodes WHERE blob_id=?", [row.id]))
      )
        await fs.rm(blobPath(row.id), { force: true });
      await db.run("DELETE FROM file_uploads WHERE id=? AND expires_at<?", [
        row.id,
        Date.now(),
      ]);
    });
  await db.run("DELETE FROM file_downloads WHERE expires_at<?", [Date.now()]);
}
async function owned(account, id, trash = false) {
  const row = await db.get(
    "SELECT * FROM file_nodes WHERE id=? AND account_id=?",
    [String(id), account],
  );
  if (!row || (!trash && row.deleted_at))
    throw fail("files.errors.notFound", 404);
  return row;
}
async function folder(account, id) {
  const parent = parentId(id);
  if (parent && !(await owned(account, parent)).folder)
    throw fail("files.errors.notFolder");
  return parent;
}
async function used(account) {
  const row = await db.get(
    "SELECT COALESCE(SUM(size),0) AS size FROM file_nodes WHERE account_id=? AND folder=0",
    [account],
  );
  return row.size;
}
async function list(
  account,
  {
    parent = "root",
    trash = false,
    query = "",
    cursor = "0",
    folders = false,
  } = {},
) {
  const p = trash ? null : await folder(account, parent);
  const offset = Number(cursor);
  if (!Number.isSafeInteger(offset) || offset < 0 || query.length > 200)
    throw fail("files.errors.input");
  const rows = await db.all(
    `SELECT * FROM file_nodes WHERE account_id=? AND ${trash ? "deleted_at IS NOT NULL AND trash_root=id" : "deleted_at IS NULL AND parent_id IS ?"} ${folders ? "AND folder=1" : ""} AND instr(lower(name),lower(?))>0 ORDER BY folder DESC,name COLLATE NOCASE LIMIT 201 OFFSET ?`,
    trash ? [account, query, offset] : [account, p, query, offset],
  );
  return {
    items: rows.slice(0, 200).map(publicNode),
    next: rows.length > 200 ? String(offset + 200) : null,
    used: await used(account),
    quota: limits().quota,
  };
}
async function mkdir(account, parent, relative) {
  return locked("account:" + account, async () => {
    let p = await folder(account, parent);
    for (const segment of parts(relative)) {
      const found = await db.get(
        "SELECT * FROM file_nodes WHERE account_id=? AND parent_id IS ? AND name=? AND deleted_at IS NULL",
        [account, p, segment],
      );
      if (found) {
        if (!found.folder) throw fail("files.errors.conflict", 409);
        p = found.id;
        continue;
      }
      const id = crypto.randomUUID();
      await db.run(
        "INSERT INTO file_nodes(id,account_id,parent_id,name,folder,modified_at) VALUES(?,?,?,?,1,?)",
        [id, account, p, segment, Date.now()],
      );
      p = id;
    }
    return publicNode(await owned(account, p));
  });
}
async function ancestors(account, id) {
  const result = [];
  let p = parentId(id);
  for (let depth = 0; p && depth < 100; depth++) {
    const row = await owned(account, p);
    result.unshift(publicNode(row));
    p = row.parent_id;
  }
  if (p) throw fail("files.errors.depth");
  return result;
}
async function change(account, id, input) {
  return locked("account:" + account, async () => {
    const row = await owned(account, id);
    const nextName = input.name === undefined ? row.name : name(input.name);
    const parent =
      input.parentId === undefined
        ? row.parent_id
        : await folder(account, input.parentId);
    if (
      row.folder &&
      (parent === row.id ||
        (await ancestors(account, parent)).some((p) => p.id === row.id))
    )
      throw fail("files.errors.cycle");
    try {
      await db.run(
        "UPDATE file_nodes SET name=?,parent_id=?,modified_at=? WHERE id=? AND account_id=?",
        [nextName, parent, Date.now(), id, account],
      );
    } catch (e) {
      if (e.code === "SQLITE_CONSTRAINT")
        throw fail("files.errors.conflict", 409);
      throw e;
    }
    return publicNode(await owned(account, id));
  });
}
async function subtree(account, id) {
  return db.all(
    `WITH RECURSIVE tree AS (SELECT * FROM file_nodes WHERE id=? AND account_id=? UNION ALL SELECT n.* FROM file_nodes n JOIN tree t ON n.parent_id=t.id WHERE n.account_id=?) SELECT * FROM tree`,
    [id, account, account],
  );
}
async function remove(account, id, purge = false) {
  return locked("account:" + account, async () => {
    const row = await owned(account, id, true);
    const rows = await subtree(account, id);
    if (purge) {
      if (!row.deleted_at) throw fail("files.errors.input");
      await db.run("DELETE FROM file_nodes WHERE id=? AND account_id=?", [
        id,
        account,
      ]);
      for (const item of rows)
        if (item.blob_id) await fs.rm(blobPath(item.blob_id), { force: true });
    } else {
      if (row.deleted_at) throw fail("files.errors.input");
      await db.transaction(async (run) => {
        for (const item of rows.filter((n) => !n.deleted_at))
          await run(
            "UPDATE file_nodes SET deleted_at=?,trash_root=? WHERE id=? AND account_id=?",
            [Date.now(), id, item.id, account],
          );
      });
    }
  });
}
async function restore(account, id) {
  return locked("account:" + account, async () => {
    const row = await owned(account, id, true);
    if (!row.deleted_at || row.trash_root !== row.id)
      throw fail("files.errors.input");
    let p = row.parent_id;
    if (p) {
      const parent = await db.get(
        "SELECT * FROM file_nodes WHERE id=? AND account_id=? AND deleted_at IS NULL",
        [p, account],
      );
      if (!parent) p = null;
    }
    let nextName = row.name,
      count = 1;
    while (
      await db.get(
        "SELECT id FROM file_nodes WHERE account_id=? AND parent_id IS ? AND name=? AND deleted_at IS NULL",
        [account, p, nextName],
      )
    )
      nextName = name(row.name.slice(0, 100) + " (" + count++ + ")");
    await db.transaction(async (run) => {
      await run("UPDATE file_nodes SET name=?,parent_id=? WHERE id=?", [
        nextName,
        p,
        id,
      ]);
      await run(
        "UPDATE file_nodes SET deleted_at=NULL,trash_root=NULL WHERE account_id=? AND trash_root=?",
        [account, id],
      );
    });
  });
}
async function begin(account, source, input) {
  return locked("account:" + account, async () => {
    const filename = name(input.name),
      size = Number(input.size),
      { maxFileSize, quota } = limits();
    if (!Number.isSafeInteger(size) || size < 0 || size > maxFileSize)
      throw fail("files.errors.size", 413);
    const p =
      source === "local"
        ? await folder(account, input.parentId)
        : String(input.parentId || "root");
    const pending = await db.get(
      "SELECT COALESCE(SUM(size),0) AS size,COUNT(*) AS count FROM file_uploads WHERE account_id=? AND state IN ('pending','committing','office')",
      [account],
    );
    if (pending.count >= 20) throw fail("files.errors.busy", 429);
    if ((await used(account)) + pending.size + size > quota)
      throw fail("files.errors.quota", 507);
    if (
      source === "local" &&
      (await db.get(
        "SELECT id FROM file_nodes WHERE account_id=? AND parent_id IS ? AND name=? AND deleted_at IS NULL",
        [account, p, filename],
      ))
    )
      throw fail("files.errors.conflict", 409);
    const id = crypto.randomUUID();
    await fs.writeFile(blobPath(id), Buffer.alloc(0), {
      flag: "wx",
      mode: 0o600,
    });
    try {
      await db.run(
        "INSERT INTO file_uploads(id,account_id,source,parent_id,name,size,mime,key_enc,expires_at) VALUES(?,?,?,?,?,?,?,?,?)",
        [
          id,
          account,
          source,
          p,
          filename,
          size,
          String(input.mime || "application/octet-stream").slice(0, 150),
          encrypt(crypto.randomBytes(32).toString("base64")),
          Date.now() + 3600000,
        ],
      );
    } catch (e) {
      await fs.rm(blobPath(id), { force: true });
      throw e;
    }
    return { id, chunkSize: CHUNK_SIZE };
  });
}
async function upload(account, id) {
  const row = await db.get(
    "SELECT * FROM file_uploads WHERE id=? AND account_id=? AND expires_at>?",
    [id, account, Date.now()],
  );
  if (!row) throw fail("files.errors.notFound", 404);
  return row;
}
async function chunk(account, id, index, bytes) {
  return locked("upload:" + id, async () => {
    const row = await upload(account, id);
    if (
      row.state !== "pending" ||
      Number(index) !== row.chunks ||
      !Buffer.isBuffer(bytes) ||
      bytes.length !== Math.min(CHUNK_SIZE, row.size - row.received) ||
      bytes.length === 0
    )
      throw fail("files.errors.chunk", 409);
    const iv = crypto.randomBytes(12),
      cipher = crypto.createCipheriv(
        "aes-256-gcm",
        Buffer.from(decrypt(row.key_enc), "base64"),
        iv,
      );
    const body = Buffer.concat([cipher.update(bytes), cipher.final()]);
    const header = Buffer.alloc(4);
    header.writeUInt32BE(body.length);
    const file = blobPath(id),
      oldSize = (await fs.stat(file)).size;
    await fs.appendFile(
      file,
      Buffer.concat([header, iv, cipher.getAuthTag(), body]),
    );
    try {
      await db.run(
        "UPDATE file_uploads SET received=received+?,chunks=chunks+1,expires_at=? WHERE id=?",
        [bytes.length, Date.now() + 3600000, id],
      );
    } catch (e) {
      await fs.truncate(file, oldSize);
      throw e;
    }
    return { received: row.received + bytes.length };
  });
}
async function* readBlob(id, keyEnc) {
  const file = await fs.open(blobPath(id), "r");
  const key = Buffer.from(decrypt(keyEnc), "base64");
  let offset = 0;
  try {
    while (true) {
      const header = Buffer.alloc(32),
        { bytesRead } = await file.read(header, 0, 32, offset);
      if (!bytesRead) break;
      const length = header.readUInt32BE();
      if (bytesRead !== 32 || !length || length > CHUNK_SIZE)
        throw fail("files.errors.corrupt", 500);
      const body = Buffer.alloc(length),
        content = await file.read(body, 0, length, offset + 32);
      if (content.bytesRead !== length) throw fail("files.errors.corrupt", 500);
      const decipher = crypto.createDecipheriv(
        "aes-256-gcm",
        key,
        header.subarray(4, 16),
      );
      decipher.setAuthTag(header.subarray(16, 32));
      yield Buffer.concat([decipher.update(body), decipher.final()]);
      offset += 32 + length;
    }
  } finally {
    await file.close();
  }
}
async function finishLocal(row) {
  return locked("account:" + row.account_id, async () => {
    await folder(row.account_id, row.parent_id);
    const id = crypto.randomUUID();
    try {
      await db.run(
        "INSERT INTO file_nodes(id,account_id,parent_id,name,folder,size,mime,key_enc,blob_id,modified_at) VALUES(?,?,?,?,0,?,?,?,?,?)",
        [
          id,
          row.account_id,
          row.parent_id,
          row.name,
          row.size,
          row.mime,
          row.key_enc,
          row.id,
          Date.now(),
        ],
      );
    } catch (e) {
      if (e.code === "SQLITE_CONSTRAINT")
        throw fail("files.errors.conflict", 409);
      throw e;
    }
    // The node owns this blob now. Cleanup of completed upload records must not delete it.
    return id;
  });
}
async function replaceContent(account, id, expected, staged) {
  return locked("account:" + account, async () => {
    const row = await owned(account, id);
    if (
      row.folder ||
      row.blob_id !== expected.blob ||
      row.modified_at !== expected.modified
    )
      throw fail("office.errors.conflict", 409);
    const modified = Math.max(Date.now(), row.modified_at + 1);
    await db.transaction(async (run) => {
      const result = await run(
        "UPDATE file_nodes SET blob_id=?,key_enc=?,size=?,modified_at=? WHERE id=? AND account_id=? AND blob_id=? AND modified_at=? AND deleted_at IS NULL",
        [
          staged.id,
          staged.key_enc,
          staged.size,
          modified,
          id,
          account,
          expected.blob,
          expected.modified,
        ],
      );
      if (result.changes !== 1) throw fail("office.errors.conflict", 409);
      await run(
        "UPDATE file_uploads SET state='completed',result_id=? WHERE id=?",
        [id, staged.id],
      );
    });
    await fs.rm(blobPath(row.blob_id), { force: true }).catch(() => {});
    return { blob: staged.id, modified };
  });
}
module.exports = {
  replaceContent,
  initFiles,
  cleanup,
  limits,
  CHUNK_SIZE,
  name,
  parts,
  blobPath,
  owned,
  folder,
  used,
  list,
  mkdir,
  ancestors,
  change,
  remove,
  restore,
  begin,
  upload,
  chunk,
  readBlob,
  finishLocal,
  publicNode,
  locked,
};
