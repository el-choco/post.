const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises"),
  fsSync = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { Readable } = require("node:stream");
const express = require("express");
const tmp = fsSync.mkdtempSync(path.join(os.tmpdir(), "post-office-test-"));
process.env.DATA_DIR = tmp;
process.env.ONLYOFFICE_ENABLED = "true";
process.env.ONLYOFFICE_JWT_SECRET =
  "test-only-secret-with-at-least-32-characters";
const db = require("../src/db"),
  storage = require("../src/filesStorage"),
  office = require("../src/office"),
  cloud = require("../src/filesCloud"),
  net = require("../src/filesNetwork"),
  officeNet = require("../src/officeNetwork");
const { encrypt, decrypt } = require("../src/crypto");
let appServer, docServer, base, docBase;
let output = Buffer.from("%PDF-1.7 edited");
before(async () => {
  await db.init();
  for (const email of ["a@test.example", "b@test.example"])
    await db.run(
      "INSERT INTO mail_accounts(email,password_enc,imap_host,imap_port,imap_secure,imap_user,smtp_host,smtp_port,smtp_secure,smtp_user,created_at) VALUES(?,?,?,993,1,?,?,465,1,?,?)",
      [
        email,
        encrypt("fake"),
        "imap.test",
        email,
        "smtp.test",
        email,
        Date.now(),
      ],
    );
  await require("./userFixture.cjs").all(db);
  const app = express();
  app.use(express.json());
  const auth = (req, res, next) => {
    if (!["a", "b"].includes(req.headers.authorization?.slice(7)))
      return res.sendStatus(401);
    req.account = {
      id: req.headers.authorization.slice(7) === "a" ? 1 : 2,
      email: "test@example.com",
    };
    next();
  };
  const wrap = (fn) => (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch(next);
  app.use("/api/office", office.createOfficeRouter(auth, wrap));
  app.use((e, req, res, next) => {
    if (res.headersSent) return next(e);
    res.status(e.status || 500).json({ error: e.message });
  });
  appServer = app.listen(0, "127.0.0.1");
  await new Promise((r) => appServer.once("listening", r));
  base = "http://127.0.0.1:" + appServer.address().port;
  const docs = express();
  docs.get("/cache/files/test/output.pdf", (req, res) =>
    res.type("application/pdf").send(output),
  );
  docServer = docs.listen(0, "127.0.0.1");
  await new Promise((r) => docServer.once("listening", r));
  docBase = "http://127.0.0.1:" + docServer.address().port;
  process.env.ONLYOFFICE_URL = docBase;
  process.env.ONLYOFFICE_INTERNAL_URL = docBase;
  process.env.ONLYOFFICE_CALLBACK_BASE_URL = base;
});
after(async () => {
  await Promise.all([
    new Promise((r) => appServer.close(r)),
    new Promise((r) => docServer.close(r)),
  ]);
  await new Promise((r) => db.db.close(r));
  assert.ok(path.resolve(tmp).startsWith(path.resolve(os.tmpdir()) + path.sep));
  await fs.rm(tmp, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  });
});
async function call(url, body, token = "a", headers = {}) {
  const res = await fetch(
    url.startsWith("http") ? url : base + "/api/office" + url,
    {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
  );
  const bytes = Buffer.from(await res.arrayBuffer());
  return {
    status: res.status,
    bytes,
    data: res.headers.get("content-type")?.includes("application/json")
      ? JSON.parse(bytes)
      : null,
  };
}
let fileCount = 0;
async function file(
  name = "sample-" + ++fileCount + ".pdf",
  bytes = Buffer.from("%PDF-1.7 original"),
) {
  const row = await office.stage(1, name, "application/pdf", bytes);
  const id = await storage.finishLocal({ ...row, parent_id: null });
  await db.run(
    "UPDATE file_uploads SET state='completed',result_id=? WHERE id=?",
    [id, row.id],
  );
  return id;
}
const start = (itemId, mode = "edit") =>
  call("/sessions", { source: "local", itemId, mode, language: "de" });
async function callback(created, status = 2, extra = {}, signed = true) {
  const body = {
    key: created.config.document.key,
    status,
    url: docBase + "/cache/files/test/output.pdf",
    filetype: "pdf",
    ...extra,
  };
  return call(
    created.config.editorConfig.callbackUrl,
    body,
    "unused",
    signed
      ? {
          Authorization:
            "Bearer " +
            office.sign({ payload: body }, process.env.ONLYOFFICE_JWT_SECRET),
        }
      : {},
  );
}
async function bytes(id) {
  const row = await storage.owned(1, id);
  const chunks = [];
  for await (const c of storage.readBlob(row.blob_id, row.key_enc))
    chunks.push(c);
  return Buffer.concat(chunks);
}

test("optional feature remains off without configuration and rejects weak JWT secrets", async () => {
  process.env.ONLYOFFICE_ENABLED = "false";
  assert.equal((await call("/config")).data.enabled, false);
  assert.equal((await start(await file())).status, 503);
  process.env.ONLYOFFICE_ENABLED = "true";
  const secret = process.env.ONLYOFFICE_JWT_SECRET;
  process.env.ONLYOFFICE_JWT_SECRET = "weak";
  assert.equal((await call("/config")).data.enabled, false);
  process.env.ONLYOFFICE_JWT_SECRET = secret;
  assert.equal((await call("/config")).data.enabled, true);
});
test("signed document access is scoped, expiring and snapshot contents remain encrypted", async () => {
  const id = await file(),
    opened = await start(id, "view");
  assert.equal(opened.status, 200);
  const conf = opened.data,
    token = office.verify(conf.config.token, process.env.ONLYOFFICE_JWT_SECRET);
  assert.equal(token.document.key, conf.config.document.key);
  assert.equal(token.document.permissions.edit, false);
  assert.equal(conf.config.documentType, "pdf");
  const read = await call(conf.config.document.url);
  assert.deepEqual(read.bytes, await bytes(id));
  assert.equal((await call("/documents/" + conf.id)).status, 403);
  const wrong = conf.config.document.url.replace(conf.id, "not-owned");
  assert.equal((await call(wrong)).status, 403);
  const row = await db.get("SELECT * FROM office_sessions WHERE id=?", [
    conf.id,
  ]);
  assert.equal(
    (await fs.readFile(storage.blobPath(row.snapshot_id))).includes(read.bytes),
    false,
  );
  assert.equal(
    (await call("/sessions/" + conf.id, undefined, "b")).status,
    404,
  );
  assert.throws(
    () =>
      office.verify(
        office.sign({ exp: 1 }, process.env.ONLYOFFICE_JWT_SECRET),
        process.env.ONLYOFFICE_JWT_SECRET,
      ),
    /office.errors.access/,
  );
  await call("/sessions/" + conf.id + "/close", {});
  assert.equal((await call(conf.config.document.url)).status, 403);
});
test("unsigned callbacks and key substitution cannot overwrite files", async () => {
  const id = await file(),
    opened = (await start(id)).data;
  assert.equal((await callback(opened, 2, {}, false)).status, 403);
  assert.equal((await callback(opened, 2, { key: "foreign" })).status, 403);
  assert.deepEqual(await bytes(id), Buffer.from("%PDF-1.7 original"));
  await callback(opened, 4);
});
test("only the signed callback payload is trusted, never unsigned URL or status fields", async () => {
  const id = await file(),
    opened = (await start(id)).data;
  const signed = { key: opened.config.document.key, status: 4 };
  const result = await call(
    opened.config.editorConfig.callbackUrl,
    { ...signed, status: 2, url: "http://169.254.169.254/latest/meta-data/" },
    "unused",
    {
      Authorization:
        "Bearer " +
        office.sign({ payload: signed }, process.env.ONLYOFFICE_JWT_SECRET),
    },
  );
  assert.equal(result.status, 200);
  assert.deepEqual(await bytes(id), Buffer.from("%PDF-1.7 original"));
});
test("force save and final save update the same encrypted local file without duplicate revisions", async () => {
  const id = await file(),
    opened = (await start(id)).data;
  assert.equal((await start(id)).status, 409);
  output = Buffer.from("%PDF-1.7 version-one");
  assert.equal((await callback(opened, 6)).status, 200);
  assert.deepEqual(await bytes(id), output);
  const first = await storage.owned(1, id);
  assert.equal(first.mime, "application/pdf");
  assert.equal((await callback(opened, 6)).status, 200);
  assert.equal((await storage.owned(1, id)).blob_id, first.blob_id);
  output = Buffer.from("%PDF-1.7 version-two");
  assert.equal((await callback(opened, 6)).status, 200);
  output = Buffer.from("%PDF-1.7 version-one");
  assert.equal((await callback(opened, 6)).status, 200);
  assert.deepEqual(await bytes(id), Buffer.from("%PDF-1.7 version-two"));
  assert.equal((await callback(opened, 2)).status, 200);
  assert.equal((await call("/sessions/" + opened.id)).data.state, "closed");
  assert.equal((await callback(opened, 2)).status, 200);
});
test("view sessions cannot save and legacy formats are explicitly view-only", async () => {
  const id = await file(),
    opened = (await start(id, "view")).data;
  output = Buffer.from("ignored");
  assert.equal((await callback(opened)).status, 200);
  assert.deepEqual(await bytes(id), Buffer.from("%PDF-1.7 original"));
  await call("/sessions/" + opened.id + "/close", {});
  const legacy = await file("legacy.doc");
  assert.equal((await start(legacy)).status, 403);
  assert.equal(
    office.fileType({ name: "invoice.pdf", mime: "application/pdf" })
      .documentType,
    "pdf",
  );
  assert.equal(office.fileType({ name: "sheet.xlsx" }).documentType, "cell");
  assert.equal(office.fileType({ name: "deck.pptx" }).documentType, "slide");
  assert.equal(
    office.fileType({ name: "notes.txt", mime: "text/plain" }),
    null,
  );
  assert.equal(office.fileType({ name: "Google.docx", native: true }), null);
});
test("concurrent original changes preserve an authenticated downloadable recovery copy", async () => {
  const id = await file(),
    opened = (await start(id)).data;
  await storage.change(1, id, { name: "changed.pdf" });
  output = Buffer.from("%PDF-1.7 my-edits");
  assert.equal((await callback(opened)).data.error, 1);
  assert.deepEqual(await bytes(id), Buffer.from("%PDF-1.7 original"));
  const status = (await call("/sessions/" + opened.id)).data;
  assert.equal(status.recovery, true);
  assert.equal(status.error, "office.errors.conflict");
  assert.deepEqual(
    (await call("/sessions/" + opened.id + "/recovery")).bytes,
    output,
  );
  assert.equal(
    (await call("/sessions/" + opened.id + "/recovery", undefined, "b")).status,
    404,
  );
  const row = await db.get("SELECT * FROM office_sessions WHERE id=?", [
    opened.id,
  ]);
  assert.equal(
    (await fs.readFile(storage.blobPath(row.recovery_id))).includes(output),
    false,
  );
  assert.equal(
    (await call("/recoveries")).data.items.some((r) => r.id === opened.id),
    true,
  );
  assert.equal(
    (await call("/recoveries", undefined, "b")).data.items.length,
    0,
  );
  const recovered = await call("/sessions/" + opened.id + "/keep", {
    language: "de",
  });
  assert.equal(recovered.status, 200);
  assert.deepEqual(await bytes(recovered.data.id), output);
  assert.equal((await call("/sessions/" + opened.id)).data.recovery, false);
});
test("callback downloads are confined to document-server cache paths and bounded in size", async () => {
  const cfg = officeNet.config();
  for (const url of [
    "http://169.254.169.254/latest/meta-data/",
    "http://127.0.0.1:3000/api/health",
    docBase + "/api/health",
    docBase + "/cache/files/%2e%2e/api",
  ])
    assert.throws(() => officeNet.savedUrl(url, cfg));
  const id = await file(),
    opened = (await start(id)).data;
  const old = process.env.ONLYOFFICE_MAX_FILE_MB;
  process.env.ONLYOFFICE_MAX_FILE_MB = "1";
  output = Buffer.alloc(1024 ** 2 + 1);
  assert.equal((await callback(opened)).data.error, 1);
  assert.equal(
    (await call("/sessions/" + opened.id)).data.error,
    "office.errors.size",
  );
  assert.deepEqual(await bytes(id), Buffer.from("%PDF-1.7 original"));
  process.env.ONLYOFFICE_MAX_FILE_MB = old || "50";
  await callback(opened, 4);
});
test("format changes keep the original and retain the returned document for recovery", async () => {
  const id = await file(),
    opened = (await start(id)).data;
  output = Buffer.from("converted-document");
  assert.equal((await callback(opened, 2, { filetype: "docx" })).data.error, 1);
  assert.deepEqual(await bytes(id), Buffer.from("%PDF-1.7 original"));
  assert.equal((await call("/sessions/" + opened.id)).data.recovery, true);
});
test("Google Drive and OneDrive write back to the same item with conditional headers", async () => {
  const original = net.request;
  try {
    for (const kind of ["google", "microsoft"]) {
      let version = 1;
      const writes = [];
      const inserted = await db.run(
        "INSERT INTO file_connections(account_id,kind,name,credentials_enc) VALUES(?,?,?,?)",
        [
          1,
          kind,
          kind,
          encrypt(
            JSON.stringify({
              access_token: "fake",
              expiresAt: Date.now() + 3600000,
              rootId: "root",
              oauth: { access: "all" },
            }),
          ),
        ],
      );
      const c = await db.get("SELECT * FROM file_connections WHERE id=?", [
        inserted.lastID,
      ]);
      net.request = async (url, options = {}) => {
        const writing = ["PUT", "PATCH"].includes(options.method);
        if (writing) {
          writes.push({ url, options });
          version++;
        }
        const row =
          kind === "google"
            ? {
                id: "item",
                name: "file.pdf",
                mimeType: "application/pdf",
                size: "12",
                modifiedTime: "2026-10-13T00:00:00Z",
                version: String(version),
                capabilities: { canEdit: true },
              }
            : {
                id: "item",
                name: "file.pdf",
                size: 12,
                file: { mimeType: "application/pdf" },
                eTag: '"v' + version + '"',
                lastModifiedDateTime: "2026-10-13T00:00:00Z",
              };
        const res = Readable.from([Buffer.from(JSON.stringify(row))]);
        res.statusCode = 200;
        res.headers = { etag: '"v' + version + '"' };
        return res;
      };
      const desc = await cloud.officeDescriptor(c, "item");
      const rev = await cloud.officeReplace(
        c,
        "item",
        Buffer.from("new"),
        "pdf",
        desc.revision,
      );
      assert.equal(writes.length, 1);
      assert.equal(writes[0].options.headers["If-Match"], '"v1"');
      assert.equal(writes[0].options.headers.Authorization, "Bearer fake");
      assert.ok(
        writes[0].url.includes(
          kind === "google"
            ? "/files/item?uploadType=media"
            : "/items/item/content",
        ),
      );
      assert.equal(
        kind === "google" ? rev.version : rev.etag,
        kind === "google" ? "2" : '"v2"',
      );
      await assert.rejects(
        () =>
          cloud.officeReplace(
            c,
            "item",
            Buffer.from("late"),
            "pdf",
            desc.revision,
          ),
        /office.errors.conflict/,
      );
      assert.equal(writes.length, 1);
    }
  } finally {
    net.request = original;
  }
});

test("recovering an interrupted replacement never shares a blob between file nodes", async () => {
  const id = await file(),
    opened = (await start(id)).data;
  output = Buffer.from("%PDF-1.7 persisted-before-interruption");
  assert.equal((await callback(opened, 6)).data.error, 0);
  const original = await storage.owned(1, id);
  await db.run("UPDATE office_sessions SET recovery_id=?,error=? WHERE id=?", [
    original.blob_id,
    "office.errors.save",
    opened.id,
  ]);
  const copy = await call("/sessions/" + opened.id + "/keep", {
    language: "en",
  });
  assert.equal(copy.status, 200);
  assert.notEqual(
    (await storage.owned(1, copy.data.id)).blob_id,
    original.blob_id,
  );
  await storage.remove(1, copy.data.id);
  await storage.remove(1, copy.data.id, true);
  assert.deepEqual(await bytes(id), output);
  await callback(opened, 4);
});
test("signed editor callbacks complete cloud saves through the production storage path", async () => {
  const original = net.request;
  try {
    for (const kind of ["google", "microsoft"]) {
      const insert = await db.run(
        "INSERT INTO file_connections(account_id,kind,name,credentials_enc) VALUES(?,?,?,?)",
        [
          1,
          kind,
          kind,
          encrypt(
            JSON.stringify({
              access_token: "cloud-token",
              expiresAt: Date.now() + 3600000,
              rootId: "root",
              oauth: { access: "all" },
            }),
          ),
        ],
      );
      let version = 1,
        content = Buffer.from("%PDF-1.7 cloud-original");
      net.request = async (url, opts = {}) => {
        const writing = ["PATCH", "PUT"].includes(opts.method);
        if (writing) {
          assert.equal(opts.headers["If-Match"], '"rev' + version + '"');
          content = opts.body;
          version++;
        }
        let body;
        if (!writing && (url.includes("alt=media") || url.endsWith("/content")))
          body = content;
        else
          body = Buffer.from(
            JSON.stringify(
              kind === "google"
                ? {
                    id: "cloud-item",
                    name: "cloud.pdf",
                    mimeType: "application/pdf",
                    size: String(content.length),
                    modifiedTime: "2026-10-13T01:00:00Z",
                    version: String(version),
                    capabilities: { canEdit: true },
                  }
                : {
                    id: "cloud-item",
                    name: "cloud.pdf",
                    size: content.length,
                    file: { mimeType: "application/pdf" },
                    lastModifiedDateTime: "2026-10-13T01:00:00Z",
                    eTag: '"rev' + version + '"',
                  },
            ),
          );
        const res = Readable.from([body]);
        res.statusCode = 200;
        res.headers = {
          etag: '"rev' + version + '"',
          "content-length": String(body.length),
        };
        return res;
      };
      const opened = await call("/sessions", {
        source: String(insert.lastID),
        itemId: "cloud-item",
        mode: "edit",
      });
      assert.equal(opened.status, 200);
      output = Buffer.from("%PDF-1.7 saved-back-to-" + kind);
      assert.equal((await callback(opened.data, 6)).data.error, 0);
      assert.deepEqual(content, output);
      assert.equal((await callback(opened.data, 2)).data.error, 0);
      assert.equal(
        (await call("/sessions/" + opened.data.id)).data.state,
        "closed",
      );
    }
  } finally {
    net.request = original;
  }
});
