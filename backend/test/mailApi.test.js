const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "post-mail-api-"));
process.env.DATA_DIR = temp;
const db = require("../src/db"),
  { encrypt, sha256 } = require("../src/crypto");
const imap = require("../src/imap"),
  { invalidate } = require("../src/cache");
const original = imap.withImap;
let server,
  base,
  revision = 1n,
  fetchCount = 0,
  listCount = 0,
  fail = false;
const calls = [];
const attachment = Buffer.from("%PDF test attachment");
const mime = Buffer.from(
  [
    "From: Sender <sender@example.test>",
    "To: a@example.test",
    "Subject: Test mail",
    "MIME-Version: 1.0",
    'Content-Type: multipart/mixed; boundary="test-boundary"',
    "",
    "--test-boundary",
    "Content-Type: text/plain; charset=utf-8",
    "",
    "Hello mail preview.",
    "--test-boundary",
    'Content-Type: application/pdf; name="test.pdf"',
    'Content-Disposition: attachment; filename="test.pdf"',
    "Content-Transfer-Encoding: base64",
    "",
    attachment.toString("base64"),
    "--test-boundary--",
    "",
  ].join("\r\n"),
);
function client(id) {
  return {
    mailbox: { exists: 1000000 },
    async list(options) {
      listCount++;
      assert.equal(options.statusQuery, undefined);
      return [
        { path: "INBOX", name: "INBOX", delimiter: "/", flags: new Set() },
        {
          path: "Projects",
          name: "Projects",
          delimiter: "/",
          flags: new Set(),
        },
      ];
    },
    async getMailboxLock() {
      return { release() {} };
    },
    async status(folder) {
      assert.equal(folder, "INBOX");
      return {
        messages: 1000000,
        unseen: 5,
        uidNext: 1000001,
        uidValidity: 1n,
        highestModseq: revision,
      };
    },
    async search() {
      throw new Error("Unfiltered list must not issue SEARCH ALL");
    },
    async *fetch(range, fields, options) {
      fetchCount++;
      assert.equal(options.uid, false);
      assert.equal(range, "999976:1000000");
      for (let uid = 999976; uid <= 1000000; uid++)
        yield {
          uid,
          envelope: { subject: `Account ${id}`, date: new Date(uid * 1000) },
          flags: new Set(revision > 1n ? ["\\Flagged"] : []),
          bodyStructure: { disposition: "attachment" },
          size: 100,
        };
    },
    async fetchOne() {
      return { source: mime, flags: new Set() };
    },
  };
}
before(async () => {
  await db.init();
  for (const [email, token] of [
    ["a@example.test", "a"],
    ["b@example.test", "b"],
  ]) {
    const row = await db.run(
      "INSERT INTO mail_accounts(email,password_enc,imap_host,imap_port,imap_secure,imap_user,smtp_host,smtp_port,smtp_secure,smtp_user,settings,created_at) VALUES(?,?,?,993,1,?,?,465,1,?,?,?)",
      [
        email,
        encrypt("test-only"),
        "imap.test",
        email,
        "smtp.test",
        email,
        JSON.stringify({ checkAllFolders: false }),
        Date.now(),
      ],
    );
    await db.run(
      "INSERT INTO sessions(token_hash,account_id,expires_at) VALUES(?,?,?)",
      [sha256(token), row.lastID, Date.now() + 60000],
    );
  }
  imap.withImap = async (account, fn, options = {}) => {
    calls.push(options);
    if (fail) {
      const e = new Error("mailTimeout");
      e.code = "IMAP_TIMEOUT";
      e.status = 504;
      throw e;
    }
    return fn(client(account.id));
  };
  const { app } = require("../src/index");
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  base = "http://127.0.0.1:" + server.address().port;
});
after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  imap.withImap = original;
  await new Promise((resolve) => db.db.close(resolve));
  fs.rmSync(temp, { recursive: true, force: true });
});
const call = (url, token = "a") =>
  fetch(base + "/api" + url, { headers: { Authorization: "Bearer " + token } });
test("production list endpoint uses bounded sequence fetching, account-scoped caching and folder counts", async () => {
  const response = await call("/messages?pageSize=25");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("x-request-id"), /^[0-9a-f-]{36}$/);
  const data = await response.json();
  assert.equal(data.total, 1000000);
  assert.equal(data.messages.length, 25);
  assert.equal(data.folderStatus.unseen, 5);
  assert.equal(data.messages[0].subject, "Account 1");
  assert.equal(calls.at(-1).read, true);
  const count = fetchCount;
  await (await call("/messages?pageSize=25")).json();
  assert.equal(fetchCount, count);
  assert.equal(
    (await (await call("/messages?pageSize=25", "b")).json()).messages[0]
      .subject,
    "Account 2",
  );
  assert.equal((await call("/messages", "invalid")).status, 401);
});
test("folder tree avoids status scans and disabled all-folder polling only checks INBOX", async () => {
  const folders = await (await call("/folders")).json();
  assert.equal(folders[0].unseen, 5);
  assert.equal(calls.at(-1).background, true);
  const listsBefore = listCount,
    readsBefore = fetchCount;
  const poll = await (await call("/poll")).json();
  assert.equal(poll.changed, false);
  assert.equal(poll.states.length, 1);
  assert.equal(poll.states[0].folder, "INBOX");
  assert.equal(listCount, listsBefore);
  assert.equal(calls.at(-1).background, true);
  await (await call("/messages?pageSize=25")).json();
  assert.equal(fetchCount, readsBefore);
});
test("a flag-only provider change invalidates metadata while unchanged polling preserves it", async () => {
  revision++;
  assert.equal((await (await call("/poll")).json()).changed, true);
  assert.equal(
    (await (await call("/messages?pageSize=25")).json()).messages[0].flagged,
    true,
  );
  const before = fetchCount;
  assert.equal((await (await call("/poll")).json()).changed, false);
  await (await call("/messages?pageSize=25")).json();
  assert.equal(fetchCount, before);
});
test("mail preview and attachment downloads preserve MIME content and filenames", async () => {
  const preview = await (
    await call("/message?folder=INBOX&uid=12&peek=1")
  ).json();
  assert.match(preview.text, /Hello mail preview/);
  assert.equal(preview.attachments[0].filename, "test.pdf");
  assert.equal(calls.at(-1).read, true);
  assert.ok(calls.at(-1).signal);
  const download = await call("/attachment?folder=INBOX&uid=12&index=0");
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), attachment);
});
test("read timeouts return JSON with a traceable request ID rather than a generic proxy page", async () => {
  fail = true;
  invalidate(1);
  const response = await call("/messages?pageSize=25");
  const data = await response.json();
  assert.equal(response.status, 504);
  assert.equal(data.error, "mailTimeout");
  assert.equal(data.requestId, response.headers.get("x-request-id"));
  fail = false;
});
