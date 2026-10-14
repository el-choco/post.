const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "post-theme-test-"));
process.env.DATA_DIR = temp;
const db = require("../src/db");
const { encrypt, sha256 } = require("../src/crypto");
const { app } = require("../src/index");
const { normalizeAppearance } = require("../src/appearance");
const defaults = require("../src/preferences.json").appearance;
let server, base;
async function call(token, body) {
  const response = await fetch(base + "/api/settings", {
    method: body ? "PUT" : "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: await response.json() };
}
before(async () => {
  await db.init();
  for (const [email, token] of [
    ["theme-a@example.test", "theme-a"],
    ["theme-b@example.test", "theme-b"],
  ]) {
    const row = await db.run(
      "INSERT INTO mail_accounts(email,password_enc,imap_host,imap_port,imap_secure,imap_user,smtp_host,smtp_port,smtp_secure,smtp_user,created_at) VALUES(?,?,?,993,1,?,?,465,1,?,?)",
      [
        email,
        encrypt("test-only"),
        "imap.test",
        email,
        "smtp.test",
        email,
        Date.now(),
      ],
    );
    await db.run(
      "INSERT INTO sessions(token_hash,account_id,expires_at) VALUES(?,?,?)",
      [sha256(token), row.lastID, Date.now() + 60000],
    );
  }
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  base = "http://127.0.0.1:" + server.address().port;
});
after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await new Promise((resolve) => db.db.close(resolve));
  fs.rmSync(temp, { recursive: true, force: true });
});
test("existing accounts receive independent theme defaults without a migration", async () => {
  assert.deepEqual((await call("theme-a")).body.appearance, defaults);
  assert.deepEqual((await call("theme-b")).body.appearance, defaults);
  assert.equal((await call("invalid")).status, 401);
});
test("theme API persists only the authenticated account and preserves themes on unrelated saves", async () => {
  const appearance = {
    ...defaults,
    font: "georgia",
    fontSize: 19,
    light: { ...defaults.light, accent: "#AA33BB", background: "#e2ddf4" },
  };
  const saved = await call("theme-a", { appearance });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.appearance.light.accent, "#aa33bb");
  assert.equal(saved.body.appearance.font, "georgia");
  const row = await db.get("SELECT settings FROM mail_accounts WHERE email=?", [
    "theme-a@example.test",
  ]);
  assert.deepEqual(JSON.parse(row.settings).appearance, saved.body.appearance);
  assert.deepEqual(
    (await call("theme-a", { pageSize: 35 })).body.appearance,
    saved.body.appearance,
  );
  assert.deepEqual((await call("theme-b")).body.appearance, defaults);
  assert.equal((await call("theme-a")).body.pageSize, 35);
});
test("theme settings reject CSS, URL fonts, malformed colors, oversized sizes and unknown fields", async () => {
  const before = (await call("theme-a")).body.appearance;
  const saved = await call("theme-a", {
    appearance: {
      font: "url(https://evil.test/font)",
      fontSize: 10000,
      css: "body{display:none}",
      light: {
        accent: "red; background:url(https://evil.test/track)",
        surface: ["#ffffff"],
        text: { color: "#000000" },
      },
    },
  });
  assert.deepEqual(saved.body.appearance, before);
  for (const input of [
    null,
    [],
    "#ffffff",
    { fontSize: "20", dark: { accent: "#abc" } },
    { light: { accent: ["#ffffff"] } },
  ]) {
    assert.deepEqual(normalizeAppearance(input), defaults);
  }
});
test("partial palette changes preserve the other mode and restoring defaults persists", async () => {
  const before = (await call("theme-a")).body.appearance;
  const saved = (
    await call("theme-a", { appearance: { dark: { accent: "#ABCDEF" } } })
  ).body.appearance;
  assert.equal(saved.dark.accent, "#abcdef");
  assert.deepEqual(saved.light, before.light);
  assert.equal(saved.fontSize, before.fontSize);
  assert.deepEqual(
    (await call("theme-a", { appearance: defaults })).body.appearance,
    defaults,
  );
  assert.deepEqual((await call("theme-a")).body.appearance, defaults);
});
