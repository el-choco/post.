const test = require("node:test");
const assert = require("node:assert/strict");
const { createImapPool } = require("../src/imapPool");
const { createCache } = require("../src/cache");
test("IMAP pool reuses connections and serializes simultaneous mailbox operations", async () => {
  let connections = 0,
    active = 0,
    peak = 0;
  const clients = [];
  const pool = createImapPool(() => {
    const client = {
      usable: false,
      async connect() {
        connections++;
        this.usable = true;
      },
      async logout() {
        this.usable = false;
      },
      close() {
        this.usable = false;
      },
    };
    clients.push(client);
    return client;
  });
  const account = {
    id: 1,
    imap_host: "test",
    imap_user: "user",
    password: "secret",
  };
  const read = async () => {
    active++;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active--;
    return "ok";
  };
  assert.deepEqual(
    await Promise.all([
      pool.withImap(account, read),
      pool.withImap(account, read),
    ]),
    ["ok", "ok"],
  );
  assert.equal(connections, 1);
  assert.equal(peak, 1);
  await pool.withImap({ ...account, password: "changed" }, read);
  assert.equal(connections, 2);
  assert.equal(clients[0].usable, false);
  await pool.closeAll();
});
test("failed IMAP connection does not poison the request queue", async () => {
  let attempts = 0;
  const pool = createImapPool(() => ({
    usable: false,
    async connect() {
      attempts++;
      if (attempts === 1) throw new Error("offline");
      this.usable = true;
    },
    async logout() {
      this.usable = false;
    },
    close() {
      this.usable = false;
    },
  }));
  const account = { id: 1 };
  await assert.rejects(
    pool.withImap(account, () => 1),
    /offline/,
  );
  assert.equal(await pool.withImap(account, () => 2), 2);
  await pool.closeAll();
});
test("cache shares in-flight reads, isolates accounts and invalidates immediately", async () => {
  const cache = createCache();
  let reads = 0;
  let resolveRead;
  const a = cache.cached(1, "folders", 10000, () => {
    reads++;
    return new Promise((resolve) => (resolveRead = resolve));
  });
  const b = cache.cached(1, "folders", 10000, () => {
    throw new Error("duplicate read");
  });
  await Promise.resolve();
  resolveRead("one");
  assert.deepEqual(await Promise.all([a, b]), ["one", "one"]);
  assert.equal(reads, 1);
  assert.equal(await cache.cached(2, "folders", 10000, () => "two"), "two");
  cache.invalidate(1);
  assert.equal(await cache.cached(1, "folders", 10000, () => "fresh"), "fresh");
});
