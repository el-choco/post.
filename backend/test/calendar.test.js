const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
process.env.DATA_DIR = fs.mkdtempSync(
  path.join(os.tmpdir(), "post-calendar-test-"),
);
process.env.ALLOW_PRIVATE_CALDAV = "true";
process.env.PUBLIC_BASE_URL = "http://localhost:8886";
process.env.GOOGLE_CLIENT_ID = "test-client";
process.env.GOOGLE_CLIENT_SECRET = "test-secret";
const express = require("express");
const db = require("../src/db"),
  ics = require("../src/calendarIcs"),
  providers = require("../src/calendarProviders"),
  network = require("../src/calendarNetwork");
const { encrypt, decrypt, sha256 } = require("../src/crypto");
let server,
  remote,
  base,
  remoteUrl,
  calendarId,
  fixtureText,
  etag = '"1"',
  remoteRequests = [];
const esc = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const multi = (url, prop) =>
  `<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:response><d:href>${url}</d:href><d:propstat><d:prop>${prop}</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>`;
async function call(
  url,
  body,
  method = body ? "POST" : "GET",
  token = "a",
  headers = {},
) {
  const res = await fetch(base + url, {
    method,
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return {
    status: res.status,
    headers: res.headers,
    data: res.headers.get("content-type")?.includes("application/json")
      ? await res.json()
      : await res.text(),
  };
}
before(async () => {
  // Existing 1.2.0 databases have six OAuth state columns.
  await db.run(`CREATE TABLE calendar_oauth_states (
    state_hash TEXT PRIMARY KEY,account_id INTEGER NOT NULL,
    session_hash TEXT NOT NULL,provider TEXT NOT NULL,verifier TEXT NOT NULL,expires_at INTEGER NOT NULL)`);
  await db.init();
  for (const email of ["a@example.test", "b@example.test"])
    await db.run(
      `INSERT INTO mail_accounts(email,password_enc,imap_host,imap_port,imap_secure,imap_user,smtp_host,smtp_port,smtp_secure,smtp_user,created_at) VALUES(?,?,?,993,1,?,?,465,1,?,?)`,
      [
        email,
        encrypt("fake-password"),
        "imap.example.test",
        email,
        "smtp.example.test",
        email,
        Date.now(),
      ],
    );
  await db.run("INSERT INTO sessions VALUES(?,?,?)", [
    sha256("a"),
    1,
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
  app.use(
    "/calendar",
    require("../src/calendar").createCalendarRouter(auth, wrap),
  );
  app.use((e, req, res, next) =>
    res.status(e.status || 500).json({ error: e.message }),
  );
  server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  base = "http://127.0.0.1:" + server.address().port;
  fixtureText = ics.build(
    ics.validate({
      title: "Remote appointment",
      start: "2026-10-11T10:00:00Z",
      end: "2026-10-11T11:00:00Z",
    }),
  );
  remote = http
    .createServer(async (req, res) => {
      let body = "";
      for await (const chunk of req) body += chunk;
      remoteRequests.push({
        method: req.method,
        url: req.url,
        auth: req.headers.authorization,
        match: req.headers["if-match"],
        body,
      });
      if (req.url === "/feed.ics")
        return res
          .writeHead(200, { "Content-Type": "text/calendar" })
          .end(fixtureText);
      if (req.method === "PROPFIND")
        return res
          .writeHead(207, { "Content-Type": "application/xml" })
          .end(
            multi(
              "/cal/",
              "<d:displayname>Team &amp; Friends</d:displayname><d:resourcetype><c:calendar/></d:resourcetype><d:current-user-privilege-set><d:privilege><d:write/></d:privilege></d:current-user-privilege-set>",
            ),
          );
      if (req.method === "REPORT")
        return res
          .writeHead(207)
          .end(
            multi(
              "/cal/event.ics",
              `<d:getetag>${esc(etag)}</d:getetag><c:calendar-data>${esc(fixtureText)}</c:calendar-data>`,
            ),
          );
      if (req.method === "GET")
        return res.writeHead(200, { ETag: etag }).end(fixtureText);
      if (req.method === "PUT") {
        if (req.headers["if-match"] && req.headers["if-match"] !== etag)
          return res.writeHead(412).end();
        fixtureText = body;
        etag = '"2"';
        return res.writeHead(204).end();
      }
      if (req.method === "DELETE") return res.writeHead(204).end();
      res.writeHead(404).end();
    })
    .listen(0, "127.0.0.1");
  await new Promise((r) => remote.once("listening", r));
  remoteUrl = "http://127.0.0.1:" + remote.address().port;
});
after(async () => {
  await Promise.all([
    new Promise((r) => server.close(r)),
    new Promise((r) => remote.close(r)),
  ]);
  await new Promise((r) => db.db.close(r));
});

test("default calendar is idempotent, private and credentials stay private", async () => {
  const one = await call("/calendar/calendars");
  calendarId = one.data.calendars[0].id;
  assert.equal(one.data.calendars[0].kind, "local");
  assert.equal((await call("/calendar/calendars")).data.calendars.length, 1);
  assert.equal(
    (await call("/calendar/calendars", null, "GET", "bad")).status,
    401,
  );
  assert.equal(
    (
      await call(
        "/calendar/calendars/" + calendarId,
        { name: "stolen", color: "#000000" },
        "PATCH",
        "b",
      )
    ).status,
    404,
  );
  assert.equal(JSON.stringify(one.data).includes("credentials"), false);
});
test("local CRUD, revision conflicts, all-day exclusive end and ownership", async () => {
  const event = {
    title: "All day",
    start: "2026-10-11",
    end: "2026-10-13",
    allDay: true,
  };
  assert.equal(
    (await call("/calendar/events", { calendarId, event })).status,
    200,
  );
  const list = await call(
      "/calendar/events?start=2026-10-01&end=2026-11-01&calendars=" +
        calendarId,
    ),
    row = list.data.events[0];
  assert.equal(row.end, "2026-10-13");
  assert.equal(row.allDay, true);
  assert.equal(
    (
      await call("/calendar/events", {
        calendarId,
        id: row.id,
        revision: "0",
        event,
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await call("/calendar/events", {
        calendarId,
        id: row.id,
        revision: row.revision,
        event: { ...event, title: "Updated" },
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await call(
        "/calendar/events/delete",
        { calendarId, id: row.id, revision: "2", confirm: true },
        "POST",
        "b",
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await call("/calendar/events/delete", {
        calendarId,
        id: row.id,
        revision: "1",
        confirm: true,
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await call("/calendar/events/delete", {
        calendarId,
        id: row.id,
        revision: "2",
        confirm: true,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await call("/calendar/events", {
        calendarId,
        event: { ...event, start: "2026-99-99" },
      })
    ).status,
    400,
  );
});
test("recurrence preserves wall time across daylight saving and retains exceptions", () => {
  const text = ics.build(
    ics.validate({
      title: "Weekly",
      start: "2026-10-18T07:00:00Z",
      end: "2026-10-18T08:00:00Z",
      timezone: "Europe/Berlin",
      recurrence: "FREQ=WEEKLY;COUNT=3",
    }),
  );
  const rows = ics.expand(text, "2026-10-01T00:00:00Z", "2026-11-10T00:00:00Z");
  assert.deepEqual(
    rows.map((e) => e.start),
    [
      "2026-10-18T07:00:00.000Z",
      "2026-10-25T08:00:00.000Z",
      "2026-11-01T08:00:00.000Z",
    ],
  );
  assert.ok(text.includes("BEGIN:VTIMEZONE"));
  const updated = ics.build(
    { ...rows[0].series, title: "New series name", timezone: "Europe/Berlin" },
    text,
  );
  assert.equal(ics.expand(updated, "2026-10-01", "2026-11-10").length, 3);
});
test("ICS import is atomic, deduplicates UIDs, and export roundtrips recurrence", async () => {
  const text = ics.build(
    ics.validate({
      title: "Imported",
      start: "2026-10-12T10:00:00Z",
      end: "2026-10-12T11:00:00Z",
      recurrence: "FREQ=DAILY;COUNT=2",
    }),
  );
  assert.deepEqual(
    (await call("/calendar/calendars/" + calendarId + "/import", { ics: text }))
      .data,
    { imported: 1, duplicates: 0 },
  );
  assert.deepEqual(
    (await call("/calendar/calendars/" + calendarId + "/import", { ics: text }))
      .data,
    { imported: 0, duplicates: 1 },
  );
  assert.equal(
    (
      await call("/calendar/calendars/" + calendarId + "/import", {
        ics: "not a calendar",
      })
    ).status,
    400,
  );
  const exported = await call("/calendar/calendars/" + calendarId + "/export");
  assert.equal(
    exported.headers.get("content-type").startsWith("text/calendar"),
    true,
  );
  assert.equal(ics.expand(exported.data, "2026-10-01", "2026-11-01").length, 2);
});
test("CalDAV discovery, report, encrypted credentials, conditional edit and disconnect", async () => {
  const connected = await call("/calendar/connections", {
    kind: "caldav",
    name: "Test DAV",
    url: remoteUrl + "/cal/",
    username: "test-user",
    password: "test-password",
  });
  assert.equal(connected.status, 200);
  assert.equal(connected.data.count, 1);
  const conn = await db.get("SELECT * FROM calendar_connections WHERE id=?", [
    connected.data.id,
  ]);
  assert.equal(conn.credentials_enc.includes("test-password"), false);
  assert.equal(
    JSON.parse(decrypt(conn.credentials_enc)).password,
    "test-password",
  );
  const list = await call("/calendar/calendars");
  const c = list.data.calendars.find((c) => c.connectionId === conn.id);
  assert.equal(c.name, "Team & Friends");
  assert.equal(c.readOnly, false);
  const result = await call(
      "/calendar/events?start=2026-10-01&end=2026-11-01&calendars=" + c.id,
    ),
    event = result.data.events[0];
  assert.equal(result.data.errors.length, 0);
  assert.equal(event.title, "Remote appointment");
  assert.equal(
    (
      await call("/calendar/events", {
        calendarId: c.id,
        id: event.id,
        revision: '"stale"',
        event,
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await call("/calendar/events", {
        calendarId: c.id,
        id: event.id,
        revision: event.revision,
        event: { ...event, title: "Changed remotely" },
      })
    ).status,
    200,
  );
  assert.equal(remoteRequests.at(-1).method, "PUT");
  assert.equal(remoteRequests.at(-1).match, '"1"');
  assert.ok(fixtureText.includes("Changed remotely"));
  assert.equal(
    (
      await call(
        "/calendar/connections/" + conn.id,
        { confirm: true },
        "DELETE",
      )
    ).status,
    200,
  );
  assert.equal(
    (await db.all("SELECT * FROM calendars WHERE connection_id=?", [conn.id]))
      .length,
    0,
  );
});
test("ICS subscription is read-only and cannot overwrite provider events", async () => {
  const result = await call("/calendar/connections", {
    kind: "ics",
    name: "Subscription",
    url: remoteUrl + "/feed.ics",
  });
  assert.equal(result.status, 200);
  const c = (await call("/calendar/calendars")).data.calendars.find(
    (c) => c.connectionId === result.data.id,
  );
  assert.equal(c.readOnly, true);
  assert.equal(
    (
      await call("/calendar/events", {
        calendarId: c.id,
        event: {
          title: "No",
          start: "2026-10-11",
          end: "2026-10-12",
          allDay: true,
        },
      })
    ).status,
    403,
  );
});
test("OAuth is session-bound, uses PKCE, rejects forged cookie and consumes state once", async () => {
  const started = await call("/calendar/oauth/google/start", {}),
    url = new URL(started.data.url),
    state = url.searchParams.get("state");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(
    url.searchParams.get("scope").includes("mail.google.com"),
    false,
  );
  assert.equal(
    (
      await call(
        "/calendar/oauth/google/callback?state=" +
          state +
          "&error=access_denied",
        null,
        "GET",
        "a",
        { Cookie: "post_calendar_state=forged" },
      )
    ).status,
    400,
  );
  const saved = await db.get(
    "SELECT * FROM calendar_oauth_states WHERE state_hash=?",
    [sha256(state)],
  );
  assert.equal(saved.account_id, 1);
  const result = await fetch(
    base +
      "/calendar/oauth/google/callback?state=" +
      state +
      "&error=access_denied",
    { headers: { Cookie: "post_calendar_state=" + state }, redirect: "manual" },
  );
  assert.equal(result.status, 302);
  assert.equal(
    await db.get("SELECT * FROM calendar_oauth_states WHERE state_hash=?", [
      sha256(state),
    ]),
    undefined,
  );
  assert.equal(
    (
      await call(
        "/calendar/oauth/google/callback?state=" +
          state +
          "&error=access_denied",
        null,
        "GET",
        "a",
        { Cookie: "post_calendar_state=" + state },
      )
    ).status,
    400,
  );
});
test("Google refresh persists tokens and provider pagination uses normalized events", async () => {
  const original = network.request;
  let refreshes = 0;
  const row = await db.run(
    "INSERT INTO calendar_connections(account_id,kind,name,credentials_enc) VALUES(?,?,?,?)",
    [
      1,
      "google",
      "Google test",
      encrypt(
        JSON.stringify({
          access_token: "expired",
          refresh_token: "refresh-value",
          expiresAt: 0,
        }),
      ),
    ],
  );
  const conn = await db.get("SELECT * FROM calendar_connections WHERE id=?", [
    row.lastID,
  ]);
  network.request = async (url, opts) => {
    if (url.includes("oauth2.googleapis.com")) {
      refreshes++;
      return {
        status: 200,
        headers: {},
        text: JSON.stringify({ access_token: "fresh", expires_in: 3600 }),
      };
    }
    assert.equal(opts.headers.Authorization, "Bearer fresh");
    return {
      status: 200,
      headers: {},
      text: JSON.stringify({
        items: [
          {
            id: "g1",
            summary: "Google item",
            start: { date: "2026-10-11" },
            end: { date: "2026-10-12" },
            etag: '"g1"',
          },
        ],
      }),
    };
  };
  try {
    const items = await providers.listEvents(
      { remote_id: "external@example.test" },
      conn,
      "2026-10-01T00:00:00Z",
      "2026-11-01T00:00:00Z",
    );
    assert.equal(items[0].allDay, true);
    assert.equal(refreshes, 1);
    const updated = JSON.parse(
      decrypt(
        (
          await db.get("SELECT * FROM calendar_connections WHERE id=?", [
            conn.id,
          ])
        ).credentials_enc,
      ),
    );
    assert.equal(updated.refresh_token, "refresh-value");
  } finally {
    network.request = original;
  }
});
test("OAuth success persists discovered calendars without exposing provider tokens", async () => {
  const originalExchange = providers.exchange,
    originalDiscover = providers.discover;
  providers.exchange = async () => ({
    access_token: "provider-secret",
    refresh_token: "refresh-secret",
    expiresAt: Date.now() + 3600000,
  });
  providers.discover = async () => [
    { remoteId: "one", name: "Google One", readOnly: false },
    { remoteId: "two", name: "Google Two", readOnly: true },
  ];
  try {
    const started = await call("/calendar/oauth/google/start", {}),
      state = new URL(started.data.url).searchParams.get("state");
    const result = await fetch(
      base +
        "/calendar/oauth/google/callback?state=" +
        state +
        "&code=fake-code",
      {
        headers: { Cookie: "post_calendar_state=" + state },
        redirect: "manual",
      },
    );
    assert.equal(result.status, 302);
    assert.equal(
      result.headers.get("location"),
      "/?view=calendar&calendarConnected=1",
    );
    const list = await call("/calendar/calendars");
    assert.ok(list.data.calendars.some((c) => c.name === "Google One"));
    assert.equal(JSON.stringify(list.data).includes("provider-secret"), false);
  } finally {
    providers.exchange = originalExchange;
    providers.discover = originalDiscover;
  }
});
test("ICS exceptions, excluded dates and alarm properties survive roundtrip", () => {
  const text =
    "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:series-test\r\nSUMMARY:Master\r\nDTSTART:20261011T100000Z\r\nDTEND:20261011T110000Z\r\nRRULE:FREQ=DAILY;COUNT=3\r\nEXDATE:20261012T100000Z\r\nBEGIN:VALARM\r\nACTION:DISPLAY\r\nDESCRIPTION:Reminder\r\nTRIGGER:-PT15M\r\nEND:VALARM\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:series-test\r\nRECURRENCE-ID:20261013T100000Z\r\nSUMMARY:Moved\r\nDTSTART:20261013T120000Z\r\nDTEND:20261013T130000Z\r\nEND:VEVENT\r\nEND:VCALENDAR";
  const rows = ics.expand(text, "2026-10-01", "2026-11-01");
  assert.equal(rows.length, 2);
  assert.equal(rows[1].title, "Moved");
  assert.equal(rows[1].start, "2026-10-13T12:00:00.000Z");
  const updated = ics.build({ ...rows[0].series, title: "Changed" }, text);
  assert.ok(updated.includes("BEGIN:VALARM"));
  assert.ok(updated.includes("RECURRENCE-ID"));
  assert.equal(ics.expand(updated, "2026-10-01", "2026-11-01").length, 2);
});
test("Microsoft writes use Graph, UTC times and optimistic concurrency", async () => {
  const original = network.request;
  const row = await db.run(
    "INSERT INTO calendar_connections(account_id,kind,name,credentials_enc) VALUES(?,?,?,?)",
    [
      1,
      "microsoft",
      "Graph test",
      encrypt(
        JSON.stringify({
          access_token: "fresh",
          expiresAt: Date.now() + 3600000,
        }),
      ),
    ],
  );
  const conn = await db.get("SELECT * FROM calendar_connections WHERE id=?", [
    row.lastID,
  ]);
  let request;
  network.request = async (url, opts) => {
    request = { url, ...opts };
    return { status: 200, headers: {}, text: "{}" };
  };
  try {
    await providers.writeEvent(
      { remote_id: "graph-calendar" },
      conn,
      "event/id",
      ics.validate({
        title: "Graph edit",
        start: "2026-10-11T10:00:00Z",
        end: "2026-10-11T11:00:00Z",
      }),
      'W/"revision"',
    );
    assert.equal(request.method, "PATCH");
    assert.equal(request.headers["If-Match"], 'W/"revision"');
    assert.ok(request.url.endsWith("event%2Fid"));
    assert.equal(JSON.parse(request.body).start.timeZone, "UTC");
  } finally {
    network.request = original;
  }
});
test("private addresses, credential-bearing URLs, foreign hrefs and XML entities are rejected", () => {
  for (const ip of [
    "127.0.0.1",
    "10.0.0.1",
    "169.254.169.254",
    "::1",
    "::ffff:127.0.0.1",
  ])
    assert.equal(network.publicAddress(ip), false);
  assert.equal(network.publicAddress("8.8.8.8"), true);
  assert.throws(() =>
    network.calendarUrl("https://user:password@example.com/cal"),
  );
  assert.throws(() =>
    providers.sameOrigin(
      "https://evil.example/cal",
      "https://calendar.example/cal/",
    ),
  );
  assert.throws(() =>
    providers.sameOrigin(
      "/other/event.ics",
      "https://calendar.example/cal/",
      true,
    ),
  );
  assert.throws(() =>
    providers.responses('<!DOCTYPE x [<!ENTITY x "boom">]><d:multistatus/>'),
  );
});
test("calendar mounts in the production app and uses the existing bearer session", async () => {
  const production = require("../src/index").app.listen(0, "127.0.0.1");
  await new Promise((r) => production.once("listening", r));
  try {
    const url = "http://127.0.0.1:" + production.address().port;
    const health = await (await fetch(url + "/api/health")).json();
    assert.equal(health.version, "1.2.1");
    const denied = await fetch(url + "/api/calendar/calendars");
    assert.equal(denied.status, 401);
    const list = await fetch(url + "/api/calendar/calendars", {
      headers: { Authorization: "Bearer a" },
    });
    assert.equal(list.status, 200);
    assert.ok((await list.json()).calendars.length);
  } finally {
    await new Promise((r) => production.close(r));
  }
});
test("failed remote provider does not hide local appointments", async () => {
  const original = network.request;
  network.request = async () => ({
    status: 503,
    headers: {},
    text: "unavailable",
  });
  try {
    const list = await call("/calendar/calendars"),
      remoteCalendar = list.data.calendars.find((c) => c.name === "Google One");
    const result = await call(
      "/calendar/events?start=2026-10-01&end=2026-11-01&calendars=" +
        calendarId +
        "," +
        remoteCalendar.id,
    );
    assert.equal(result.status, 200);
    assert.ok(result.data.events.some((e) => e.calendarId === calendarId));
    assert.equal(result.data.errors[0].calendarId, remoteCalendar.id);
  } finally {
    network.request = original;
  }
});

test("OAuth setup is encrypted, account-scoped and never returns the client secret", async () => {
  const other = await call("/calendar/config", null, "GET", "b");
  assert.equal(other.data.oauthSetup.google.clientId, "test-client");
  assert.equal(JSON.stringify(other.data).includes("test-secret"), false);
  const profile = {
    baseUrl: "https://mail.example.org",
    clientId: "personal-client",
    clientSecret: "personal-secret",
  };
  const saved = await call("/calendar/oauth/google/config", profile);
  assert.equal(saved.status, 200);
  assert.equal(saved.data.google, true);
  assert.equal(saved.data.oauthSetup.google.secretSaved, true);
  assert.equal(JSON.stringify(saved.data).includes("personal-secret"), false);
  const row = await db.get(
    "SELECT * FROM calendar_oauth_configs WHERE account_id=1 AND provider='google'",
  );
  assert.equal(row.config_enc.includes("personal-secret"), false);
  assert.equal(
    JSON.parse(decrypt(row.config_enc)).clientSecret,
    "personal-secret",
  );
  assert.equal(
    (await call("/calendar/config", null, "GET", "b")).data.oauthSetup.google
      .clientId,
    "test-client",
  );
  assert.equal(
    (
      await call("/calendar/oauth/google/config", {
        ...profile,
        clientSecret: "",
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await call("/calendar/oauth/google/config", {
        ...profile,
        clientId: "changed-client",
        clientSecret: "",
      })
    ).status,
    400,
  );
  await require("../src/calendar").initCalendar();
  assert.equal(
    (await call("/calendar/config")).data.oauthSetup.google.clientId,
    "personal-client",
  );
  assert.ok(
    (await db.all("PRAGMA table_info(calendar_oauth_states)")).some(
      (c) => c.name === "config_enc",
    ),
  );
});

test("OAuth setup rejects invalid Google IP and HTTP redirects and invalid Microsoft tenants", async () => {
  const profile = { clientId: "id", clientSecret: "secret" };
  assert.equal((await call("/calendar/oauth/google/config", null, "POST")).status, 400);
  assert.equal((await call("/calendar/oauth/google/config", { ...profile, baseUrl: "https://mail.example.org" }, "POST", "invalid-token")).status, 401);
  for (const baseUrl of [
    "https://37.201.118.206:33411",
    "http://mail.example.org",
    "https://user:pass@mail.example.org",
    "https://mail.example.org/subpath",
    "https://mail.example.org/#x",
    "https://[2001:db8::1]",
  ])
    assert.equal(
      (await call("/calendar/oauth/google/config", { ...profile, baseUrl }))
        .status,
      400,
    );
  assert.equal(
    (
      await call("/calendar/oauth/microsoft/config", {
        ...profile,
        baseUrl: "https://mail.example.org",
        tenant: "../evil",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await call("/calendar/oauth/unknown/config", {
        ...profile,
        baseUrl: "https://mail.example.org",
      })
    ).status,
    400,
  );
});

test("OAuth start requires the configured browser origin and snapshots its encrypted configuration", async () => {
  const denied = await call("/calendar/oauth/google/start", {}, "POST", "a", {
    Origin: "http://37.201.118.206:33411",
  });
  assert.equal(denied.status, 400);
  assert.equal(denied.data.error, "calendar.errors.oauthOrigin");
  const allowed = await call("/calendar/oauth/google/start", {}, "POST", "a", {
    Origin: "https://mail.example.org",
  });
  assert.equal(allowed.status, 200);
  const url = new URL(allowed.data.url),
    state = url.searchParams.get("state");
  assert.equal(url.searchParams.get("client_id"), "personal-client");
  assert.equal(
    url.searchParams.get("redirect_uri"),
    "https://mail.example.org/api/calendar/oauth/google/callback",
  );
  assert.match(allowed.headers.get("set-cookie"), /Secure/);
  const snapshot = await db.get(
    "SELECT config_enc FROM calendar_oauth_states WHERE state_hash=?",
    [sha256(state)],
  );
  assert.equal(snapshot.config_enc.includes("personal-secret"), false);
  assert.equal(
    JSON.parse(decrypt(snapshot.config_enc)).clientId,
    "personal-client",
  );
});

test("OAuth callback and token refresh retain their client even when account setup changes", async () => {
  const oldExchange = providers.exchange,
    oldDiscover = providers.discover,
    oldRequest = network.request;
  const started = await call("/calendar/oauth/google/start", {});
  const state = new URL(started.data.url).searchParams.get("state");
  await call("/calendar/oauth/google/config", {
    baseUrl: "https://mail.example.org",
    clientId: "new-client",
    clientSecret: "new-secret",
  });
  let usedProfile;
  providers.exchange = async (provider, params, profile) => {
    usedProfile = profile;
    return {
      access_token: "expired-account-token",
      refresh_token: "account-refresh",
      expiresAt: 0,
    };
  };
  providers.discover = async () => [
    { remoteId: "stable-client", name: "Stable OAuth client" },
  ];
  try {
    const callback = await fetch(
      base +
        "/calendar/oauth/google/callback?state=" +
        state +
        "&code=fake-code",
      {
        headers: { Cookie: "post_calendar_state=" + state },
        redirect: "manual",
      },
    );
    assert.equal(
      callback.headers.get("location"),
      "/?view=calendar&calendarConnected=1",
    );
    assert.equal(usedProfile.clientId, "personal-client");
    const conn = await db.get(
      "SELECT x.* FROM calendar_connections x JOIN calendars c ON c.connection_id=x.id WHERE c.name='Stable OAuth client'",
    );
    assert.equal(
      JSON.parse(decrypt(conn.credentials_enc)).oauth.clientSecret,
      "personal-secret",
    );
    providers.exchange = oldExchange;
    network.request = async (url, opts) => {
      if (url.includes("oauth2.googleapis.com")) {
        const params = new URLSearchParams(opts.body);
        assert.equal(params.get("client_id"), "personal-client");
        assert.equal(params.get("client_secret"), "personal-secret");
        return {
          status: 200,
          headers: {},
          text: JSON.stringify({
            access_token: "fresh-account-token",
            expires_in: 3600,
          }),
        };
      }
      assert.equal(opts.headers.Authorization, "Bearer fresh-account-token");
      return { status: 200, headers: {}, text: JSON.stringify({ items: [] }) };
    };
    assert.deepEqual(
      await providers.listEvents(
        { remote_id: "stable-client" },
        conn,
        "2026-10-01",
        "2026-11-01",
      ),
      [],
    );
    const listing = await call("/calendar/calendars");
    assert.equal(
      JSON.stringify(listing.data).includes("personal-secret"),
      false,
    );
  } finally {
    providers.exchange = oldExchange;
    providers.discover = oldDiscover;
    network.request = oldRequest;
  }
});
