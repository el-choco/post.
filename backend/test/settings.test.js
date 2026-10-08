const test = require("node:test"),
  assert = require("node:assert/strict");
const {
  defaults,
  normalizeSettings,
  archiveParts,
} = require("../src/settings");
test("preference validation rejects invalid enums, caps numbers and accepts a valid timezone", () => {
  const s = normalizeSettings({
    externalImages: "unsafe",
    markReadDelay: 5,
    timezone: "America/New_York",
    contactPageSize: 999,
    collapseQuotes: -5,
    desktopNotifications: "yes",
    unexpected: "value",
  });
  assert.equal(s.externalImages, "ask");
  assert.equal(s.markReadDelay, 5);
  assert.equal(s.contactPageSize, 200);
  assert.equal(s.collapseQuotes, 0);
  assert.equal(s.desktopNotifications, false);
  assert.equal(s.timezone, "America/New_York");
  assert.equal(s.unexpected, undefined);
  assert.equal(
    normalizeSettings({ timezone: "invalid" }).timezone,
    "Europe/Berlin",
  );
});
test("archive paths use the selected timezone at a year boundary and sanitize sender separators", () => {
  const message = {
    envelope: {
      date: "2025-12-31T23:30:00Z",
      from: [{ address: "x/y@example.org" }],
    },
  };
  assert.deepEqual(
    archiveParts({ ...defaults, archiveStructure: "month" }, message, "INBOX"),
    ["2026", "01"],
  );
  assert.deepEqual(
    archiveParts(
      { ...defaults, timezone: "UTC", archiveStructure: "thunderbird" },
      message,
      "INBOX",
    ),
    ["2025", "2025-12"],
  );
  assert.deepEqual(
    archiveParts({ ...defaults, archiveStructure: "sender" }, message, "INBOX"),
    ["x_y@example.org"],
  );
});
test("frontend and server agree on the preference defaults", () => {
  assert.deepEqual(
    require("../../frontend/src/lib/preferences.json"),
    defaults,
  );
});
