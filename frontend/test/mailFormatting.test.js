import test from "node:test";
import assert from "node:assert/strict";
import {
  formatDate,
  formatTime,
  replyText,
  signatureText,
  exportContacts,
  emoticons,
  contactSortKey,
} from "../src/lib/mailFormatting.js";
import fs from "node:fs";
const defaults = JSON.parse(
  fs.readFileSync(new URL("../src/lib/preferences.json", import.meta.url)),
);
test("message dates respect timezone, date format and twelve-hour preference", () => {
  const value = "2025-12-31T23:30:00Z";
  assert.equal(formatDate(value, defaults), "01.01.2026");
  assert.equal(
    formatDate(value, {
      ...defaults,
      timezone: "UTC",
      dateFormat: "yyyy-MM-dd",
    }),
    "2025-12-31",
  );
  assert.match(
    formatTime(value, { ...defaults, language: "en", timeFormat: "12" }),
    /12:30/,
  );
});
test("reply placement and signature settings remove the original signature", () => {
  const message = {
    date: "2026-01-01T10:00:00Z",
    from: { name: "Ada" },
    text: "Hello\n-- \nOld signature",
  };
  const settings = {
    ...defaults,
    signature: "New signature",
    replyPosition: "below",
  };
  const text = replyText(message, settings);
  assert.ok(!text.includes("Old signature"));
  assert.ok(text.indexOf("> Hello") < text.indexOf("New signature"));
  assert.equal(signatureText({ ...settings, signatureMode: "never" }), "");
});
test("contact exports preserve quotes, newlines and multiple email addresses", () => {
  const contact = {
    name: 'Ada "A"',
    email: "ada@example.org",
    phone: "123",
    note: "one\ntwo",
    profile: {
      firstName: "Ada",
      lastName: "Example",
      emails: [
        { type: "home", value: "ada@example.org" },
        { type: "work", value: "work@example.org" },
      ],
      phones: [],
      addresses: [],
    },
  };
  assert.match(exportContacts([contact], "csv"), /Ada ""A""/);
  const vcard = exportContacts([contact], "vcard");
  assert.match(vcard, /EMAIL;TYPE=WORK:work@example.org/);
  assert.match(vcard, /NOTE:one\\ntwo/);
  assert.equal(contactSortKey(contact, defaults), "Example");
});
test("plain text emoticons change only at word boundaries", () => {
  assert.equal(emoticons("Hi :) :D"), "Hi 🙂 😃");
  assert.equal(emoticons("url:)example"), "url:)example");
});
