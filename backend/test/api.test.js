const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
process.env.DATA_DIR = fs.mkdtempSync(
  path.join(os.tmpdir(), "post-webmail-test-"),
);
const { parseConfig } = require("../src/autodiscover");
const { groupItems } = require("../src/imap");
const folderList = [
  { path: "INBOX", name: "INBOX", specialUse: "\\Inbox" },
  { path: "Archive", name: "Archive", specialUse: "\\Archive" },
  { path: "Trash", name: "Trash", specialUse: "\\Trash" },
];
const operations = [];
let currentFolder = "";
let sentMail;
let mailSentCount = 0;
let searchCalls = 0;
const draftSources = new Map();
const receivedSources = new Map();
let appendedUid = 900;
const client = {
  capabilities: new Map([["UIDPLUS", true]]),
  getMailboxLock: async (folder) => {
    currentFolder = folder;
    return { release() {} };
  },
  search: async (query) => {
    searchCalls++;
    return query.text && query.text !== "Reuse"
      ? [1]
      : Array.from({ length: 12 }, (_, i) => i + 1);
  },
  async *fetch(uids) {
    for (const uid of uids)
      yield {
        uid,
        envelope: {
          subject: `Mail ${uid}`,
          from: [{ name: "Sender", address: "sender@example.org" }],
          to: [{ address: "alex@example.org" }],
          date: new Date(2026, 0, uid),
        },
        size: 1024,
        flags: new Set(),
        bodyStructure: {},
      };
  },
  fetchOne: async (uid, fields) =>
    fields?.headers
      ? { headers: draftSources.get(Number(uid)) || Buffer.alloc(0) }
      : {
          source:
            receivedSources.get(Number(uid)) ||
            Buffer.from(
              'From: Sender <sender@example.org>\r\nTo: alex@example.org\r\nDisposition-Notification-To: sender@example.org\r\nSubject: Test\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<p>Hello</p><script>alert(1)</script><img src="https://example.org/tracker.png">',
            ),
          flags: new Set(),
        },
  messageFlagsAdd: async (uids, flags) =>
    operations.push({ type: "flags", folder: currentFolder, uids, flags }),
  messageFlagsRemove: async () => {},
  messageMove: async (uids, dest) =>
    operations.push({ type: "move", folder: currentFolder, uids, dest }),
  messageDelete: async (uids) =>
    operations.push({ type: "delete", folder: currentFolder, uids }),
  append: async (folder, raw, flags) => {
    const uid = ++appendedUid;
    draftSources.set(uid, raw);
    operations.push({ type: "append", folder, uid, flags });
    return { uid, uidValidity: 100 };
  },
  mailboxCreate: async (path) => {
    operations.push({ type: "createFolder", path });
    folderList.push({
      path,
      name: path.split(".").at(-1),
      delimiter: ".",
      selectable: true,
    });
  },
  mailboxSubscribe: async () => {},
  status: async () => ({
    messages: 12,
    unseen: 4,
    uidNext: 13,
    uidValidity: 100,
  }),
  mailboxDelete: async (path) => {
    operations.push({ type: "deleteFolder", path });
    folderList.splice(
      folderList.findIndex((folder) => folder.path === path),
      1,
    );
  },
};
require.cache[require.resolve("../src/imap")].exports = {
  withImap: async (acc, fn) => fn(client),
  listFolders: async () => folderList,
  findSpecial: (rows, use) => rows.find((f) => f.specialUse === use),
  groupItems,
};
require.cache[require.resolve("../src/autodiscover")].exports = {
  resolveAccount: async (email) => ({
    imap: { host: "imap.example.org", port: 993, secure: true, user: email },
    smtp: { host: "smtp.example.org", port: 465, secure: true, user: email },
  }),
};
require("nodemailer").createTransport = () => ({
  sendMail: async (mail) => {
    sentMail = mail;
    mailSentCount++;
  },
  close() {},
});
const { app, sanitizeMailHtml } = require("../src/index");
const { init, db, get } = require("../src/db");
let server, base, token, otherToken;
const request = async (url, body, method = "GET", session = token) => {
  const res = await fetch(base + url, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(session ? { Authorization: `Bearer ${session}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, data: await res.json() };
};
test.before(async () => {
  await init();
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  token = (
    await request(
      "/api/login",
      { email: "alex@example.org", password: "test-secret" },
      "POST",
      null,
    )
  ).data.token;
  otherToken = (
    await request(
      "/api/login",
      { email: "other@example.org", password: "other-secret" },
      "POST",
      null,
    )
  ).data.token;
});
test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await new Promise((resolve) => db.close(resolve));
  fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
});
test("authentication and encrypted SQLite credentials", async () => {
  assert.equal((await request("/api/me", null, "GET", null)).status, 401);
  assert.equal((await request("/api/me")).data.email, "alex@example.org");
  const account = await get("SELECT * FROM mail_accounts WHERE email=?", [
    "alex@example.org",
  ]);
  assert.ok(
    account.password_enc && !account.password_enc.includes("test-secret"),
  );
});

test("received attachments remain visible with original MIME indexes and download intact", async () => {
  const uid = 4242;
  const raw = [
    "From: Sender <sender@example.org>",
    "To: alex@example.org",
    "Subject: Attachments",
    "MIME-Version: 1.0",
    'Content-Type: multipart/related; boundary="received-attachments"',
    "",
    "--received-attachments",
    "Content-Type: text/html; charset=utf-8",
    "",
    '<p>Documents</p><img src="cid:logo">',
    "--received-attachments",
    "Content-Type: image/png; name=logo.png",
    "Content-Disposition: inline; filename=logo.png",
    "Content-ID: <logo>",
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from("test image bytes").toString("base64"),
    "--received-attachments",
    "Content-Type: application/pdf; name=document.pdf",
    "Content-Disposition: attachment; filename=document.pdf",
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from("%PDF-1.4\nDocument bytes").toString("base64"),
    "--received-attachments",
    "Content-Type: application/pdf; name=inline-document.pdf",
    "Content-Disposition: inline; filename=inline-document.pdf",
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from("%PDF-1.4\nInline document bytes").toString("base64"),
    "--received-attachments--",
    "",
  ].join("\r\n");
  receivedSources.set(uid, Buffer.from(raw));
  try {
    const mail = await request(`/api/message?folder=INBOX&uid=${uid}&peek=1`);
    assert.equal(mail.status, 200);
    assert.equal(mail.data.seen, false);
    assert.deepEqual(
      mail.data.attachments.map((a) => [a.index, a.filename]),
      [
        [0, "logo.png"],
        [1, "document.pdf"],
        [2, "inline-document.pdf"],
      ],
    );
    assert.equal(mail.data.attachments[0].inline, true);
    for (const [index, content] of [
      [0, "test image bytes"],
      [1, "%PDF-1.4\nDocument bytes"],
      [2, "%PDF-1.4\nInline document bytes"],
    ]) {
      const response = await fetch(
        `${base}/api/attachment?folder=INBOX&uid=${uid}&index=${index}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      assert.equal(response.status, 200);
      assert.match(response.headers.get("content-disposition"), /^attachment;/);
      assert.equal(await response.text(), content);
    }
    assert.equal(
      (await request(`/api/attachment?folder=INBOX&uid=${uid}&index=9`)).status,
      404,
    );
    assert.equal(
      (
        await request(
          `/api/attachment?folder=INBOX&uid=${uid}&index=1`,
          null,
          "GET",
          null,
        )
      ).status,
      401,
    );
  } finally {
    receivedSources.delete(uid);
  }
});
test("settings persist and validate page size, language, and reply-to", async () => {
  let saved = await request(
    "/api/settings",
    {
      pageSize: 35,
      archiveFolder: "Archive",
      hiddenFolders: ["Trash"],
      signature: "Regards",
      name: "Alex",
    },
    "PUT",
  );
  assert.equal(saved.data.pageSize, 35);
  assert.equal((await request("/api/settings")).data.signature, "Regards");
  assert.equal(
    (await request("/api/settings", { replyTo: "bad-address" }, "PUT")).status,
    400,
  );
  assert.equal(
    (await request("/api/settings", null, "GET", otherToken)).data
      .archiveFolder,
    "",
  );
});
test("mailbox pagination returns requested page and real total", async () => {
  const response = await request(
    "/api/messages?folder=INBOX&page=2&pageSize=5",
  );
  assert.equal(response.data.total, 12);
  assert.equal(response.data.messages.length, 5);
  assert.deepEqual(
    response.data.messages.map((m) => m.uid),
    [7, 6, 5, 4, 3],
  );
});
test("cross-folder search paginates and keeps folder-specific message identity", async () => {
  const response = await request("/api/search?q=Mail&pageSize=5");
  assert.equal(response.data.total, 3);
  assert.equal(response.data.messages.length, 3);
  assert.equal(new Set(response.data.messages.map((m) => m.folder)).size, 3);
  assert.equal(new Set(response.data.messages.map((m) => m.uid)).size, 1);
});
test("bulk operations group equal UIDs by folder", async () => {
  operations.length = 0;
  const response = await request(
    "/api/messages/move",
    {
      items: [
        { folder: "INBOX", uid: 1 },
        { folder: "Trash", uid: 1 },
      ],
      dest: "Archive",
    },
    "POST",
  );
  assert.equal(response.status, 200);
  assert.equal(operations.length, 2);
  assert.deepEqual(
    operations.map((op) => op.folder),
    ["INBOX", "Trash"],
  );
});
test("archive setting required; deletion moves to trash", async () => {
  assert.equal(
    (
      await request(
        "/api/messages/archive",
        { items: [{ folder: "INBOX", uid: 1 }] },
        "POST",
        otherToken,
      )
    ).data.code,
    "no_archive",
  );
  operations.length = 0;
  await request(
    "/api/messages/delete",
    { items: [{ folder: "INBOX", uid: 2 }] },
    "POST",
  );
  assert.equal(operations.find((op) => op.type === "move").dest, "Trash");
  assert.deepEqual(operations.find((op) => op.type === "flags").flags, [
    "\\Seen",
  ]);
});
test("mail rendering removes scripts and blocks remote images", async () => {
  const response = await request("/api/message?folder=INBOX&uid=1");
  assert.equal(response.status, 200);
  assert.ok(!response.data.html.includes("<script"));
  assert.equal(response.data.remoteImagesBlocked, true);
  const clean = sanitizeMailHtml(
    '<img src="https://example.org/image.png"><a href="javascript:alert(1)">bad</a>',
    false,
    {},
  );
  assert.ok(!clean.html.includes("javascript:"));
  assert.ok(!/<img[^>]*\ssrc="https:\/\//.test(clean.html));
  assert.equal(
    sanitizeMailHtml('<img src="//example.org/tracker.png">', false, {})
      .blocked,
    true,
  );
});
test("contacts belong to their own authenticated account", async () => {
  const contact = await request(
    "/api/contacts",
    { name: "Mia", email: "mia@example.org" },
    "POST",
  );
  assert.equal(contact.status, 200);
  assert.equal(
    (await request("/api/contacts", null, "GET", otherToken)).data.length,
    0,
  );
  await request(
    `/api/contacts/${contact.data.id}`,
    { name: "Updated", email: "mia@example.org" },
    "PUT",
    otherToken,
  );
  assert.equal((await request("/api/contacts")).data[0].name, "Mia");
  await request(`/api/contacts/${contact.data.id}`, null, "DELETE");
  assert.equal((await request("/api/contacts")).data.length, 0);
});
test("send creates MIME email with CC, BCC, identity and attachment", async () => {
  const response = await request(
    "/api/send",
    {
      to: ["mia@example.org"],
      cc: ["cc@example.org"],
      bcc: ["bcc@example.org"],
      subject: "Hello",
      text: "Body",
      attachments: [
        {
          filename: "test.txt",
          content: Buffer.from("attachment content").toString("base64"),
        },
      ],
    },
    "POST",
  );
  assert.equal(response.status, 200);
  assert.deepEqual(sentMail.envelope.to, [
    "mia@example.org",
    "cc@example.org",
    "bcc@example.org",
  ]);
  const parsed = await require("mailparser").simpleParser(sentMail.raw);
  assert.equal(parsed.subject, "Hello");
  assert.equal(parsed.from.value[0].name, "Alex");
  assert.equal(parsed.attachments[0].content.toString(), "attachment content");
  assert.equal(
    (await request("/api/send", { to: ["bad"] }, "POST")).status,
    400,
  );
});
test("autoconfig replaces username placeholders and refuses plaintext", () => {
  const xml = (socket) =>
    `<incomingServer type="imap"><hostname>imap.%EMAILDOMAIN%</hostname><port>993</port><socketType>${socket}</socketType><username>%EMAILLOCALPART%</username></incomingServer><outgoingServer type="smtp"><hostname>smtp.example.org</hostname><port>587</port><socketType>STARTTLS</socketType><username>%EMAILADDRESS%</username></outgoingServer>`;
  assert.equal(parseConfig(xml("SSL"), "alex@example.org").imap.user, "alex");
  assert.equal(parseConfig(xml("plain"), "alex@example.org"), null);
  assert.equal(
    groupItems([
      { folder: "INBOX", uid: 0 },
      { folder: "INBOX", uid: 1 },
    ]).get("INBOX").length,
    1,
  );
});

test("subfolder creation uses server delimiter and recursive deletion protects system folders", async () => {
  folderList.push({
    path: "2026",
    name: "2026",
    delimiter: ".",
    selectable: true,
  });
  const created = await request(
    "/api/folders",
    { name: "09", parent: "2026" },
    "POST",
  );
  assert.equal(created.status, 200);
  assert.equal(created.data.path, "2026.09");
  assert.equal(
    (await request("/api/folders", { name: "10", parent: "unknown" }, "POST"))
      .status,
    404,
  );
  assert.equal(
    (await request("/api/folders", { path: "INBOX", confirm: true }, "DELETE"))
      .status,
    403,
  );
  assert.equal(
    (await request("/api/folders", { path: "2026" }, "DELETE")).status,
    400,
  );
  operations.length = 0;
  const deleted = await request(
    "/api/folders",
    { path: "2026", confirm: true },
    "DELETE",
  );
  assert.equal(deleted.status, 200);
  assert.deepEqual(
    operations.filter((op) => op.type === "deleteFolder").map((op) => op.path),
    ["2026.09", "2026"],
  );
});
test("address book import skips exact duplicates, scopes ownership and cascades deletion", async () => {
  const books = await request("/api/address-books");
  const defaultId = books.data[0].id;
  assert.equal(
    (
      await request(
        "/api/address-books/" + defaultId,
        { confirm: true },
        "DELETE",
      )
    ).status,
    403,
  );
  const book = (
    await request("/api/address-books", { name: "Google Import" }, "POST")
  ).data;
  const contacts = [
    { name: "Mia", email: "mia@example.org", phone: "123", note: "One" },
    { name: "Mia", email: "MIA@example.org", phone: "123", note: "One" },
  ];
  const imported = await request(
    "/api/contacts/import",
    { bookId: book.id, contacts },
    "POST",
  );
  assert.equal(imported.data.imported, 1);
  assert.equal(imported.data.duplicates, 1);
  assert.equal(
    (await request("/api/contacts?bookId=" + book.id)).data.length,
    1,
  );
  assert.equal(
    (
      await request(
        "/api/contacts/import",
        { bookId: book.id, contacts },
        "POST",
        otherToken,
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await request(
        "/api/contacts/import",
        { bookId: book.id, contacts: [{ email: "invalid" }] },
        "POST",
      )
    ).status,
    400,
  );
  await init();
  assert.equal(
    (await request("/api/contacts?bookId=" + book.id)).data[0].name,
    "Mia",
  );
  const repeat = await request(
    "/api/contacts/import",
    { bookId: book.id, contacts },
    "POST",
  );
  assert.equal(repeat.data.imported, 0);
  await request("/api/address-books/" + book.id, { confirm: true }, "DELETE");
  assert.equal((await request("/api/contacts")).data.length, 0);
});
test("CSV import saves phone/name-only contacts, shared emails and optional exact duplicates", async () => {
  const { importPreview } = await import("../../frontend/src/lib/csv.js");
  const { contactImportKey } =
    await import("../../frontend/src/lib/contactImport.js");
  const { normalizeProfile } = require("../src/contactProfile");
  const { contactImportKey: serverKey } = require("../src/contactImport");
  const contacts = importPreview(
    "Name,Email,Phone\nAda,shared@example.org,0123\nBob,shared@example.org,0456\nPhone contact,,0789\nName contact,,\n,other@example.org,\n,,00123\nAda,SHARED@example.org,0123",
  ).contacts;
  assert.ok(
    contacts.every(
      (c) => contactImportKey(c) === serverKey(normalizeProfile(c)),
    ),
  );
  const book = (
    await request("/api/address-books", { name: "Phone Import" }, "POST")
  ).data;
  const body = { bookId: book.id, contacts };
  const first = await request("/api/contacts/import", body, "POST");
  assert.equal(first.status, 200);
  assert.deepEqual(first.data, { imported: 6, duplicates: 1 });
  const stored = (await request("/api/contacts?bookId=" + book.id)).data;
  assert.equal(stored.length, 6);
  assert.equal(stored.filter((c) => !c.email).length, 3);
  assert.equal(
    stored.filter((c) => c.email.toLowerCase() === "shared@example.org").length,
    2,
  );
  assert.deepEqual((await request("/api/contacts/import", body, "POST")).data, {
    imported: 0,
    duplicates: 7,
  });
  const forced = await request(
    "/api/contacts/import",
    { ...body, skipDuplicates: false },
    "POST",
  );
  assert.deepEqual(forced.data, { imported: 7, duplicates: 0 });
  assert.equal(
    (await request("/api/contacts?bookId=" + book.id)).data.length,
    13,
  );
  const concurrent = await Promise.all([
    request(
      "/api/contacts/import",
      { bookId: book.id, contacts: [{ name: "Concurrent", phone: "999" }] },
      "POST",
    ),
    request(
      "/api/contacts/import",
      { bookId: book.id, contacts: [{ name: "Concurrent", phone: "999" }] },
      "POST",
    ),
  ]);
  assert.ok(concurrent.every((r) => r.status === 200));
  assert.equal(
    concurrent.reduce((n, r) => n + r.data.imported, 0),
    1,
  );
  await request("/api/address-books/" + book.id, { confirm: true }, "DELETE");
});
test(
  "optional local CSV fixture imports every contact into isolated SQLite",
  {
    skip: !process.env.CONTACT_IMPORT_FIXTURE,
  },
  async () => {
    const { parseCsv, importPreview, decodeCsv } =
      await import("../../frontend/src/lib/csv.js");
    const text = decodeCsv(fs.readFileSync(process.env.CONTACT_IMPORT_FIXTURE));
    const preview = importPreview(text);
    const expected = parseCsv(text).length - 1;
    assert.equal(preview.contacts.length, expected);
    assert.equal(preview.skipped, 0);
    const book = (
      await request("/api/address-books", { name: "Local CSV Fixture" }, "POST")
    ).data;
    const body = { bookId: book.id, contacts: preview.contacts };
    const result = await request("/api/contacts/import", body, "POST");
    assert.equal(result.status, 200);
    assert.equal(result.data.imported, expected);
    const stored = (await request("/api/contacts?bookId=" + book.id)).data;
    assert.equal(stored.length, expected);
    assert.equal(
      stored.filter((c) => !c.email).length,
      preview.contacts.filter((c) => !c.email).length,
    );
    assert.equal(
      stored.reduce((n, c) => n + c.profile.phones.length, 0),
      preview.contacts.reduce((n, c) => n + c.profile.phones.length, 0),
    );
    assert.equal(
      (await request("/api/contacts/import", body, "POST")).data.imported,
      0,
    );
    // Print aggregate counts only; fixture contents never appear in test output.
    console.log(
      `Local CSV: ${expected} contacts saved; ${result.data.duplicates} skipped.`,
    );
    await request("/api/address-books/" + book.id, { confirm: true }, "DELETE");
  },
);
test("search index is reused on page changes and refresh explicitly invalidates caches", async () => {
  await request("/api/refresh", {}, "POST");
  const first = await request("/api/search?q=Reuse&pageSize=5&page=1");
  const callsAfterFirstPage = searchCalls;
  const second = await request("/api/search?q=Reuse&pageSize=5&page=2");
  assert.equal(first.data.total, 36);
  assert.equal(second.data.total, 36);
  assert.equal(second.data.messages.length, 5);
  assert.equal(searchCalls, callsAfterFirstPage);
  assert.notDeepEqual(
    first.data.messages.map((m) => [m.folder, m.uid]),
    second.data.messages.map((m) => [m.folder, m.uid]),
  );
  assert.equal((await request("/api/refresh", {}, "POST")).data.success, true);
  await request("/api/search?q=Reuse&pageSize=5&page=1");
  assert.equal(searchCalls, callsAfterFirstPage + 3);
});
test("external image policy and delayed reads are respected by the API", async () => {
  operations.length = 0;
  await request(
    "/api/settings",
    { markReadDelay: 5, externalImages: "ask" },
    "PUT",
  );
  let mail = await request("/api/message?folder=INBOX&uid=3");
  assert.equal(mail.data.remoteImagesBlocked, true);
  assert.equal(operations.filter((op) => op.type === "flags").length, 0);
  await request("/api/settings", { externalImages: "always" }, "PUT");
  mail = await request("/api/message?folder=INBOX&uid=3");
  assert.equal(mail.data.remoteImagesBlocked, false);
  assert.match(mail.data.html, /src="https:\/\/example.org\/tracker.png"/);
  await request("/api/settings", { externalImages: "never" }, "PUT");
  mail = await request("/api/message?folder=INBOX&uid=3&images=1");
  assert.equal(mail.data.remoteImagesBlocked, true);
  await request(
    "/api/settings",
    { markReadDelay: 0, externalImages: "ask" },
    "PUT",
  );
});
test("custom special folders, deleted flags and permanent-delete confirmation are effective", async () => {
  operations.length = 0;
  await request(
    "/api/settings",
    { trashFolder: "Archive", readOnDelete: false },
    "PUT",
  );
  await request(
    "/api/messages/delete",
    { items: [{ folder: "INBOX", uid: 4 }] },
    "POST",
  );
  assert.equal(operations[0].dest, "Archive");
  operations.length = 0;
  await request(
    "/api/settings",
    { flagDeleted: true, hideDeleted: true },
    "PUT",
  );
  await request(
    "/api/messages/delete",
    { items: [{ folder: "INBOX", uid: 4 }] },
    "POST",
  );
  assert.deepEqual(operations[0].flags, ["\\Deleted"]);
  assert.equal(operations.length, 1);
  await request("/api/settings", { flagDeleted: false }, "PUT");
  assert.equal(
    (
      await request(
        "/api/messages/delete",
        { items: [{ folder: "Archive", uid: 4 }] },
        "POST",
      )
    ).status,
    409,
  );
  await request(
    "/api/settings",
    { trashFolder: "", readOnDelete: true, hideDeleted: false },
    "PUT",
  );
});
test("archive creates year/month destination and moves each message only once", async () => {
  operations.length = 0;
  await request(
    "/api/settings",
    { archiveStructure: "month", timezone: "Europe/Berlin" },
    "PUT",
  );
  assert.equal(
    (
      await request(
        "/api/messages/archive",
        { items: [{ folder: "INBOX", uid: 8 }] },
        "POST",
      )
    ).status,
    200,
  );
  const move = operations.find((op) => op.type === "move");
  assert.equal(move.dest, "Archive/2026/01");
  assert.deepEqual(
    operations.filter((op) => op.type === "createFolder").map((op) => op.path),
    ["Archive/2026", "Archive/2026/01"],
  );
  folderList.splice(3);
  await request("/api/settings", { archiveStructure: "none" }, "PUT");
});
test("contact profiles and group memberships persist with account isolation", async () => {
  const book = (
    await request("/api/address-books", { name: "Detailed" }, "POST")
  ).data;
  const group = (
    await request(
      "/api/contact-groups",
      { bookId: book.id, name: "Family" },
      "POST",
    )
  ).data;
  const contact = (
    await request(
      "/api/contacts",
      {
        bookId: book.id,
        name: "Dr Ada",
        profile: {
          prefix: "Dr",
          firstName: "Ada",
          lastName: "Example",
          emails: [
            { type: "home", value: "ada@example.org" },
            { type: "work", value: "ada.work@example.org" },
          ],
          phones: [{ type: "mobile", value: "0123" }],
          addresses: [
            {
              type: "home",
              street: "Test street",
              city: "Berlin",
              postalCode: "12345",
              country: "DE",
            },
          ],
          birthday: "1990-01-01",
        },
        groupIds: [group.id],
      },
      "POST",
    )
  ).data;
  const rows = (await request("/api/contacts?bookId=" + book.id)).data;
  assert.equal(rows[0].profile.emails.length, 2);
  assert.equal(rows[0].profile.addresses[0].city, "Berlin");
  assert.deepEqual(
    (await request("/api/contact-groups?bookId=" + book.id)).data[0].contactIds,
    [contact.id],
  );
  assert.equal(
    (
      await request(
        "/api/contact-groups?bookId=" + book.id,
        null,
        "GET",
        otherToken,
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await request(
        "/api/contacts",
        { bookId: book.id, name: "Phone only", phone: "01234" },
        "POST",
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await request(
        "/api/contacts",
        {
          bookId: book.id,
          name: "Bad photo",
          profile: { photo: "data:image/svg+xml;base64,PHN2Zz4=" },
        },
        "POST",
      )
    ).status,
    400,
  );
  await request("/api/contact-groups/" + group.id, null, "DELETE");
  assert.equal(
    (await request("/api/contacts?bookId=" + book.id)).data.length,
    2,
  );
  await request("/api/address-books/" + book.id, { confirm: true }, "DELETE");
});
test("drafts are recoverable in SQLite and isolated between accounts", async () => {
  await request(
    "/api/draft",
    {
      to: "ada@example.org",
      text: "Recover me",
      format: "html",
      html: "<b>Recover me</b>",
    },
    "PUT",
  );
  assert.equal((await request("/api/draft")).data.text, "Recover me");
  assert.equal(
    (await request("/api/draft", null, "GET", otherToken)).data,
    null,
  );
  await request("/api/draft", null, "DELETE");
  assert.equal((await request("/api/draft")).data, null);
});
test("poll returns stable UID identifiers and destructive logout requires confirmation", async () => {
  const result = await request("/api/poll");
  assert.equal(result.data.states.length, 3);
  assert.equal(result.data.states[0].uidValidity, "100");
  await request("/api/settings", { emptyTrashOnLogout: "30" }, "PUT");
  assert.equal((await request("/api/logout", {}, "POST")).status, 409);
  assert.equal((await request("/api/me")).status, 200);
  await request("/api/settings", { emptyTrashOnLogout: "never" }, "PUT");
});
test("draft autosave updates only its own marked IMAP draft and send supports HTML and receipt requests", async () => {
  folderList.push({
    path: "Drafts",
    name: "Drafts",
    specialUse: "\\Drafts",
    delimiter: "/",
  });
  operations.length = 0;
  assert.equal(
    (
      await request(
        "/api/draft",
        { to: "ada@example.org", text: "First draft" },
        "PUT",
      )
    ).data.mailboxSaved,
    true,
  );
  const first = operations.find((op) => op.type === "append").uid;
  assert.equal(
    (
      await request(
        "/api/draft",
        { to: "ada@example.org", text: "Second draft" },
        "PUT",
      )
    ).data.mailboxSaved,
    true,
  );
  assert.equal(operations.filter((op) => op.type === "delete").length, 1);
  assert.equal(
    operations.find((op) => op.type === "delete").uids,
    String(first),
  );
  const sent = await request(
    "/api/send",
    {
      to: ["ada@example.org"],
      text: "Hello",
      html: "<p><b>Hello</b><script>bad()</script></p>",
      requestMdn: true,
      requestDsn: true,
    },
    "POST",
  );
  assert.equal(sent.status, 200);
  const parsed = await require("mailparser").simpleParser(sentMail.raw);
  assert.match(parsed.html, /<b>Hello<\/b>/);
  assert.ok(!parsed.html.includes("<script"));
  assert.equal(
    parsed.headers.get("disposition-notification-to").value[0].address,
    "alex@example.org",
  );
  assert.deepEqual(sentMail.dsn.notify, ["success", "failure", "delay"]);
  assert.equal((await request("/api/draft")).data, null);
  folderList.pop();
});
test("read receipts require confirmation, are sent once and respect Never", async () => {
  const mail = await request("/api/message?folder=INBOX&uid=10&peek=1");
  assert.equal(mail.data.receiptRequested, true);
  assert.equal(mail.data.receiptTo, "sender@example.org");
  const before = mailSentCount;
  assert.equal(
    (
      await request(
        "/api/messages/receipt",
        { folder: "INBOX", uid: 10 },
        "POST",
      )
    ).status,
    400,
  );
  assert.equal(mailSentCount, before);
  assert.equal(
    (
      await request(
        "/api/messages/receipt",
        { folder: "INBOX", uid: 10, confirm: true },
        "POST",
      )
    ).status,
    200,
  );
  assert.equal(mailSentCount, before + 1);
  assert.match(
    sentMail.raw.toString(),
    /Disposition: manual-action\/MDN-sent-manually; displayed/,
  );
  assert.equal(
    (
      await request(
        "/api/messages/receipt",
        { folder: "INBOX", uid: 10, confirm: true },
        "POST",
      )
    ).data.alreadySent,
    true,
  );
  assert.equal(mailSentCount, before + 1);
  await request("/api/settings", { sendReceipts: "never" }, "PUT");
  assert.equal(
    (await request("/api/message?folder=INBOX&uid=10&peek=1")).data
      .receiptRequested,
    false,
  );
  await request("/api/settings", { sendReceipts: "ask" }, "PUT");
});
test("logout invalidates the session", async () => {
  assert.equal((await request("/api/logout", {}, "POST")).status, 200);
  assert.equal((await request("/api/me")).status, 401);
});
