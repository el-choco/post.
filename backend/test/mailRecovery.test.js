const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createImapPool } = require("../src/imapPool");
const { createCache } = require("../src/cache");
const { createTrace, runTrace } = require("../src/diagnosticsTrace");
const account = {
  id: 1,
  imap_host: "imap.test",
  imap_port: 993,
  imap_secure: 1,
  imap_user: "user",
  password: "password",
};
function gate() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function factory(clients) {
  return () => {
    const client = {
      usable: false,
      connected: 0,
      closed: 0,
      async connect() {
        this.connected++;
        this.usable = true;
      },
      close() {
        this.closed++;
        this.usable = false;
      },
      async logout() {
        this.usable = false;
      },
    };
    clients.push(client);
    return client;
  };
}

test("interactive reads take ownership of an idle background connection instead of reconnecting", async () => {
  const clients = [],
    pool = createImapPool(factory(clients)),
    trace = createTrace();
  const background = await pool.withImap(account, async (client) => client, {
    background: true,
  });
  const foreground = await runTrace(trace, () =>
    pool.withImap(account, async (client) => client, { read: true }),
  );
  assert.equal(foreground, background);
  assert.equal(clients.length, 1);
  assert.equal(foreground.connected, 1);
  assert.ok(trace.snapshot().some((stage) => stage.phase === "reuse"));
  assert.ok(!trace.snapshot().some((stage) => stage.phase === "connect"));
  const freshBackground = await pool.withImap(
    account,
    async (client) => client,
    { background: true },
  );
  assert.notEqual(freshBackground, foreground);
  assert.equal(clients.length, 2);
  assert.equal(
    await pool.withImap(account, async (client) => client, { read: true }),
    foreground,
  );
  await pool.closeAll();
});

test("a transferred connection cannot be closed by its previous idle timer", async () => {
  const clients = [],
    pool = createImapPool(factory(clients), 30);
  const background = await pool.withImap(account, async (client) => client, {
    background: true,
  });
  await pool.withImap(
    account,
    async (client) => {
      assert.equal(client, background);
      await new Promise((resolve) => setTimeout(resolve, 60));
      assert.equal(client.closed, 0);
      assert.equal(client.usable, true);
    },
    { read: true },
  );
  await pool.closeAll();
});

test("busy background connections stay isolated while a separate foreground connection runs", async () => {
  const clients = [],
    pool = createImapPool(factory(clients)),
    entered = gate(),
    release = gate();
  const background = pool.withImap(
    account,
    async (client) => {
      entered.resolve(client);
      await release.promise;
      return client;
    },
    { background: true },
  );
  const busy = await entered.promise;
  const foreground = await pool.withImap(account, async (client) => client, {
    read: true,
  });
  assert.notEqual(busy, foreground);
  assert.equal(clients.length, 2);
  assert.equal(busy.closed, 0);
  release.resolve();
  await background;
  await pool.closeAll();
});

test("connection transfer never crosses accounts, changed credentials or write requests", async () => {
  for (const [target, options] of [
    [{ ...account, id: 2 }, { read: true }],
    [{ ...account, password: "changed" }, { read: true }],
    [account, {}],
  ]) {
    const clients = [],
      pool = createImapPool(factory(clients));
    const background = await pool.withImap(account, async (client) => client, {
      background: true,
    });
    const foreground = await pool.withImap(
      target,
      async (client) => client,
      options,
    );
    assert.notEqual(background, foreground);
    assert.equal(clients.length, 2);
    await pool.closeAll();
  }
});

test("cancelling the final cache consumer retires the shared read before the next request joins", async () => {
  const cache = createCache(),
    controller = new AbortController(),
    entered = gate();
  let sourceSignal;
  const first = cache.cached(
    1,
    "messages",
    45000,
    (signal) => {
      sourceSignal = signal;
      entered.resolve();
      return new Promise((resolve, reject) =>
        signal.addEventListener("abort", () => reject(new Error("retired")), {
          once: true,
        }),
      );
    },
    { signal: controller.signal },
  );
  await entered.promise;
  const rejected = assert.rejects(first, {
    name: "AbortError",
    code: "IMAP_CANCELLED",
  });
  controller.abort();
  await rejected;
  assert.equal(sourceSignal.aborted, true);
  assert.equal(
    await cache.cached(1, "messages", 45000, async () => "fresh"),
    "fresh",
  );
});

test("cancelling one of several readers preserves the shared operation for the others", async () => {
  const cache = createCache(),
    firstController = new AbortController(),
    entered = gate(),
    result = gate();
  let reads = 0,
    sourceSignal;
  const load = (signal) => {
    reads++;
    sourceSignal = signal;
    entered.resolve();
    return result.promise;
  };
  const first = cache.cached(1, "messages", 45000, load, {
    signal: firstController.signal,
  });
  const second = cache.cached(1, "messages", 45000, load);
  await entered.promise;
  const rejected = assert.rejects(first, { name: "AbortError" });
  firstController.abort();
  await rejected;
  assert.equal(sourceSignal.aborted, false);
  result.resolve("shared");
  assert.equal(await second, "shared");
  assert.equal(await cache.cached(1, "messages", 45000, load), "shared");
  assert.equal(reads, 1);
});

test("late failures from an abandoned read cannot evict a newer successful cache entry", async () => {
  const cache = createCache(),
    controller = new AbortController(),
    entered = gate(),
    old = gate();
  const first = cache.cached(
    1,
    "messages",
    45000,
    () => {
      entered.resolve();
      return old.promise;
    },
    { signal: controller.signal },
  );
  await entered.promise;
  const rejected = assert.rejects(first, { name: "AbortError" });
  controller.abort();
  await rejected;
  assert.equal(
    await cache.cached(1, "messages", 45000, async () => "new"),
    "new",
  );
  old.reject(new Error("old timeout"));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(
    await cache.cached(1, "messages", 45000, async () => {
      throw new Error("Must stay cached");
    }),
    "new",
  );
});

test("the shared signal aborts only after every consumer leaves, and pre-aborted callers start no work", async () => {
  const cache = createCache(),
    first = new AbortController(),
    second = new AbortController(),
    entered = gate();
  let signal,
    calls = 0;
  const load = (value) => {
    calls++;
    signal = value;
    entered.resolve();
    return new Promise((resolve, reject) =>
      value.addEventListener("abort", () => reject(new Error("cancelled")), {
        once: true,
      }),
    );
  };
  const one = cache.cached(1, "messages", 45000, load, {
    signal: first.signal,
  });
  const two = cache.cached(1, "messages", 45000, load, {
    signal: second.signal,
  });
  await entered.promise;
  const oneRejected = assert.rejects(one, { code: "IMAP_CANCELLED" });
  first.abort();
  await oneRejected;
  assert.equal(signal.aborted, false);
  const twoRejected = assert.rejects(two, { code: "IMAP_CANCELLED" });
  second.abort();
  await twoRejected;
  assert.equal(signal.aborted, true);
  await assert.rejects(
    cache.cached(1, "other", 45000, load, { signal: first.signal }),
    { code: "IMAP_CANCELLED" },
  );
  assert.equal(calls, 1);
});

test(
  "production list requests reuse idle connections and a disconnected browser cannot poison the next read",
  { timeout: 10000 },
  async () => {
    const fs = require("node:fs"),
      os = require("node:os"),
      path = require("node:path"),
      http = require("node:http");
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "post-mail-recovery-"));
    process.env.DATA_DIR = temp;
    const db = require("../src/db"),
      { encrypt, sha256 } = require("../src/crypto"),
      imap = require("../src/imap"),
      metadata = require("../src/cache");
    const original = imap.withImap,
      clients = [],
      signals = [],
      entered = gate(),
      closed = gate();
    let server,
      stall = false;
    const pool = createImapPool(
      () => {
        const client = {
          usable: false,
          async connect() {
            this.usable = true;
          },
          close() {
            this.usable = false;
            this.rejectFetch?.(new Error("Connection closed"));
            closed.resolve();
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
              uidNext: 2,
              uidValidity: 1n,
              highestModseq: 1n,
            };
          },
          async *fetch() {
            if (stall) {
              entered.resolve();
              await new Promise((resolve, reject) => {
                this.rejectFetch = reject;
              });
            }
            yield {
              uid: 1,
              envelope: { subject: "Test mail" },
              flags: new Set(),
            };
          },
        };
        clients.push(client);
        return client;
      },
      90000,
      { foregroundMs: 5000 },
    );
    try {
      await db.init();
      const row = await db.run(
        "INSERT INTO mail_accounts(email,password_enc,imap_host,imap_port,imap_secure,imap_user,smtp_host,smtp_port,smtp_secure,smtp_user,settings,created_at) VALUES(?,?,?,993,1,?,?,465,1,?,?,?)",
        [
          "recovery@example.test",
          encrypt("test-password"),
          "imap.test",
          "recovery@example.test",
          "smtp.test",
          "recovery@example.test",
          "{}",
          Date.now(),
        ],
      );
      await db.run(
        "INSERT INTO sessions(token_hash,account_id,expires_at) VALUES(?,?,?)",
        [sha256("test-session"), row.lastID, Date.now() + 60000],
      );
      const acc = await db.get("SELECT * FROM mail_accounts WHERE id=?", [
        row.lastID,
      ]);
      acc.password = "test-password";
      await pool.withImap(acc, async () => {}, { background: true });
      imap.withImap = (value, action, options = {}) => {
        if (options.read) signals.push(options.signal);
        return pool.withImap(value, action, options);
      };
      const { app } = require("../src/index");
      server = app.listen(0, "127.0.0.1");
      await new Promise((resolve) => server.once("listening", resolve));
      const base = "http://127.0.0.1:" + server.address().port,
        headers = { Authorization: "Bearer test-session" };
      const first = await fetch(base + "/api/messages", { headers });
      assert.equal(first.status, 200);
      await first.json();
      assert.equal(clients.length, 1);
      metadata.invalidate(acc.id);
      stall = true;
      const request = http.request(base + "/api/messages", { headers });
      request.on("error", () => {});
      request.end();
      await entered.promise;
      const abandonedSignal = signals.at(-1);
      assert.ok(abandonedSignal);
      request.destroy();
      await closed.promise;
      assert.equal(abandonedSignal.aborted, true);
      stall = false;
      const fresh = await fetch(base + "/api/messages", { headers });
      assert.equal(fresh.status, 200);
      assert.equal((await fresh.json()).messages[0].subject, "Test mail");
      assert.equal(clients.length, 2);
      assert.notEqual(signals.at(-1), abandonedSignal);
      assert.equal(signals.at(-1).aborted, false);
    } finally {
      if (server) {
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
      }
      await pool.closeAll();
      await require("../src/diagnostics").flush();
      imap.withImap = original;
      await new Promise((resolve) => db.db.close(resolve));
      fs.rmSync(temp, { recursive: true, force: true });
    }
  },
);
