const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "post-diagnostics-test-"));
process.env.DATA_DIR = temp;
const db = require("../src/db");
const diagnostics = require("../src/diagnostics");
const { createTrace, runTrace, measure } = require("../src/diagnosticsTrace");
const { createImapPool } = require("../src/imapPool");
const { encrypt, sha256 } = require("../src/crypto");
const imap = require("../src/imap");
const original = imap.withImap;
const id = "12345678-1234-1234-1234-123456789abc";
let server,
  base,
  pool,
  hang = true;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
before(async () => {
  await db.init();
  for (const [email, token] of [
    ["first@example.test", "one"],
    ["second@example.test", "two"],
  ]) {
    const row = await db.run(
      "INSERT INTO mail_accounts(email,password_enc,imap_host,imap_port,imap_secure,imap_user,smtp_host,smtp_port,smtp_secure,smtp_user,settings,created_at) VALUES(?,?,?,993,1,?,?,465,1,?,?,?)",
      [
        email,
        encrypt("private-password"),
        "imap.test",
        email,
        "smtp.test",
        email,
        "{}",
        Date.now(),
      ],
    );
    await db.run(
      "INSERT INTO sessions(token_hash,account_id,expires_at) VALUES(?,?,?)",
      [sha256(token), row.lastID, Date.now() + 300000],
    );
  }
  pool = createImapPool(
    () => ({
      usable: false,
      async connect() {
        this.usable = true;
      },
      close() {
        this.usable = false;
      },
      async logout() {
        this.usable = false;
      },
      async getMailboxLock() {
        return { release() {} };
      },
      async status() {
        return {
          messages: 1,
          unseen: 0,
          uidValidity: 1n,
          uidNext: 2,
          highestModseq: 1n,
        };
      },
      async *fetch() {
        if (hang) await new Promise(() => {});
        yield {
          uid: 1,
          envelope: { subject: "private-subject" },
          flags: new Set(),
          size: 10,
        };
      },
    }),
    90000,
    { foregroundMs: 40 },
  );
  imap.withImap = pool.withImap;
  const { app } = require("../src/index");
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  base = "http://127.0.0.1:" + server.address().port;
});
after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await pool.closeAll();
  await diagnostics.flush();
  imap.withImap = original;
  await new Promise((resolve) => db.db.close(resolve));
  fs.rmSync(temp, { recursive: true, force: true });
});
const call = (route, token = "one", options = {}) =>
  fetch(base + "/api" + route, {
    ...options,
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
    },
  });

test("diagnostics allow only fixed routes, phases, codes and UUIDs, dropping all arbitrary private fields", () => {
  const entry = diagnostics.sanitize({
    route: "/api/messages",
    status: 504,
    durationMs: -50,
    requestId: "secret-token",
    errorCode: "private-password",
    password: "private-password",
    subject: "private-subject",
    query: "private-query",
    stages: [
      {
        phase: "fetch",
        durationMs: 20,
        count: 1,
        active: true,
        folder: "private-folder",
      },
      { phase: "private-folder", durationMs: 30 },
      { phase: "network", durationMs: 10, host: "private-host" },
      {
        phase: "session",
        durationMs: 15,
        user: "private-user",
        password: "private-password",
      },
    ],
  });
  const text = JSON.stringify(entry);
  for (const secret of [
    "private-password",
    "private-subject",
    "private-query",
    "private-folder",
    "secret-token",
    "private-host",
    "private-user",
  ])
    assert.ok(!text.includes(secret));
  assert.equal(entry.durationMs, 0);
  assert.equal(entry.errorCode, "UNKNOWN_ERROR");
  assert.equal(entry.requestId, "");
  assert.equal(entry.stages.length, 3);
  assert.equal(
    diagnostics.sanitize({ route: "/api/messages?folder=private-folder" }),
    null,
  );
  assert.equal(
    diagnostics.sanitize({ route: "/api/calendar/oauth/callback" }),
    null,
  );
});

test("a real production mail timeout is recorded with request ID and the still-active IMAP phase", async () => {
  const response = await call("/messages?folder=private-folder");
  const body = await response.json();
  assert.equal(response.status, 504);
  assert.equal(body.error, "mailTimeout");
  const data = await (await call("/diagnostics")).json();
  const row = data.entries.find((entry) => entry.requestId === body.requestId);
  assert.equal(row.status, 504);
  assert.equal(row.errorCode, "IMAP_TIMEOUT");
  assert.equal(row.source, "backend");
  assert.ok(
    row.stages.some(
      (stage) =>
        stage.phase === "fetch" && stage.active && stage.durationMs >= 20,
    ),
  );
  assert.ok(row.stages.some((stage) => stage.phase === "queue"));
  assert.ok(!JSON.stringify(data).includes("private-folder"));
  hang = false;
  assert.equal((await call("/messages")).status, 200);
  const updated = await (await call("/diagnostics")).json();
  assert.ok(
    updated.entries.some(
      (entry) =>
        entry.status === 200 &&
        entry.stages.some((stage) => stage.phase === "fetch"),
    ),
  );
});

test("logs and exports require authentication and stay scoped to the current account", async () => {
  assert.equal((await call("/diagnostics", "bad")).status, 401);
  assert.equal((await call("/diagnostics/export", "bad")).status, 401);
  await diagnostics.record(2, {
    route: "/api/poll",
    status: 502,
    errorCode: "EAI_AGAIN",
    requestId: id,
    durationMs: 3200,
  });
  const data = await (await call("/diagnostics?accountId=2")).json();
  assert.ok(!data.entries.some((row) => row.requestId === id));
  const exported = await call("/diagnostics/export", "two");
  assert.equal(exported.headers.get("cache-control"), "no-store");
  assert.match(
    exported.headers.get("content-disposition"),
    /post-diagnostics\.json/,
  );
  const payload = await exported.json();
  assert.equal(payload.entries.length, 1);
  assert.equal(payload.entries[0].requestId, id);
  assert.ok(!JSON.stringify(payload).includes("second@example.test"));
});

test("browser reports retain proxy correlation but cannot inject message data, other accounts or stages", async () => {
  const payload = {
    route: "/api/messages",
    status: 504,
    errorCode: "apiTimeout",
    requestId: id,
    durationMs: 45000,
    accountId: 2,
    token: "private-token",
    message: "private-message",
    stages: [{ phase: "fetch", durationMs: 500 }],
  };
  assert.equal(
    (
      await call("/diagnostics/client", "one", {
        method: "POST",
        body: JSON.stringify(payload),
      })
    ).status,
    200,
  );
  const data = await (await call("/diagnostics?filter=errors")).json();
  const entry = data.entries.find((row) => row.source === "browser");
  assert.equal(entry.requestId, id);
  assert.deepEqual(entry.stages, []);
  assert.ok(!JSON.stringify(data).includes("private-token"));
  assert.ok(!JSON.stringify(data).includes("private-message"));
  assert.equal(
    (
      await call("/diagnostics/client", "one", {
        method: "POST",
        body: JSON.stringify({ ...payload, route: "/api/calendar/oauth" }),
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await call("/diagnostics/client", "bad", {
        method: "POST",
        body: JSON.stringify(payload),
      })
    ).status,
    401,
  );
});

test("trace contexts remain isolated under concurrency and measure active and completed phases", async () => {
  const first = createTrace(),
    second = createTrace();
  await Promise.all([
    runTrace(first, () => measure("connect", () => pause(12))),
    runTrace(second, () => measure("fetch", () => pause(5))),
  ]);
  assert.deepEqual(
    first.snapshot().map((stage) => stage.phase),
    ["connect"],
  );
  assert.deepEqual(
    second.snapshot().map((stage) => stage.phase),
    ["fetch"],
  );
  assert.equal(first.snapshot()[0].active, false);
  const finish = first.start("mailbox_lock");
  await pause(5);
  assert.equal(first.snapshot()[1].active, true);
  finish();
  finish();
  assert.equal(first.snapshot()[1].count, 1);
  assert.equal(first.snapshot()[1].active, false);
});

test("concurrent browser reports are rate limited without blocking backend diagnosis", async () => {
  const results = await Promise.all(
    Array.from({ length: 35 }, () =>
      diagnostics.record(2, {
        source: "browser",
        route: "/api/messages",
        status: 504,
        errorCode: "apiTimeout",
      }),
    ),
  );
  assert.equal(results.filter((result) => result === true).length, 30);
  assert.equal(results.filter((result) => result === "limited").length, 5);
  assert.equal(
    await diagnostics.record(2, {
      route: "/api/message",
      status: 504,
      errorCode: "IMAP_TIMEOUT",
      requestId: id,
    }),
    true,
  );
});

test("retention removes expired logs and reopening the module retains SQLite records", async () => {
  await db.run(
    "INSERT INTO diagnostic_events(account_id,created_at,payload) VALUES(?,?,?)",
    [1, Date.now() - 8 * 86400000, JSON.stringify({ route: "/api/messages" })],
  );
  await diagnostics.cleanup();
  assert.equal(
    (
      await db.get(
        "SELECT COUNT(*) AS total FROM diagnostic_events WHERE created_at<?",
        [Date.now() - 7 * 86400000],
      )
    ).total,
    0,
  );
  await diagnostics.initDiagnostics();
  delete require.cache[require.resolve("../src/diagnostics")];
  const reloaded = require("../src/diagnostics");
  assert.equal((await reloaded.entries(2)).entries[0].requestId, id);
});

test("each mailbox keeps at most 1000 entries and export remains bounded", async () => {
  for (let i = 0; i < 1005; i++)
    await diagnostics.record(2, {
      route: "/api/message",
      status: 200,
      durationMs: i,
    });
  const result = await diagnostics.entries(2, "all", 1000);
  assert.equal(result.total, 1000);
  assert.equal(result.entries.length, 1000);
  assert.equal(result.entries[0].durationMs, 1004);
  assert.equal(result.entries.at(-1).durationMs, 5);
  assert.equal(
    (
      await db.get(
        "SELECT COUNT(*) AS total FROM diagnostic_events WHERE account_id=2",
      )
    ).total,
    1000,
  );
});
