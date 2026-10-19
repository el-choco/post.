const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "post-identity-"));
process.env.DATA_DIR = temp;
process.env.ONLYOFFICE_ENABLED = "true";
process.env.ONLYOFFICE_JWT_SECRET =
  "identity-test-only-secret-at-least-32-characters";
process.env.ONLYOFFICE_URL = "http://127.0.0.1:9999";
process.env.ONLYOFFICE_INTERNAL_URL = "http://127.0.0.1:9999";
process.env.ONLYOFFICE_CALLBACK_BASE_URL = "http://127.0.0.1:9998";
const db = require("../src/db"),
  storage = require("../src/filesStorage"),
  office = require("../src/office");
const { encrypt, decrypt, sha256 } = require("../src/crypto");
const identity = require("../src/identity"),
  imap = require("../src/imap");
const discovery = require("../src/autodiscover"),
  network = require("../src/filesNetwork");
const cfg = (email) => ({
  imap: { host: "imap.test", port: 993, secure: true, user: email },
  smtp: { host: "smtp.test", port: 465, secure: true, user: email },
});
let server,
  base,
  admin,
  a,
  b,
  adminId,
  aId,
  bId,
  ownerWorkspace,
  sharedFolder,
  fileId,
  group,
  editSession,
  legacyFile,
  legacyCloud,
  legacyCloudCipher,
  legacyCalendar;
const password = "a very long post password";
async function call(route, token, body, method, headers = {}) {
  const response = await fetch(base + "/api" + route, {
    method: method || (body ? "POST" : "GET"),
    headers: {
      ...(token ? { Authorization: "Bearer " + token } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    redirect: "manual",
  });
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: response.status, data, headers: response.headers };
}
const login = async (email) => {
  const r = await call("/login", null, { email, password });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data.token;
};
async function approve(id, values = {}) {
  const result = await call(
    "/admin/users/" + id,
    admin,
    {
      role: "user",
      status: "active",
      permissions: { mail: true, calendar: true, files: true },
      ...values,
    },
    "PATCH",
  );
  assert.equal(result.status, 200, JSON.stringify(result.data));
}
async function putFile(
  token,
  name,
  parentId,
  source = "local",
  bytes = Buffer.from("%PDF-1.7 private"),
) {
  const start = await call("/files/sources/" + source + "/uploads", token, {
    name,
    parentId,
    size: bytes.length,
    mime: "application/pdf",
  });
  assert.equal(start.status, 200, JSON.stringify(start.data));
  const chunk = await fetch(
    base + "/api/files/uploads/" + start.data.id + "/chunks/0",
    {
      method: "PUT",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/octet-stream",
      },
      body: bytes,
    },
  );
  assert.equal(chunk.status, 200);
  assert.equal(
    (
      await call(
        "/files/uploads/" + start.data.id + "/commit",
        token,
        {},
        "POST",
      )
    ).status,
    202,
  );
  for (let n = 0; n < 100; n++) {
    const row = await call("/files/uploads/" + start.data.id, token);
    if (row.data.state === "completed") return row.data.resultId;
    assert.notEqual(row.data.state, "failed", row.data.error);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("upload did not finish");
}
before(async () => {
  await db.run(
    "CREATE TABLE mail_accounts(id INTEGER PRIMARY KEY AUTOINCREMENT,email TEXT NOT NULL UNIQUE,password_enc TEXT NOT NULL,imap_host TEXT NOT NULL,imap_port INTEGER NOT NULL,imap_secure INTEGER NOT NULL,imap_user TEXT NOT NULL,smtp_host TEXT NOT NULL,smtp_port INTEGER NOT NULL,smtp_secure INTEGER NOT NULL,smtp_user TEXT NOT NULL,settings TEXT NOT NULL DEFAULT '{}',created_at INTEGER NOT NULL)",
  );
  await db.run(
    "INSERT INTO mail_accounts VALUES(1,'legacy@example.test',?,'imap.test',993,1,'legacy@example.test','smtp.test',465,1,'legacy@example.test','{}',?)",
    [encrypt("previous-app-password"), Date.now()],
  );
  await db.run(
    "CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,account_id INTEGER NOT NULL REFERENCES mail_accounts(id),expires_at INTEGER NOT NULL)",
  );
  await db.run("INSERT INTO sessions VALUES(?,?,?)", [
    sha256("old-mail-login"),
    1,
    Date.now() + 3600000,
  ]);
  await db.init();
  await db.run(
    "INSERT INTO contacts(account_id,name,email,book_id) VALUES(1,'Legacy contact','',(SELECT id FROM address_books WHERE account_id=1 AND is_default=1))",
  );
  const staged = await office.stage(
    1,
    "legacy.pdf",
    "application/pdf",
    Buffer.from("%PDF-legacy-content"),
  );
  legacyFile = await storage.finishLocal({ ...staged, parent_id: null });
  await db.run(
    "UPDATE file_uploads SET state='completed',result_id=? WHERE id=?",
    [legacyFile, staged.id],
  );
  legacyCloudCipher = encrypt(
    JSON.stringify({ refresh_token: "legacy-refresh-token" }),
  );
  legacyCloud = (
    await db.run(
      "INSERT INTO file_connections(account_id,kind,name,credentials_enc) VALUES(1,'google','Previous Drive',?)",
      [legacyCloudCipher],
    )
  ).lastID;
  legacyCalendar = (
    await db.run(
      "INSERT INTO calendars(account_id,name,is_default) VALUES(1,'Previous calendar',1)",
    )
  ).lastID;
  await db.run(
    "INSERT INTO calendar_events(id,calendar_id,uid,ics) VALUES('legacy-event',?,'legacy-uid','legacy-ics')",
    [legacyCalendar],
  );
  discovery.resolveAccount = async (email, supplied) => {
    if (supplied !== "previous-app-password")
      throw new Error("bad provider password");
    return cfg(email);
  };
  server = require("../src/index").app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  base = "http://127.0.0.1:" + server.address().port;
});
after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await imap.closeAll();
  await new Promise((resolve) => db.db.close(resolve));
  fs.rmSync(temp, { recursive: true, force: true });
});

test("2.0 migration invalidates old mail sessions and first administrator requires the server setup token", async () => {
  assert.equal((await call("/me", "old-mail-login")).status, 401);
  assert.equal((await call("/auth/status")).data.setup, true);
  const input = {
    email: "admin@example.test",
    name: "Administrator",
    password,
  };
  assert.equal(
    (await call("/register", null, { ...input, setupToken: "guess" })).status,
    403,
  );
  const result = await call("/register", null, {
    ...input,
    setupToken: fs.readFileSync(path.join(temp, "admin-setup-token"), "utf8"),
  });
  assert.equal(result.status, 201);
  admin = result.data.token;
  adminId = result.data.account.id;
  assert.equal(result.data.account.role, "admin");
  assert.equal(result.data.account.hasMail, false);
  assert.equal(fs.existsSync(path.join(temp, "admin-setup-token")), false);
  const row = await db.get("SELECT * FROM users WHERE id=?", [adminId]);
  assert.equal(row.password_hash.includes(password), false);
  assert.equal(
    await identity.verifyPassword(password, row.password_hash),
    true,
  );
  assert.equal(
    await identity.verifyPassword("wrong", row.password_hash),
    false,
  );
  assert.equal(JSON.stringify(result.data).includes(row.password_hash), false);
});
test("registration cannot claim a legacy mailbox by matching its address; new users wait for administrator approval", async () => {
  for (const [email, name] of [
    ["legacy@example.test", "Alice"],
    ["bob@example.test", "Bob"],
  ]) {
    const result = await call("/register", null, { email, name, password });
    assert.equal(result.status, 201);
    assert.equal(result.data.pending, true);
    assert.equal(result.data.token, undefined);
  }
  aId = (await db.get("SELECT id FROM users WHERE name='Alice'")).id;
  bId = (await db.get("SELECT id FROM users WHERE name='Bob'")).id;
  assert.notEqual(
    (await db.get("SELECT workspace_id FROM users WHERE id=?", [aId]))
      .workspace_id,
    1,
  );
  assert.equal(
    (await call("/login", null, { email: "legacy@example.test", password }))
      .status,
    401,
  );
  await approve(aId);
  await approve(bId);
  a = await login("legacy@example.test");
  b = await login("bob@example.test");
  assert.equal((await call("/admin", b)).status, 403);
  const me = await call("/me", b);
  assert.equal(me.data.hasMail, false);
  assert.equal(me.headers.get("cache-control"), "no-store");
  assert.equal((await call("/folders", b)).status, 409);
  assert.equal((await call("/calendar/calendars", b)).status, 200);
  assert.equal((await call("/files/sources/local/items", b)).status, 200);
  assert.equal((await call("/contacts", a)).data.length, 0);
});
test("verified legacy connection keeps existing contacts and storage while own login passwords remain separate", async () => {
  assert.equal(
    (
      await call("/mail/connect", a, {
        email: "legacy@example.test",
        password: "wrong",
      })
    ).status,
    502,
  );
  assert.equal(
    (
      await call("/mail/connect", a, {
        email: "legacy@example.test",
        password: "previous-app-password",
      })
    ).status,
    200,
  );
  ownerWorkspace = (
    await db.get("SELECT workspace_id FROM users WHERE id=?", [aId])
  ).workspace_id;
  assert.equal(ownerWorkspace, 1);
  assert.equal((await call("/me", a)).data.hasMail, true);
  assert.equal((await call("/contacts", a)).data[0].name, "Legacy contact");
  assert.equal(
    (await call("/files/sources/local/items/" + legacyFile + "/content", a))
      .data,
    "%PDF-legacy-content",
  );
  assert.equal(
    (
      await db.get(
        "SELECT credentials_enc FROM file_connections WHERE id=? AND account_id=?",
        [legacyCloud, ownerWorkspace],
      )
    ).credentials_enc,
    legacyCloudCipher,
  );
  assert.equal(
    (
      await db.get(
        "SELECT e.ics FROM calendar_events e JOIN calendars c ON c.id=e.calendar_id WHERE e.id='legacy-event' AND c.account_id=?",
        [ownerWorkspace],
      )
    ).ics,
    "legacy-ics",
  );
  assert.equal(
    (
      await call("/mail/connect", b, {
        email: "legacy@example.test",
        password: "previous-app-password",
      })
    ).status,
    409,
  );
  const row = await db.get("SELECT * FROM users WHERE id=?", [aId]);
  assert.equal(
    await identity.verifyPassword(password, row.password_hash),
    true,
  );
  assert.equal(
    await identity.verifyPassword("previous-app-password", row.password_hash),
    false,
  );
});
test("private files stay private even from administrators; explicit inherited read sharing enables only reads", async () => {
  sharedFolder = (
    await call("/files/sources/local/folders", a, {
      path: "Team",
      parentId: "root",
    })
  ).data.id;
  fileId = await putFile(a, "shared.pdf", sharedFolder);
  assert.equal(
    (await call("/files/sources/local/items/" + fileId + "/content", admin))
      .status,
    404,
  );
  assert.equal(
    (await call("/files/sources/shared/items/" + fileId + "/content", b))
      .status,
    403,
  );
  assert.equal(
    (
      await call(
        "/files/acl/" + sharedFolder,
        b,
        { grants: [{ type: "user", id: bId, rights: 7 }] },
        "PUT",
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await call(
        "/files/acl/" + sharedFolder,
        a,
        { grants: [{ type: "user", id: bId, rights: 1 }] },
        "PUT",
      )
    ).status,
    200,
  );
  const listed = await call("/files/sources/shared/items", b);
  assert.equal(listed.data.items[0].id, sharedFolder);
  const inside = await call(
    "/files/sources/shared/items?parent=" + sharedFolder,
    b,
  );
  assert.equal(inside.data.items[0].id, fileId);
  assert.equal(inside.data.canWrite, false);
  assert.equal(
    (await call("/files/sources/shared/items/" + fileId + "/content", b)).data,
    "%PDF-1.7 private",
  );
  assert.equal(
    (
      await call(
        "/files/sources/shared/items/" + fileId,
        b,
        { name: "unauthorized.pdf" },
        "PATCH",
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await call("/office/sessions", b, {
        source: "shared",
        itemId: fileId,
        mode: "edit",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await call("/office/sessions", b, {
        source: "shared",
        itemId: fileId,
        mode: "view",
      })
    ).status,
    200,
  );
});
test("group membership adds inherited edit rights but does not grant deletion or allow escaping the shared tree", async () => {
  group = (await call("/admin/groups", admin, { name: "Team" })).data.id;
  assert.equal(
    (await call("/admin/groups/" + group, admin, { members: [bId] }, "PUT"))
      .status,
    200,
  );
  assert.equal(
    (
      await call(
        "/files/acl/" + sharedFolder,
        a,
        {
          grants: [
            { type: "user", id: bId, rights: 1 },
            { type: "group", id: group, rights: 3 },
          ],
        },
        "PUT",
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await call(
        "/files/sources/shared/items/" + fileId,
        b,
        { name: "edited.pdf" },
        "PATCH",
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await call("/files/sources/shared/items/" + fileId + "/trash", b, {
        confirm: true,
      })
    ).status,
    403,
  );
  const outside = (
    await call("/files/sources/local/folders", a, {
      path: "Private",
      parentId: "root",
    })
  ).data.id;
  assert.equal(
    (
      await call(
        "/files/sources/shared/items/" + fileId,
        b,
        { parentId: outside },
        "PATCH",
      )
    ).status,
    403,
  );
  const uploaded = await putFile(b, "from-bob.pdf", sharedFolder, "shared");
  assert.equal(
    (await db.get("SELECT account_id FROM file_nodes WHERE id=?", [uploaded]))
      .account_id,
    ownerWorkspace,
  );
  assert.equal(
    (await call("/files/sources/local/items/" + uploaded + "/content", b))
      .status,
    404,
  );
  editSession = await call("/office/sessions", b, {
    source: "shared",
    itemId: fileId,
    mode: "edit",
  });
  assert.equal(editSession.status, 200);
});
test("revocation is checked again for existing download tickets and ONLYOFFICE documents and saves", async () => {
  const ticket = await call(
    "/files/sources/shared/items/" + fileId + "/download",
    b,
    {},
  );
  assert.equal(ticket.status, 200);
  await call("/admin/groups/" + group, admin, { members: [] }, "PUT");
  const session = await db.get("SELECT * FROM office_sessions WHERE id=?", [
    editSession.data.id,
  ]);
  await assert.rejects(
    office.save(session, {
      status: 2,
      filetype: "pdf",
      url: "http://127.0.0.1:9999/cache/files/test/output.pdf",
    }),
    /multiuser.forbidden/,
  );
  await call("/files/acl/" + sharedFolder, a, { grants: [] }, "PUT");
  const downloaded = await fetch(base + ticket.data.url);
  assert.equal(downloaded.status, 403);
  const doc = new URL(editSession.data.config.document.url);
  assert.equal((await fetch(base + doc.pathname + doc.search)).status, 403);
  assert.equal(
    (await call("/files/sources/shared/items", b)).data.items.length,
    0,
  );
  assert.equal(
    (await storage.owned(ownerWorkspace, fileId)).name,
    "edited.pdf",
  );
});
test("mail OAuth uses provider mail scopes, PKCE, single-use session-bound state and encrypted refresh tokens", async () => {
  assert.equal((await call("/mail/connection", a, {}, "DELETE")).status, 200);
  const setup = {
    baseUrl: base,
    clientId: "test-client",
    clientSecret: "test-secret",
    tenant: "common",
  };
  const saved = await call("/mail/oauth/google/config", a, setup);
  assert.equal(saved.status, 200);
  assert.equal(JSON.stringify(saved.data).includes("test-secret"), false);
  const started = await call(
    "/mail/oauth/google/start",
    a,
    { email: "alice@gmail.com" },
    "POST",
    { Origin: base },
  );
  assert.equal(started.status, 200);
  const url = new URL(started.data.url);
  assert.equal(url.searchParams.get("scope"), "https://mail.google.com/");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  const state = url.searchParams.get("state"),
    cookie = started.headers.get("set-cookie").split(";")[0];
  const query = "/mail/oauth/google/callback?state=" + state + "&code=test";
  assert.equal((await call(query)).status, 400);
  let exchanges = 0;
  const previousJson = network.json,
    previousClient = imap.makeClient;
  network.json = async (target, options) => {
    exchanges++;
    const params = new URLSearchParams(options.body);
    assert.equal(params.get("client_secret"), "test-secret");
    return {
      access_token: "mail-access",
      refresh_token: "mail-refresh",
      expires_in: 3600,
    };
  };
  imap.makeClient = (account) => ({
    async connect() {
      assert.equal(account.imap_user, "alice@gmail.com");
      assert.equal(account.accessToken, "mail-access");
    },
    close() {},
  });
  try {
    const callback = await call(query, null, undefined, "GET", {
      Cookie: cookie,
    });
    assert.equal(callback.status, 302);
    assert.match(callback.headers.get("location"), /mailResult=connected/);
    assert.equal(
      (await call(query, null, undefined, "GET", { Cookie: cookie })).status,
      400,
    );
    const token = await db.get(
      "SELECT * FROM mail_oauth_tokens WHERE account_id=?",
      [ownerWorkspace],
    );
    assert.equal(token.credentials_enc.includes("mail-access"), false);
    assert.equal(token.credentials_enc.includes("mail-refresh"), false);
    const creds = JSON.parse(decrypt(token.credentials_enc));
    creds.expiresAt = 0;
    await db.run(
      "UPDATE mail_oauth_tokens SET credentials_enc=? WHERE account_id=?",
      [encrypt(JSON.stringify(creds)), ownerWorkspace],
    );
    const account = await db.get("SELECT * FROM mail_accounts WHERE id=?", [
      ownerWorkspace,
    ]);
    assert.equal(
      await require("../src/mailOAuth").access(account),
      "mail-access",
    );
    assert.equal(exchanges, 2);
    const microsoft = require("../src/mailOAuth").config("microsoft", setup);
    assert.match(microsoft.scope, /outlook.office.com\/IMAP.AccessAsUser.All/);
    assert.match(microsoft.scope, /SMTP.Send/);
    assert.equal(microsoft.scope.includes("graph.microsoft.com"), false);
    const again = await call("/mail/oauth/google/start", a, {
      email: "alice@gmail.com",
    });
    const canceledState = new URL(again.data.url).searchParams.get("state");
    await call("/logout", a, {});
    assert.equal(
      (
        await call(
          "/mail/oauth/google/callback?code=test&state=" + canceledState,
          null,
          undefined,
          "GET",
          { Cookie: again.headers.get("set-cookie").split(";")[0] },
        )
      ).status,
      400,
    );
    assert.equal(exchanges, 2);
    a = await login("legacy@example.test");
  } finally {
    network.json = previousJson;
    imap.makeClient = previousClient;
  }
});
test("feature restrictions and disabled users are enforced server-side and revoke existing sessions", async () => {
  await approve(bId, {
    permissions: { mail: true, calendar: true, files: false },
  });
  b = await login("bob@example.test");
  assert.equal(
    (
      await call("/attachment/save", b, {
        folder: "INBOX",
        uid: 1,
        index: 0,
        source: "local",
        name: "test.pdf",
      })
    ).status,
    403,
  );
  await approve(bId, {
    permissions: { mail: false, calendar: true, files: false },
  });
  assert.equal((await call("/me", b)).status, 401);
  b = await login("bob@example.test");
  assert.equal((await call("/files/sources", b)).status, 403);
  assert.equal((await call("/office/config", b)).status, 403);
  assert.equal((await call("/mail/config", b)).status, 403);
  assert.equal((await call("/messages", b)).status, 403);
  assert.equal((await call("/calendar/calendars", b)).status, 200);
  await approve(bId, { status: "disabled" });
  assert.equal((await call("/me", b)).status, 401);
  assert.equal(
    (await call("/login", null, { email: "bob@example.test", password }))
      .status,
    401,
  );
  assert.equal(
    (
      await call(
        "/admin/users/" + adminId,
        admin,
        { role: "user", status: "active" },
        "PATCH",
      )
    ).status,
    409,
  );
});
test("password changes revoke other sessions and registration can be closed without affecting existing users", async () => {
  const second = await login("admin@example.test");
  assert.equal(
    (
      await call("/account/password", admin, {
        currentPassword: password,
        password: "new long administrator password",
      })
    ).status,
    200,
  );
  assert.equal((await call("/me", second)).status, 401);
  assert.equal((await call("/me", admin)).status, 200);
  assert.equal(
    (await call("/admin/registration", admin, { enabled: false }, "PUT"))
      .status,
    200,
  );
  assert.equal((await call("/auth/status")).data.registration, false);
  assert.equal(
    (
      await call("/register", null, {
        email: "late@example.test",
        name: "Late",
        password,
      })
    ).status,
    403,
  );
  assert.equal(
    (await call("/admin/users/" + bId, admin, { confirm: true }, "DELETE"))
      .status,
    200,
  );
  assert.equal(
    await db.get("SELECT id FROM users WHERE id=?", [bId]),
    undefined,
  );
});
