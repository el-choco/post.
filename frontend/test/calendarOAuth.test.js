import { test } from "node:test";
import assert from "node:assert/strict";
import { oauthBaseUrl, oauthCallbackUrl } from "../src/lib/calendarOAuth.js";

test("OAuth form accepts canonical HTTPS roots and produces exact provider callbacks", () => {
  assert.equal(
    oauthBaseUrl("google", " https://mail.example.org:8443/ "),
    "https://mail.example.org:8443",
  );
  assert.equal(
    oauthCallbackUrl("google", "https://mail.example.org"),
    "https://mail.example.org/api/calendar/oauth/google/callback",
  );
  assert.equal(
    oauthCallbackUrl("microsoft", "https://mail.example.org/"),
    "https://mail.example.org/api/calendar/oauth/microsoft/callback",
  );
  assert.equal(
    oauthCallbackUrl("google", "https://mail.example.org", "mail"),
    "https://mail.example.org/api/mail/oauth/google/callback",
  );
  assert.equal(
    oauthCallbackUrl("microsoft", "https://mail.example.org", "mail"),
    "https://mail.example.org/api/mail/oauth/microsoft/callback",
  );
});
test("OAuth form rejects Google IP addresses and malformed origins, allowing local development", () => {
  for (const value of [
    "http://37.201.118.206:33411",
    "https://37.201.118.206",
    "https://[2001:db8::1]",
    "http://mail.example.org",
    "https://user:secret@mail.example.org",
    "https://mail.example.org/path",
    "https://mail.example.org/?query=1",
    "https://mail.example.org/#fragment",
  ])
    assert.equal(oauthBaseUrl("google", value), "");
  assert.equal(
    oauthBaseUrl("google", "http://localhost:8886"),
    "http://localhost:8886",
  );
  assert.equal(
    oauthBaseUrl("google", "http://127.0.0.1:8886"),
    "http://127.0.0.1:8886",
  );
});
