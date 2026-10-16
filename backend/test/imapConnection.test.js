const { test } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const net = require("node:net");
const { ImapFlow } = require("imapflow");
const { createImapPool } = require("../src/imapPool");
const {
  connectImap,
  IDLE_CONNECTION_MS,
  SOCKET_TIMEOUT_MS,
} = require("../src/imapConnection");
const { createTrace, runTrace } = require("../src/diagnosticsTrace");
const { makeClient } = require("../src/imap");
const account = {
  id: 1,
  imap_host: "imap.test",
  imap_port: 993,
  imap_secure: 1,
  imap_user: "test",
  password: "test",
};
function factory(clients) {
  return () => {
    const client = {
      usable: false,
      async connect() {
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
  };
}
const flush = () => new Promise((resolve) => setImmediate(resolve));

test("two-minute polling reuses a connection and resets the five-minute idle expiry", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const clients = [],
    pool = createImapPool(factory(clients));
  t.after(() => pool.closeAll());
  const first = await pool.withImap(account, async (client) => client, {
    background: true,
  });
  t.mock.timers.tick(120000);
  assert.equal(first.usable, true);
  assert.equal(
    await pool.withImap(account, async (client) => client, {
      background: true,
    }),
    first,
  );
  assert.equal(clients.length, 1);
  t.mock.timers.tick(IDLE_CONNECTION_MS - 1);
  await flush();
  assert.equal(first.usable, true);
  t.mock.timers.tick(1);
  await flush();
  assert.equal(first.usable, false);
  const next = await pool.withImap(account, async (client) => client, {
    background: true,
  });
  assert.notEqual(next, first);
  assert.equal(clients.length, 2);
});

test("the production socket inactivity limit cannot expire before the idle pool", () => {
  const client = makeClient(account);
  assert.equal(IDLE_CONNECTION_MS, 300000);
  assert.equal(client.socketTimeout, SOCKET_TIMEOUT_MS);
  assert.ok(client.socketTimeout > IDLE_CONNECTION_MS);
  assert.equal(client.options.connectionTimeout, 15000);
  assert.equal(client.options.greetingTimeout, 10000);
  client.close();
});

test("a failed operation is not replayed and the following read uses a new connection", async (t) => {
  const clients = [],
    pool = createImapPool(factory(clients));
  t.after(() => pool.closeAll());
  let calls = 0;
  await assert.rejects(
    pool.withImap(
      account,
      async () => {
        calls++;
        throw Object.assign(new Error("peer closed"), { code: "ECONNRESET" });
      },
      { read: true },
    ),
    { code: "ECONNRESET" },
  );
  assert.equal(calls, 1);
  assert.equal(clients[0].usable, false);
  assert.equal(
    await pool.withImap(account, async () => "next", { read: true }),
    "next",
  );
  assert.equal(clients.length, 2);
});

for (const encrypted of [false, true]) {
  test(`connection diagnostics separate transport and session for ${encrypted ? "TLS" : "TCP"}`, async () => {
    const socket = new EventEmitter();
    socket.encrypted = encrypted;
    let done;
    const client = {
      socket,
      connect: () =>
        new Promise((resolve) => {
          done = resolve;
        }),
    };
    const trace = createTrace();
    const connecting = connectImap(client, trace);
    assert.equal(
      trace.snapshot().find((stage) => stage.phase === "network").active,
      true,
    );
    if (encrypted) {
      socket.emit("connect");
      assert.equal(
        trace.snapshot().some((stage) => stage.phase === "session"),
        false,
      );
    }
    socket.emit(encrypted ? "secureConnect" : "connect");
    assert.equal(
      trace.snapshot().find((stage) => stage.phase === "network").active,
      false,
    );
    assert.equal(
      trace.snapshot().find((stage) => stage.phase === "session").active,
      true,
    );
    done();
    await connecting;
    assert.ok(trace.snapshot().every((stage) => !stage.active));
    assert.equal(socket.listenerCount("connect"), 0);
    assert.equal(socket.listenerCount("secureConnect"), 0);
  });
}

for (const ready of [false, true]) {
  test(`failed connection diagnostics clean up ${ready ? "after" : "before"} transport readiness`, async () => {
    const socket = new EventEmitter();
    let fail;
    const client = {
      socket,
      connect: () =>
        new Promise((resolve, reject) => {
          fail = reject;
        }),
    };
    const trace = createTrace();
    const connecting = connectImap(client, trace);
    if (ready) socket.emit("connect");
    fail(Object.assign(new Error("connection failed"), { code: "ECONNRESET" }));
    await assert.rejects(connecting, { code: "ECONNRESET" });
    assert.ok(trace.snapshot().every((stage) => !stage.active));
    assert.equal(
      trace.snapshot().some((stage) => stage.phase === "session"),
      ready,
    );
    assert.equal(socket.listenerCount("connect"), 0);
  });
}

test("a cancelled connection releases transport observers and preserves timeout diagnostics", async (t) => {
  const trace = createTrace(),
    socket = new EventEmitter();
  let fail;
  const client = {
    socket,
    usable: false,
    connect: () =>
      new Promise((resolve, reject) => {
        fail = reject;
      }),
    close: () =>
      fail(Object.assign(new Error("closed"), { code: "ConnectionClosed" })),
  };
  const pool = createImapPool(() => client, IDLE_CONNECTION_MS, {
    foregroundMs: 20,
  });
  t.after(() => pool.closeAll());
  await assert.rejects(
    runTrace(trace, () =>
      pool.withImap(account, async () => {}, { read: true }),
    ),
    { code: "IMAP_TIMEOUT" },
  );
  await flush();
  assert.ok(trace.snapshot().some((stage) => stage.phase === "network"));
  assert.ok(trace.snapshot().every((stage) => !stage.active));
  assert.equal(socket.listenerCount("connect"), 0);
});

test(
  "the real IMAP client replaces a server-closed idle session and records setup phases",
  { timeout: 8000 },
  async (t) => {
    const sockets = new Set(),
      clients = [];
    const server = net.createServer((socket) => {
      sockets.add(socket);
      socket.once("close", () => sockets.delete(socket));
      socket.on("error", () => {});
      socket.write("* OK local test server\r\n");
      let pending = "",
        authTag;
      socket.on("data", (data) => {
        pending += data.toString();
        let end;
        while ((end = pending.indexOf("\r\n")) >= 0) {
          const line = pending.slice(0, end);
          pending = pending.slice(end + 2);
          if (authTag) {
            socket.write(`${authTag} OK authenticated\r\n`);
            authTag = null;
            continue;
          }
          const [tag, rawCommand] = line.split(" ");
          const command = rawCommand?.toUpperCase();
          if (command === "CAPABILITY")
            socket.write(
              `* CAPABILITY IMAP4rev1 AUTH=PLAIN\r\n${tag} OK capabilities\r\n`,
            );
          else if (command === "AUTHENTICATE") {
            authTag = tag;
            socket.write("+\r\n");
          } else if (command === "LOGOUT")
            socket.end(`* BYE logout\r\n${tag} OK logout\r\n`);
          else if (command === "LIST")
            socket.write(`* LIST (\\Noselect) "/" ""\r\n${tag} OK list\r\n`);
          else socket.write(`${tag} OK done\r\n`);
        }
      });
    });
    const pool = createImapPool(
      () => {
        const client = new ImapFlow({
          host: "127.0.0.1",
          port: server.address().port,
          secure: false,
          doSTARTTLS: false,
          auth: { user: "test", pass: "test" },
          logger: false,
          disableAutoIdle: true,
          disableCompression: true,
          socketTimeout: SOCKET_TIMEOUT_MS,
        });
        client.on("error", () => {});
        clients.push(client);
        return client;
      },
      IDLE_CONNECTION_MS,
      { foregroundMs: 2000 },
    );
    t.after(async () => {
      await pool.closeAll();
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => server.close(resolve));
    });
    server.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    const trace = createTrace();
    const first = await runTrace(trace, () =>
      pool.withImap(account, async (client) => client, { read: true }),
    );
    assert.ok(trace.snapshot().some((stage) => stage.phase === "network"));
    assert.ok(trace.snapshot().some((stage) => stage.phase === "session"));
    assert.ok(trace.snapshot().every((stage) => !stage.active));
    const closed = new Promise((resolve) => first.once("close", resolve));
    [...sockets][0].end("* BYE server closing idle session\r\n");
    await closed;
    assert.equal(first.usable, false);
    const second = await pool.withImap(account, async (client) => client, {
      read: true,
    });
    assert.notEqual(second, first);
    assert.equal(second.usable, true);
    assert.equal(clients.length, 2);
  },
);
