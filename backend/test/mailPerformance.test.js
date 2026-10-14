const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createImapPool } = require("../src/imapPool");
const { messagePage, folderState } = require("../src/mailList");
const { createCache } = require("../src/cache");
const { createMailState } = require("../src/mailState");
const account = {
  id: 1,
  imap_host: "imap.test",
  imap_user: "test",
  password: "test",
};
const gate = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
function factory(log = []) {
  return () => {
    const client = {
      usable: false,
      closed: 0,
      async connect() {
        this.usable = true;
      },
      async logout() {
        this.usable = false;
      },
      close() {
        this.usable = false;
        this.closed++;
      },
    };
    log.push(client);
    return client;
  };
}
test(
  "background status work cannot block a foreground list or reader request",
  { timeout: 3000 },
  async () => {
    const clients = [],
      hold = gate(),
      entered = gate();
    const pool = createImapPool(factory(clients));
    const bg = pool.withImap(
      account,
      async () => {
        entered.resolve();
        await hold.promise;
        return "background";
      },
      { background: true },
    );
    await entered.promise;
    assert.equal(
      await pool.withImap(account, async () => "mail", { read: true }),
      "mail",
    );
    assert.equal(clients.length, 2);
    hold.resolve();
    assert.equal(await bg, "background");
    await pool.closeAll();
  },
);
test("each lane reuses a connection and serializes mailbox operations", async () => {
  const clients = [],
    pool = createImapPool(factory(clients));
  let active = 0,
    peak = 0;
  const job = async () => {
    peak = Math.max(peak, ++active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active--;
  };
  await Promise.all([
    pool.withImap(account, job),
    pool.withImap(account, job),
    pool.withImap(account, job),
  ]);
  assert.equal(peak, 1);
  assert.equal(clients.length, 1);
  await pool.closeAll();
});
test(
  "unusable connections are closed immediately without waiting for logout",
  { timeout: 3000 },
  async () => {
    const clients = [],
      pool = createImapPool(factory(clients));
    await pool.withImap(account, async () => {});
    clients[0].usable = false;
    clients[0].logout = () => new Promise(() => {});
    await pool.withImap(account, async () => {});
    assert.equal(clients.length, 2);
    assert.ok(clients[0].closed);
    await pool.closeAll();
  },
);
test(
  "a hung read times out, closes its connection and releases the next request",
  { timeout: 3000 },
  async () => {
    const clients = [],
      pool = createImapPool(factory(clients), 90000, { foregroundMs: 35 });
    await assert.rejects(
      pool.withImap(account, () => new Promise(() => {}), { read: true }),
      { code: "IMAP_TIMEOUT", status: 504 },
    );
    assert.ok(clients[0].closed);
    assert.equal(
      await pool.withImap(account, async () => "recovered", { read: true }),
      "recovered",
    );
    assert.equal(clients.length, 2);
    await pool.closeAll();
  },
);
test("cancelled queued reads never execute and cannot close another active operation", async () => {
  const clients = [],
    pool = createImapPool(factory(clients)),
    entered = gate(),
    hold = gate();
  const writing = pool.withImap(account, async () => {
    entered.resolve();
    await hold.promise;
  });
  await entered.promise;
  const controller = new AbortController();
  let ran = false;
  const read = pool.withImap(
    account,
    async () => {
      ran = true;
    },
    { read: true, signal: controller.signal },
  );
  controller.abort();
  await assert.rejects(read, { code: "IMAP_CANCELLED" });
  assert.equal(clients[0].closed, 0);
  hold.resolve();
  await writing;
  await pool.withImap(account, async () => {});
  assert.equal(ran, false);
  await pool.closeAll();
});
test("active reader cancellation reclaims the socket for a new mail", async () => {
  const clients = [],
    pool = createImapPool(factory(clients)),
    entered = gate();
  const controller = new AbortController();
  const read = pool.withImap(
    account,
    async () => {
      entered.resolve();
      await new Promise(() => {});
    },
    { read: true, signal: controller.signal },
  );
  await entered.promise;
  controller.abort();
  await assert.rejects(read, { code: "IMAP_CANCELLED" });
  assert.equal(
    await pool.withImap(account, async () => "next", { read: true }),
    "next",
  );
  assert.ok(clients[0].closed);
  assert.equal(clients.length, 2);
  await pool.closeAll();
});
test("read deadlines do not apply to write operations and failed writes are never replayed", async () => {
  const clients = [],
    pool = createImapPool(factory(clients), 90000, { foregroundMs: 5 });
  let calls = 0;
  await assert.rejects(
    pool.withImap(account, async () => {
      calls++;
      await new Promise((resolve) => setTimeout(resolve, 25));
      throw new Error("write failed");
    }),
    /write failed/,
  );
  assert.equal(calls, 1);
  await pool.closeAll();
});
test("an expired queued read does not close an active write and is skipped afterwards", async () => {
  const clients = [],
    pool = createImapPool(factory(clients), 90000, { foregroundMs: 25 }),
    entered = gate(),
    hold = gate();
  const writing = pool.withImap(account, async () => {
    entered.resolve();
    await hold.promise;
  });
  await entered.promise;
  let ran = false;
  await assert.rejects(
    pool.withImap(
      account,
      async () => {
        ran = true;
      },
      { read: true },
    ),
    { code: "IMAP_TIMEOUT" },
  );
  assert.equal(clients[0].closed, 0);
  hold.resolve();
  await writing;
  await pool.withImap(account, async () => {});
  assert.equal(ran, false);
  await pool.closeAll();
});
test("a late connect completion cannot execute cancelled work or resurrect a retired connection", async () => {
  const clients = [],
    started = gate(),
    finish = gate();
  const make = factory(clients);
  const pool = createImapPool(
    () => {
      const client = make();
      if (clients.length === 1)
        client.connect = async () => {
          started.resolve();
          await finish.promise;
          client.usable = true;
        };
      return client;
    },
    90000,
    { foregroundMs: 25 },
  );
  let ran = false;
  const read = pool.withImap(
    account,
    async () => {
      ran = true;
    },
    { read: true },
  );
  await started.promise;
  await assert.rejects(read, { code: "IMAP_TIMEOUT" });
  finish.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(ran, false);
  assert.equal(clients[0].usable, false);
  assert.equal(
    await pool.withImap(account, async () => "next", { read: true }),
    "next",
  );
  await pool.closeAll();
});
function mailbox(count) {
  const calls = { fetch: [], search: [], released: 0 };
  const client = {
    mailbox: { exists: count },
    async getMailboxLock() {
      return { release: () => calls.released++ };
    },
    async *fetch(range, fields, options) {
      calls.fetch.push({ range, fields, options });
      let ids;
      if (Array.isArray(range)) ids = range;
      else {
        const [first, last] = range.split(":").map(Number);
        ids = Array.from(
          { length: last - first + 1 },
          (_, i) => (first + i) * 7 + 3,
        );
      }
      for (const uid of ids)
        yield {
          uid,
          envelope: {
            subject: "Mail",
            date: new Date(uid * 1000),
            from: [{ address: "sender@test.example" }],
          },
          flags: new Set(["\\Seen"]),
          bodyStructure: { childNodes: [{ disposition: "attachment" }] },
          size: 1024,
        };
    },
    async search(query) {
      calls.search.push(query);
      return [12, 33, 85, 91];
    },
    async status() {
      return {
        messages: count,
        unseen: 2,
        uidNext: count * 7 + 4,
        uidValidity: 1n,
        highestModseq: 7n,
      };
    },
  };
  return { client, calls };
}
test("large unfiltered folders fetch only the visible sequence window, not all UIDs or bodies", async () => {
  const { client, calls } = mailbox(1000000);
  const page = await messagePage(client, "INBOX", {
    page: 1,
    pageSize: 25,
    hideDeleted: false,
  });
  assert.equal(page.total, 1000000);
  assert.equal(page.messages.length, 25);
  assert.equal(calls.fetch[0].range, "999976:1000000");
  assert.equal(calls.fetch[0].options.uid, false);
  assert.equal(calls.fetch[0].fields.source, undefined);
  assert.equal(calls.search.length, 0);
  assert.equal(page.messages[0].uid, 7000003);
  assert.equal(page.messages[0].attachment, true);
  assert.equal(calls.released, 1);
  assert.doesNotThrow(() => JSON.stringify(page));
});
test("sequence pagination handles UID gaps, short last pages, empty and out-of-range folders", async () => {
  const { client, calls } = mailbox(28);
  const page = await messagePage(client, "INBOX", { page: 2, pageSize: 25 });
  assert.equal(page.messages.length, 3);
  assert.equal(calls.fetch[0].range, "1:3");
  await messagePage(client, "INBOX", { page: 3, pageSize: 25 });
  assert.equal(calls.fetch.length, 1);
  const empty = mailbox(0);
  assert.equal(
    (await messagePage(empty.client, "INBOX", { page: 1, pageSize: 25 }))
      .messages.length,
    0,
  );
  assert.equal(empty.calls.fetch.length, 0);
});
test("read/unread and hidden-deleted filters retain UID-based selection and lock release", async () => {
  const { client, calls } = mailbox(28);
  const page = await messagePage(client, "INBOX", {
    page: 1,
    pageSize: 5,
    filter: "unread",
    hideDeleted: true,
  });
  assert.deepEqual(calls.search[0], { seen: false, deleted: false });
  assert.equal(page.total, 4);
  assert.deepEqual(calls.fetch[0].range, [91, 85, 33, 12]);
  assert.equal(calls.fetch[0].options.uid, true);
  client.search = async () => {
    throw new Error("provider failure");
  };
  await assert.rejects(
    messagePage(client, "INBOX", { page: 1, pageSize: 5, filter: "read" }),
    /provider failure/,
  );
  assert.equal(calls.released, 2);
});
test("a concurrent expunge adjusts the sequence range once without scanning all UIDs", async () => {
  const fixture = mailbox(30),
    originalFetch = fixture.client.fetch;
  let first = true;
  fixture.client.fetch = async function* (...args) {
    if (first) {
      first = false;
      this.mailbox.exists = 20;
      throw new Error("sequence changed");
    }
    yield* originalFetch.apply(this, args);
  };
  fixture.client.status = async () => ({
    messages: fixture.client.mailbox.exists,
    unseen: 1,
    uidNext: 500,
    uidValidity: 1n,
    highestModseq: 5n,
  });
  const page = await messagePage(fixture.client, "INBOX", {
    page: 1,
    pageSize: 25,
  });
  assert.equal(page.total, 20);
  assert.equal(page.messages.length, 20);
  assert.equal(fixture.calls.fetch[0].range, "1:20");
  assert.equal(fixture.calls.search.length, 0);
});
test("new arrivals during a fetch remain visible to the next change check", async () => {
  const fixture = mailbox(30),
    originalFetch = fixture.client.fetch;
  let revision = 5n;
  fixture.client.status = async () => ({
    messages: fixture.client.mailbox.exists,
    unseen: 1,
    uidNext: fixture.client.mailbox.exists + 1,
    uidValidity: 1n,
    highestModseq: revision,
  });
  fixture.client.fetch = async function* (...args) {
    yield* originalFetch.apply(this, args);
    this.mailbox.exists++;
    revision++;
  };
  const page = await messagePage(fixture.client, "INBOX", {
    page: 1,
    pageSize: 25,
  });
  assert.equal(page.folderStatus.uidNext, 31);
  const states = createMailState();
  states.update(1, [page.folderStatus]);
  assert.equal(
    states.update(1, [folderState("INBOX", await fixture.client.status())]),
    true,
  );
});
test("unchanged states keep caches warm while flag-only changes and UID validity invalidate", () => {
  const state = createMailState(2),
    a = folderState("INBOX", {
      messages: 3,
      unseen: 1,
      uidNext: 5,
      uidValidity: 1n,
      highestModseq: 2n,
    });
  assert.equal(state.update(1, [a]), true);
  assert.equal(state.update(1, [a]), false);
  assert.equal(state.update(1, [{ ...a, highestModseq: "3" }]), true);
  assert.equal(state.update(1, [{ ...a, uidValidity: "9" }]), true);
  assert.equal(state.folders(1, [{ path: "INBOX" }])[0].unseen, 1);
  assert.equal(state.folders(2, [{ path: "INBOX" }])[0].unseen, undefined);
});
test("metadata cache coalesces readers, isolates accounts and releases failed entries", async () => {
  const cache = createCache();
  let reads = 0;
  const read = async () => {
    reads++;
    return ["metadata"];
  };
  await Promise.all([
    cache.cached(1, "list", 45000, read),
    cache.cached(1, "list", 45000, read),
  ]);
  assert.equal(reads, 1);
  await cache.cached(2, "list", 45000, read);
  assert.equal(reads, 2);
  cache.invalidate(1);
  await cache.cached(1, "list", 45000, read);
  assert.equal(reads, 3);
  await assert.rejects(
    cache.cached(1, "error", 45000, async () => {
      throw new Error("offline");
    }),
  );
  assert.equal(
    await cache.cached(1, "error", 45000, async () => "online"),
    "online",
  );
});
