const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Readable } = require("node:stream");
const tmp = fsSync.mkdtempSync(path.join(os.tmpdir(), "post-files-test-"));
process.env.DATA_DIR = tmp;
process.env.PUBLIC_BASE_URL = "http://localhost:8886";
process.env.GOOGLE_CLIENT_ID = "test-client";
process.env.GOOGLE_CLIENT_SECRET = "test-secret";
const express = require("express"),
  db = require("../src/db"),
  storage = require("../src/filesStorage"),
  oauth = require("../src/filesOAuth"),
  cloud = require("../src/filesCloud"),
  network = require("../src/filesNetwork");
const { encrypt, decrypt, sha256 } = require("../src/crypto");
let server, base;
async function call(
  url,
  body,
  method = body ? "POST" : "GET",
  token = "a",
  headers = {},
) {
  const result = await fetch(base + url, {
    method,
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": Buffer.isBuffer(body)
        ? "application/octet-stream"
        : "application/json",
      ...headers,
    },
    body:
      body === undefined
        ? undefined
        : Buffer.isBuffer(body)
          ? body
          : JSON.stringify(body),
    redirect: "manual",
  });
  const bytes = Buffer.from(await result.arrayBuffer());
  return {
    status: result.status,
    headers: result.headers,
    data: result.headers.get("content-type")?.includes("application/json")
      ? JSON.parse(bytes)
      : bytes,
  };
}
async function upload(name, bytes, parentId = "root", token = "a") {
  const start = await call(
    "/sources/local/uploads",
    { name, size: bytes.length, parentId, mime: "text/plain" },
    "POST",
    token,
  );
  assert.equal(start.status, 200);
  for (
    let offset = 0, index = 0;
    offset < bytes.length;
    offset += start.data.chunkSize, index++
  )
    assert.equal(
      (
        await call(
          `/uploads/${start.data.id}/chunks/${index}`,
          bytes.subarray(offset, offset + start.data.chunkSize),
          "PUT",
          token,
        )
      ).status,
      200,
    );
  assert.equal(
    (await call(`/uploads/${start.data.id}/commit`, {}, "POST", token)).status,
    202,
  );
  for (let count = 0; count < 100; count++) {
    const result = await call(
      "/uploads/" + start.data.id,
      undefined,
      "GET",
      token,
    );
    if (result.data.state === "completed")
      return { id: result.data.resultId, uploadId: start.data.id };
    if (result.data.state === "failed") throw new Error(result.data.error);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Commit did not finish");
}
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
  for (const [token, id] of [
    ["a", 1],
    ["b", 2],
  ])
    await require("./userFixture.cjs").session(db, [
      sha256(token),
      id,
      Date.now() + 3600000,
    ]);
  const app = express();
  app.use(express.json());
  const auth = (req, res, next) => {
    const token = req.headers.authorization?.slice(7);
    if (!["a", "b"].includes(token)) return res.sendStatus(401);
    req.account = { id: token === "a" ? 1 : 2 };
    req.tokenHash = sha256(token);
    next();
  };
  const wrap = (fn) => (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch(next);
  app.use(require("../src/files").createFilesRouter(auth, wrap));
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    res.status(err.status || 500).json({ error: err.message });
  });
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  base = "http://127.0.0.1:" + server.address().port;
});
after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await new Promise((resolve) => db.db.close(resolve));
  assert.ok(path.resolve(tmp).startsWith(path.resolve(os.tmpdir()) + path.sep));
  await fs.rm(tmp, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  });
});
test("first install, account isolation, traversal and folder type checks", async () => {
  assert.equal(
    (await call("/sources", undefined, "GET", "invalid")).status,
    401,
  );
  const created = await call("/sources/local/folders", {
    parentId: "root",
    path: "Documents/2026",
  });
  assert.equal(created.status, 200);
  assert.equal(
    (
      await call(
        "/sources/local/items?parent=" + created.data.id,
        undefined,
        "GET",
        "b",
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await call("/sources/local/folders", {
        parentId: "root",
        path: "../outside",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await call("/sources/local/folders", {
        parentId: "root",
        path: "/absolute",
      })
    ).status,
    400,
  );
  assert.equal(
    (await call("/sources/local/folders", { parentId: "root", path: "a\\b" }))
      .status,
    400,
  );
  const file = await upload("not-a-folder.txt", Buffer.from("hello"));
  assert.equal(
    (await call("/sources/local/folders", { parentId: file.id, path: "child" }))
      .status,
    400,
  );
  const list = await call("/sources/local/items?parent=" + created.data.id);
  assert.equal(list.data.breadcrumbs.length, 2);
});
test("chunked binary uploads round-trip, encrypted staging, no-overwrite and cleanup preservation", async () => {
  const bytes = Buffer.alloc(storage.CHUNK_SIZE + 73, 0xa5);
  bytes.write("PRIVATE FILE CONTENT");
  const result = await upload("large.bin", bytes);
  const raw = await fs.readFile(storage.blobPath(result.uploadId));
  assert.equal(raw.includes(Buffer.from("PRIVATE FILE CONTENT")), false);
  const download = await call("/sources/local/items/" + result.id + "/content");
  assert.deepEqual(download.data, bytes);
  assert.equal(
    download.headers.get("content-type"),
    "application/octet-stream",
  );
  assert.equal(
    (
      await call(
        "/sources/local/items/" + result.id + "/content",
        undefined,
        "GET",
        "b",
      )
    ).status,
    404,
  );
  assert.equal(
    (await call("/sources/local/uploads", { name: "large.bin", size: 5 }))
      .status,
    409,
  );
  await db.run("UPDATE file_uploads SET expires_at=0 WHERE id=?", [
    result.uploadId,
  ]);
  await storage.cleanup();
  assert.deepEqual(
    (await call("/sources/local/items/" + result.id + "/content")).data,
    bytes,
  );
});
test("upload sequencing, cross-account access and size/quota limits cannot be bypassed", async () => {
  const row = await call("/sources/local/uploads", {
    name: "sequence.txt",
    size: 5,
  });
  assert.equal(
    (
      await call(
        "/uploads/" + row.data.id + "/chunks/1",
        Buffer.from("hello"),
        "PUT",
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await call(
        "/uploads/" + row.data.id + "/chunks/0",
        Buffer.from("hello"),
        "PUT",
        "b",
      )
    ).status,
    404,
  );
  assert.equal(
    (await call("/uploads/" + row.data.id + "/commit", {})).status,
    409,
  );
  assert.equal(
    (
      await call(
        "/uploads/" + row.data.id + "/chunks/0",
        Buffer.from("hello"),
        "PUT",
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await call(
        "/uploads/" + row.data.id + "/chunks/0",
        Buffer.from("hello"),
        "PUT",
      )
    ).status,
    409,
  );
  assert.equal(
    (await call("/uploads/" + row.data.id, {}, "DELETE")).status,
    200,
  );
  assert.equal(
    (
      await call("/sources/local/uploads", {
        name: "big.bin",
        size: storage.limits().maxFileSize + 1,
      })
    ).status,
    413,
  );
  process.env.FILES_QUOTA_MB = "1";
  try {
    assert.equal(
      (await call("/sources/local/uploads", { name: "quota.bin", size: 5 }))
        .status,
      507,
    );
  } finally {
    delete process.env.FILES_QUOTA_MB;
  }
});
test("folder moves reject cycles and restore retains complete trees with safe name conflicts", async () => {
  const a = (
    await call("/sources/local/folders", { parentId: "root", path: "tree" })
  ).data;
  const b = (
    await call("/sources/local/folders", { parentId: a.id, path: "child" })
  ).data;
  const f = await upload("inside.txt", Buffer.from("inside"), b.id);
  assert.equal(
    (await call("/sources/local/items/" + a.id, { parentId: b.id }, "PATCH"))
      .status,
    400,
  );
  assert.equal(
    (await call("/sources/local/items/" + a.id + "/trash", { confirm: true }))
      .status,
    200,
  );
  assert.equal(
    (await call("/sources/local/items/" + f.id + "/content")).status,
    404,
  );
  await call("/sources/local/folders", { parentId: "root", path: "tree" });
  assert.equal(
    (await call("/sources/local/items/" + a.id + "/restore", {})).status,
    200,
  );
  const restored = await storage.owned(1, a.id);
  assert.equal(restored.name, "tree (1)");
  assert.equal(
    (await call("/sources/local/items/" + f.id + "/content")).data.toString(),
    "inside",
  );
  assert.equal(
    (await call("/sources/local/items/" + a.id, { confirm: true }, "DELETE"))
      .status,
    400,
  );
  await call("/sources/local/items/" + a.id + "/trash", { confirm: true });
  assert.equal(
    (await call("/sources/local/items/" + a.id, {}, "DELETE")).status,
    400,
  );
  assert.equal(
    (await call("/sources/local/items/" + a.id, { confirm: true }, "DELETE"))
      .status,
    200,
  );
  assert.equal(
    await fs.access(storage.blobPath(f.uploadId)).then(
      () => true,
      () => false,
    ),
    false,
  );
});
test("download tickets expire, are single-use and are invalidated by logout", async () => {
  const file = await upload("ticket.txt", Buffer.from("download"));
  const first = await call("/sources/local/items/" + file.id + "/download", {});
  const url = first.data.url.replace("/api/files", "");
  assert.equal(
    (await call(url, undefined, "GET", "invalid")).data.toString(),
    "download",
  );
  assert.equal((await call(url)).status, 404);
  const second = await call(
    "/sources/local/items/" + file.id + "/download",
    {},
  );
  await db.run("UPDATE file_downloads SET expires_at=0");
  assert.equal(
    (await call(second.data.url.replace("/api/files", ""))).status,
    404,
  );
  const third = await call("/sources/local/items/" + file.id + "/download", {});
  await db.run("DELETE FROM sessions WHERE token_hash=?", [sha256("a")]);
  assert.equal(
    (await call(third.data.url.replace("/api/files", ""))).status,
    404,
  );
  await require("./userFixture.cjs").session(db, [
    sha256("a"),
    1,
    Date.now() + 3600000,
  ]);
});
test("AES-GCM rejects tampering before releasing corrupted plaintext", async () => {
  const file = await upload("tamper.bin", Buffer.from("authenticated content"));
  const row = await storage.owned(1, file.id),
    raw = await fs.readFile(storage.blobPath(row.blob_id));
  raw[raw.length - 1] ^= 1;
  await fs.writeFile(storage.blobPath(row.blob_id), raw);
  let chunks = 0;
  await assert.rejects(async () => {
    for await (const chunk of storage.readBlob(row.blob_id, row.key_enc)) {
      void chunk;
      chunks++;
    }
  });
  assert.equal(chunks, 0);
});
test("file OAuth is separate, uses PKCE/session binding, hides secrets and supports scope choice", async () => {
  await call("/oauth/google/config", {
    baseUrl: "https://files.example.org",
    clientId: "files-client",
    clientSecret: "files-secret",
    access: "all",
  });
  const config = await call("/config");
  assert.equal(config.data.oauthSetup.google.secretSaved, true);
  assert.equal(JSON.stringify(config.data).includes("files-secret"), false);
  assert.equal(
    await db.get("SELECT * FROM calendar_oauth_configs WHERE account_id=1"),
    undefined,
  );
  const start = await call("/oauth/google/start", {}, "POST", "a", {
    Origin: "https://files.example.org",
  });
  assert.equal(start.status, 200);
  const url = new URL(start.data.url);
  assert.equal(
    url.searchParams.get("scope"),
    "https://www.googleapis.com/auth/drive",
  );
  assert.equal(
    url.searchParams.get("redirect_uri"),
    "https://files.example.org/api/files/oauth/google/callback",
  );
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  const state = url.searchParams.get("state"),
    cookie = start.headers.get("set-cookie").split(";")[0];
  const invalid = await call(
    "/oauth/google/callback?state=" + state + "&code=fake",
  );
  assert.equal(invalid.status, 400);
  await db.run("DELETE FROM sessions WHERE token_hash=?", [sha256("a")]);
  assert.equal(
    (
      await call(
        "/oauth/google/callback?state=" + state + "&code=fake",
        undefined,
        "GET",
        "a",
        { Cookie: cookie },
      )
    ).status,
    400,
  );
  await require("./userFixture.cjs").session(db, [
    sha256("a"),
    1,
    Date.now() + 3600000,
  ]);
  assert.equal(
    (
      await call("/oauth/google/start", {}, "POST", "a", {
        Origin: "https://attacker.example",
      })
    ).status,
    400,
  );
});
function response(data, status = 200, headers = {}) {
  const stream = Readable.from([
    Buffer.from(typeof data === "string" ? data : JSON.stringify(data)),
  ]);
  stream.statusCode = status;
  stream.headers = headers;
  return stream;
}
test("zero-byte files, production route mounting and provider network boundaries", async () => {
  const empty = await upload("empty.txt", Buffer.alloc(0));
  const result = await call("/sources/local/items/" + empty.id + "/content");
  assert.equal(result.status, 200);
  assert.equal(result.data.length, 0);
  assert.equal(
    (await call("/sources/local/items/" + empty.id + "/content?preview=1"))
      .status,
    200,
  );
  const app = require("../src/index").app.listen(0, "127.0.0.1");
  await new Promise((resolve) => app.once("listening", resolve));
  try {
    const res = await fetch(
      "http://127.0.0.1:" + app.address().port + "/api/files/sources",
      { headers: { Authorization: "Bearer a" } },
    );
    assert.equal(res.status, 200);
    assert.equal((await res.json()).sources[0].id, "local");
  } finally {
    await new Promise((resolve) => app.close(resolve));
  }
  const previous = process.env.ALLOW_PRIVATE_CALDAV;
  process.env.ALLOW_PRIVATE_CALDAV = "true";
  try {
    await assert.rejects(
      network.request("https://127.0.0.1/secret"),
      /files.errors.remote/,
    );
    await assert.rejects(
      network.request("http://example.org/file"),
      /files.errors.remote/,
    );
    await assert.rejects(
      network.request("https://user:password@example.org/file"),
      /files.errors.remote/,
    );
  } finally {
    if (previous === undefined) delete process.env.ALLOW_PRIVATE_CALDAV;
    else process.env.ALLOW_PRIVATE_CALDAV = previous;
  }
});
test("successful file OAuth and refresh preserve their own encrypted client snapshot", async () => {
  const start = await call("/oauth/google/start", {}, "POST", "a", {
    Origin: "https://files.example.org",
  });
  const state = new URL(start.data.url).searchParams.get("state"),
    cookie = start.headers.get("set-cookie").split(";")[0];
  const oldExchange = oauth.exchange,
    oldDiscover = cloud.discover;
  oauth.exchange = async () => ({
    access_token: "files-access",
    refresh_token: "files-refresh",
    expiresAt: Date.now() - 1,
  });
  cloud.discover = async () => ({
    rootId: "root-files",
    label: "Connected files",
  });
  let connection;
  try {
    const callback = await call(
      "/oauth/google/callback?state=" + state + "&code=fake",
      undefined,
      "GET",
      "a",
      { Cookie: cookie },
    );
    assert.equal(callback.status, 302);
    assert.ok(
      callback.headers
        .get("location")
        .startsWith("https://files.example.org/?view=files&filesConnected="),
    );
    connection = await db.get(
      "SELECT * FROM file_connections WHERE name='Connected files'",
    );
    assert.equal(connection.credentials_enc.includes("files-refresh"), false);
    assert.equal(
      (
        await call(
          "/oauth/google/callback?state=" + state + "&code=fake",
          undefined,
          "GET",
          "a",
          { Cookie: cookie },
        )
      ).status,
      400,
    );
  } finally {
    oauth.exchange = oldExchange;
    cloud.discover = oldDiscover;
  }
  await call("/oauth/google/config", {
    baseUrl: "https://changed.example.org",
    clientId: "new-client",
    clientSecret: "new-secret",
    access: "app",
  });
  const oldJson = network.json;
  network.json = async (url, opts) => {
    assert.equal(url, "https://oauth2.googleapis.com/token");
    const body = new URLSearchParams(opts.body);
    assert.equal(body.get("client_id"), "files-client");
    assert.equal(body.get("client_secret"), "files-secret");
    assert.equal(
      body.get("redirect_uri"),
      "https://files.example.org/api/files/oauth/google/callback",
    );
    return { access_token: "refreshed-files", expires_in: 3600 };
  };
  try {
    const refreshed = await oauth.credentials(connection);
    assert.equal(refreshed.access_token, "refreshed-files");
    assert.equal(refreshed.refresh_token, "files-refresh");
    const saved = JSON.parse(
      decrypt(
        (
          await db.get(
            "SELECT credentials_enc FROM file_connections WHERE id=?",
            [connection.id],
          )
        ).credentials_enc,
      ),
    );
    assert.equal(saved.rootId, "root-files");
    assert.equal(saved.oauth.access, "all");
  } finally {
    network.json = oldJson;
  }
});
test("cloud contract: Google pagination, escaping, folder upload, content and trash", async () => {
  const row = await db.run(
    "INSERT INTO file_connections(account_id,kind,name,credentials_enc) VALUES(1,'google','Drive',?)",
    [
      encrypt(
        JSON.stringify({
          access_token: "cloud-token",
          expiresAt: Date.now() + 3600000,
          rootId: "g-root",
          oauth: { access: "all" },
        }),
      ),
    ],
  );
  const c = await db.get("SELECT * FROM file_connections WHERE id=?", [
      row.lastID,
    ]),
    old = network.request,
    requests = [];
  network.request = async (url, opts = {}) => {
    requests.push({ url, opts });
    const u = new URL(url);
    if (u.pathname.endsWith("/g-root"))
      return response({
        id: "g-root",
        mimeType: "application/vnd.google-apps.folder",
      });
    if (u.pathname.endsWith("/g-file") && u.searchParams.get("alt") === "media")
      return response("cloud download");
    if (u.pathname.endsWith("/g-file"))
      return response({
        id: "g-file",
        name: "file.txt",
        mimeType: "text/plain",
        parents: ["g-root"],
      });
    if (u.pathname.includes("/upload/") && opts.method === "POST")
      return response("", 200, {
        location: "https://www.googleapis.com/upload/session",
      });
    if (u.pathname.endsWith("/session"))
      return response({ id: "uploaded-cloud" });
    if (u.pathname.endsWith("/files") && opts.method === "POST")
      return response({
        id: "new-folder",
        name: "Empty",
        mimeType: "application/vnd.google-apps.folder",
        parents: ["g-root"],
      });
    if (u.searchParams.get("q")?.includes("name="))
      return response({ files: [] });
    return response({
      files: [{ id: "g-file", name: "file.txt", mimeType: "text/plain" }],
      nextPageToken: "next-page",
    });
  };
  try {
    const listed = await cloud.list(c, { query: "O'Reilly", cursor: "page" });
    assert.equal(listed.next, "next-page");
    const request = requests.find((r) =>
      new URL(r.url).searchParams.has("pageToken"),
    );
    assert.ok(
      new URL(request.url).searchParams.get("q").includes("O\\'Reilly"),
    );
    assert.equal((await cloud.mkdir(c, "root", "Empty")).folder, true);
    const downloaded = await cloud.download(c, "g-file");
    assert.equal(await network.collect(downloaded.stream), "cloud download");
    await cloud.remove(c, "g-file");
    assert.deepEqual(JSON.parse(requests.at(-1).opts.body), { trashed: true });
    const staging = await storage.begin(1, String(c.id), {
      name: "upload.txt",
      size: 4,
      parentId: "g-root",
    });
    await storage.chunk(1, staging.id, 0, Buffer.from("data"));
    assert.equal(
      await cloud.upload(
        c,
        await storage.upload(1, staging.id),
        async () => {},
      ),
      "uploaded-cloud",
    );
    assert.equal(
      requests.find((r) => r.url.endsWith("/session")).opts.body.toString(),
      "data",
    );
    assert.equal(
      (await call("/sources/" + c.id + "/items", undefined, "GET", "b")).status,
      404,
    );
  } finally {
    network.request = old;
  }
});
test("cloud contract: OneDrive next-link validation and signed transfers never expose bearer tokens", async () => {
  const row = await db.run(
    "INSERT INTO file_connections(account_id,kind,name,credentials_enc) VALUES(1,'microsoft','OneDrive',?)",
    [
      encrypt(
        JSON.stringify({
          access_token: "ms-token",
          expiresAt: Date.now() + 3600000,
          rootId: "m-root",
          oauth: {},
        }),
      ),
    ],
  );
  const c = await db.get("SELECT * FROM file_connections WHERE id=?", [
      row.lastID,
    ]),
    old = network.request,
    requests = [];
  network.request = async (url, opts = {}) => {
    requests.push({ url, opts });
    const u = new URL(url);
    if (u.host === "cdn.example.org") return response("signed bytes");
    if (u.host === "upload.example.org")
      return response({ id: "ms-upload" }, 201);
    if (u.pathname.endsWith("/content"))
      return response("", 302, { location: "https://cdn.example.org/file" });
    if (u.pathname.endsWith("createUploadSession"))
      return response({ uploadUrl: "https://upload.example.org/session" });
    if (u.pathname.endsWith("/children"))
      return response({
        value: [
          { id: "ms-file", name: "note.txt", file: { mimeType: "text/plain" } },
        ],
        "@odata.nextLink":
          "https://graph.microsoft.com/v1.0/me/drive/items/m-root/children?$skiptoken=x",
      });
    if (u.pathname.endsWith("/ms-file"))
      return response({
        id: "ms-file",
        name: "note.txt",
        file: { mimeType: "text/plain" },
        parentReference: { id: "m-root" },
      });
    if (u.pathname.endsWith("/m-root"))
      return response({ id: "m-root", name: "Root", folder: {} });
    return response("", 404);
  };
  try {
    const listed = await cloud.list(c);
    assert.equal(listed.items[0].name, "note.txt");
    await assert.rejects(
      cloud.list(c, { cursor: "https://attacker.example/steal" }),
    );
    const download = await cloud.download(c, "ms-file");
    assert.equal(await network.collect(download.stream), "signed bytes");
    assert.equal(
      requests.find((r) => r.url.startsWith("https://cdn.")).opts.headers
        ?.Authorization,
      undefined,
    );
    const staging = await storage.begin(1, String(c.id), {
      name: "ms.txt",
      size: 2,
      parentId: "m-root",
    });
    await storage.chunk(1, staging.id, 0, Buffer.from("ms"));
    assert.equal(
      await cloud.upload(
        c,
        await storage.upload(1, staging.id),
        async () => {},
      ),
      "ms-upload",
    );
    assert.equal(
      requests.find((r) => r.url.startsWith("https://upload.")).opts.headers
        .Authorization,
      undefined,
    );
    assert.equal(
      requests.find((r) => r.url.startsWith("https://upload.")).opts.headers[
        "Content-Range"
      ],
      "bytes 0-1/2",
    );
  } finally {
    network.request = old;
  }
});
