const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const tmp = fsSync.mkdtempSync(
  path.join(os.tmpdir(), "post-attachment-files-"),
);
process.env.DATA_DIR = tmp;
const db = require("../src/db");
const storage = require("../src/filesStorage");
const cloud = require("../src/filesCloud");
const imap = require("../src/imap");
const { encrypt, decrypt, sha256 } = require("../src/crypto");
const { saveAttachment, copyName } = require("../src/attachmentFiles");
const originalImap = imap.withImap;
let server, base, folderId, foreignFolder;
const bytes = Buffer.from("%PDF-1.7 attachment from the mailbox");
const attachment = {
  filename: "Rechnung.pdf",
  contentType: "application/pdf",
  content: bytes,
};
const mailRef = ["INBOX", 42, 0];
const mime = Buffer.from(
  [
    "From: sender@example.test",
    "To: first@example.test",
    "Subject: Attachment test",
    'Content-Type: multipart/mixed; boundary="b"',
    "",
    "--b",
    "Content-Type: text/plain",
    "",
    "Test",
    "--b",
    'Content-Type: application/pdf; name="Rechnung.pdf"',
    'Content-Disposition: attachment; filename="Rechnung.pdf"',
    "Content-Transfer-Encoding: base64",
    "",
    bytes.toString("base64"),
    "--b--",
    "",
  ].join("\r\n"),
);
before(async () => {
  await db.init();
  for (const [email, token] of [
    ["first@example.test", "a"],
    ["second@example.test", "b"],
  ]) {
    const row = await db.run(
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
    await require("./userFixture.cjs").session(db, [sha256(token), row.lastID, Date.now() + 3600000]);
  }
  folderId = (await storage.mkdir(1, "root", "Gespeicherte Anhänge")).id;
  foreignFolder = (await storage.mkdir(2, "root", "Private")).id;
  imap.withImap = async (_account, fn) =>
    fn({
      async getMailboxLock() {
        return { release() {} };
      },
      async fetchOne(uid) {
        return Number(uid) === 42 ? { source: mime, flags: new Set() } : false;
      },
    });
  const { app } = require("../src/index");
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  base = "http://127.0.0.1:" + server.address().port;
});
after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await require("../src/diagnostics").flush();
  imap.withImap = originalImap;
  await new Promise((resolve) => db.db.close(resolve));
  await fs.rm(tmp, { recursive: true, force: true });
});
async function call(body, token = "a") {
  const response = await fetch(base + "/api/attachment/save", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      folder: "INBOX",
      uid: 42,
      index: 0,
      source: "local",
      parentId: folderId,
      ...body,
    }),
  });
  return { status: response.status, body: await response.json() };
}
async function content(id) {
  const row = await storage.owned(1, id),
    chunks = [];
  for await (const chunk of storage.readBlob(row.blob_id, row.key_enc))
    chunks.push(chunk);
  return Buffer.concat(chunks);
}

test("the production mail API saves exact MIME attachment bytes into encrypted private storage", async () => {
  const result = await call({
    content: "browser-supplied data must be ignored",
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.name, "Rechnung.pdf");
  assert.equal(result.body.parentId, folderId);
  const row = await storage.owned(1, result.body.id);
  assert.equal(row.mime, "application/pdf");
  assert.deepEqual(await content(row.id), bytes);
  assert.ok(
    !(await fs.readFile(storage.blobPath(row.blob_id))).includes(bytes),
  );
  assert.equal((await db.get("SELECT COUNT(*) AS n FROM file_uploads")).n, 0);
});

test("conflicts ask first, copies preserve the original, and confirmed replacement keeps the item ID", async () => {
  const conflict = await call({});
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.code, "ATTACHMENT_NAME_CONFLICT");
  assert.equal(conflict.body.conflict.canReplace, true);
  const old = (await storage.list(1, { parent: folderId })).items.find(
    (row) => row.name === "Rechnung.pdf",
  );
  const copy = await call({ mode: "copy" });
  assert.equal(copy.status, 200);
  assert.equal(copy.body.name, "Rechnung (1).pdf");
  assert.notEqual(copy.body.id, old.id);
  const different = {
    ...attachment,
    content: Buffer.from("replacement bytes"),
    contentType: "text/plain",
  };
  let offered;
  try {
    await saveAttachment(1, different, { parentId: folderId }, mailRef);
  } catch (e) {
    offered = e.conflict;
  }
  const replaced = await saveAttachment(
    1,
    different,
    { parentId: folderId, mode: "replace", conflictToken: offered.token },
    mailRef,
  );
  assert.equal(replaced.id, old.id);
  assert.deepEqual(await content(old.id), different.content);
  assert.equal((await storage.owned(1, old.id)).mime, "text/plain");
  assert.deepEqual(await content(copy.body.id), bytes);
});

test("replacement confirmations reject tampering, changed attachments, other targets, expiry and intervening writes", async () => {
  const conflict = (await call({})).body.conflict;
  for (const body of [
    { mode: "replace", conflictToken: "forged" },
    { mode: "replace", conflictToken: conflict.token, name: "Other.pdf" },
    { mode: "replace", conflictToken: conflict.token, parentId: "root" },
    {
      mode: "replace",
      conflictToken: encrypt(
        JSON.stringify({ ...JSON.parse(decrypt(conflict.token)), expires: 0 }),
      ),
    },
  ])
    assert.equal((await call(body)).status, 409);
  await assert.rejects(
    saveAttachment(
      1,
      { ...attachment, content: Buffer.from("changed MIME bytes") },
      { parentId: folderId, mode: "replace", conflictToken: conflict.token },
      mailRef,
    ),
    /attachmentSave.confirmAgain/,
  );
  const row = (await storage.list(1, { parent: folderId })).items.find(
    (item) => item.name === "Rechnung.pdf",
  );
  await db.run("UPDATE file_nodes SET modified_at=modified_at+1 WHERE id=?", [
    row.id,
  ]);
  const changed = await call({
    mode: "replace",
    conflictToken: conflict.token,
  });
  assert.equal(changed.status, 409);
  assert.equal(changed.body.error, "attachmentSave.changed");
  assert.ok(changed.body.conflict.token);
});

test("authentication, account ownership, path validation and missing attachments are enforced", async () => {
  assert.equal((await call({}, "bad")).status, 401);
  assert.equal((await call({}, "b")).status, 404);
  assert.equal((await call({ parentId: foreignFolder })).status, 404);
  for (const name of [
    "../escape.pdf",
    "bad/file.pdf",
    "bad\\file.pdf",
    "bad\u0000.pdf",
  ])
    assert.equal((await call({ name })).status, 400);
  assert.equal((await call({ index: -1 })).status, 400);
  assert.equal((await call({ index: 10 })).status, 404);
  assert.equal((await call({ uid: 99 })).body.code, "MESSAGE_NOT_FOUND");
  assert.equal((await db.get("SELECT COUNT(*) AS n FROM file_uploads")).n, 0);
});

test("folders cannot be overwritten and concurrent copy saves choose distinct names", async () => {
  await storage.mkdir(1, folderId, "Folder.pdf");
  const folder = await call({ name: "Folder.pdf" });
  assert.equal(folder.status, 409);
  assert.equal(folder.body.conflict.canReplace, false);
  const copies = await Promise.all([
    call({ mode: "copy" }),
    call({ mode: "copy" }),
  ]);
  assert.ok(copies.every((result) => result.status === 200));
  assert.equal(new Set(copies.map((result) => result.body.name)).size, 2);
});

test("size/quota failures and interrupted staging leave no partial uploads", async () => {
  process.env.FILES_MAX_UPLOAD_MB = "1";
  try {
    await assert.rejects(
      saveAttachment(
        1,
        { ...attachment, content: Buffer.alloc(1024 ** 2 + 1) },
        { name: "large.pdf", parentId: folderId },
        mailRef,
      ),
      { status: 413 },
    );
  } finally {
    delete process.env.FILES_MAX_UPLOAD_MB;
  }
  process.env.FILES_QUOTA_MB = "1";
  try {
    await assert.rejects(
      saveAttachment(
        1,
        { ...attachment, content: Buffer.alloc(1024 ** 2) },
        { name: "quota.pdf", parentId: folderId },
        mailRef,
      ),
      { status: 507 },
    );
  } finally {
    delete process.env.FILES_QUOTA_MB;
  }
  const original = storage.chunk;
  storage.chunk = async () => {
    throw new Error("simulated disk failure");
  };
  try {
    await assert.rejects(
      saveAttachment(
        1,
        attachment,
        { name: "interrupted.pdf", parentId: folderId },
        mailRef,
      ),
      /disk failure/,
    );
  } finally {
    storage.chunk = original;
  }
  assert.equal((await db.get("SELECT COUNT(*) AS n FROM file_uploads")).n, 0);
});

test("zero-byte attachments and long Unicode copy names are preserved safely", async () => {
  const saved = await saveAttachment(
    1,
    { ...attachment, filename: "empty.txt", content: Buffer.alloc(0) },
    { parentId: folderId },
    mailRef,
  );
  assert.equal((await content(saved.id)).length, 0);
  const name = "ä".repeat(115) + ".pdf";
  assert.ok(Buffer.byteLength(copyName(name, 1000)) <= 240);
  assert.ok(copyName(name, 1000).endsWith(" (1000).pdf"));
});

test("a provider failure removes encrypted staging and cannot leave a partial private file", async () => {
  const row = await db.run(
    "INSERT INTO file_connections(account_id,kind,name,credentials_enc) VALUES(?,?,?,?)",
    [1, "google", "failing", encrypt("{}")],
  );
  const original = {
    folder: cloud.folder,
    findChild: cloud.findChild,
    upload: cloud.upload,
  };
  const before = (
    await fs.readdir(
      path.dirname(storage.blobPath("00000000-0000-0000-0000-000000000000")),
    )
  ).sort();
  cloud.folder = async () => "target";
  cloud.findChild = async () => null;
  cloud.upload = async () => {
    throw new Error("simulated provider failure");
  };
  try {
    await assert.rejects(
      saveAttachment(1, attachment, { source: String(row.lastID) }, mailRef),
      /provider failure/,
    );
  } finally {
    Object.assign(cloud, original);
  }
  assert.equal((await db.get("SELECT COUNT(*) AS n FROM file_uploads")).n, 0);
  assert.deepEqual(
    (
      await fs.readdir(
        path.dirname(storage.blobPath("00000000-0000-0000-0000-000000000000")),
      )
    ).sort(),
    before,
  );
});

test("Google Drive and OneDrive use owned connections, encrypted staging and conditional replacement", async () => {
  const originals = Object.fromEntries(
    ["folder", "findChild", "officeDescriptor", "upload", "replaceFile"].map(
      (key) => [key, cloud[key]],
    ),
  );
  try {
    for (const kind of ["google", "microsoft"]) {
      const row = await db.run(
        "INSERT INTO file_connections(account_id,kind,name,credentials_enc) VALUES(?,?,?,?)",
        [1, kind, kind, encrypt("{}")],
      );
      const sourceId = String(row.lastID);
      let stored,
        version = 1;
      cloud.folder = async (conn) => {
        assert.equal(conn.account_id, 1);
        return "provider-folder";
      };
      cloud.findChild = async () => (stored ? { id: "provider-file" } : null);
      cloud.officeDescriptor = async () => ({
        item: { id: "provider-file", name: attachment.filename, folder: false },
        revision: { etag: '"v' + version + '"' },
      });
      cloud.upload = async (conn, staged) => {
        assert.equal(conn.kind, kind);
        assert.equal(staged.parent_id, "provider-folder");
        assert.ok(
          !(await fs.readFile(storage.blobPath(staged.id))).includes(bytes),
        );
        const chunks = [];
        for await (const chunk of storage.readBlob(staged.id, staged.key_enc))
          chunks.push(chunk);
        stored = Buffer.concat(chunks);
        return "provider-file";
      };
      cloud.replaceFile = async (conn, id, content, mimeType, expected) => {
        assert.equal(conn.kind, kind);
        assert.equal(id, "provider-file");
        assert.equal(mimeType, "application/pdf");
        assert.deepEqual(expected, { etag: '"v1"' });
        stored = content;
        version++;
      };
      const saved = await call({ source: sourceId, parentId: "root" });
      assert.equal(saved.status, 200);
      assert.deepEqual(stored, bytes);
      const conflict = await call({ source: sourceId, parentId: "root" });
      assert.equal(conflict.status, 409);
      assert.equal(
        (
          await call({
            source: sourceId,
            parentId: "root",
            mode: "replace",
            conflictToken: conflict.body.conflict.token,
          })
        ).status,
        200,
      );
      assert.equal(version, 2);
      cloud.officeDescriptor = async () => ({
        item: { id: "provider-file", name: attachment.filename, native: true },
        revision: { etag: '"v2"' },
      });
      assert.equal(
        (await call({ source: sourceId })).body.conflict.canReplace,
        false,
      );
      assert.equal(
        (await call({ source: sourceId, parentId: "root" }, "b")).status,
        404,
      );
      assert.equal(
        (await db.get("SELECT COUNT(*) AS n FROM file_uploads")).n,
        0,
      );
    }
  } finally {
    Object.assign(cloud, originals);
  }
});
