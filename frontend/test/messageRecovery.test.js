import { test } from "node:test";
import assert from "node:assert/strict";
import { readApiResponse } from "../src/lib/apiResponse.js";
import {
  isMissingMessage,
  clearMissingMessageRoute,
} from "../src/lib/messageRecovery.js";
import { diagnosticFailure } from "../src/lib/diagnosticsClient.js";

test("a missing-message API response is recognized without treating unrelated failures as missing mail", async () => {
  let error;
  try {
    await readApiResponse(
      new Response(
        JSON.stringify({
          error: "messageUnavailable",
          code: "MESSAGE_NOT_FOUND",
        }),
        { status: 404 },
      ),
    );
  } catch (value) {
    error = value;
  }
  assert.ok(
    isMissingMessage({
      ...error,
      message: error.message,
      endpoint: "/message",
    }),
  );
  assert.ok(isMissingMessage({ status: 404, message: "Message not found" }));
  for (const unrelated of [
    { status: 404, message: "Not found" },
    { status: 404, message: "Attachment not found", endpoint: "/attachment" },
    { status: 404, code: "MESSAGE_NOT_FOUND", endpoint: "/source" },
    { status: 504, code: "IMAP_TIMEOUT" },
    { status: 401, message: "sessionExpired" },
    { status: 502, code: "MESSAGE_NOT_FOUND" },
    null,
  ])
    assert.equal(isMissingMessage(unrelated), false);
});

test("leaving a missing message preserves unrelated URL state and does not reopen a different message", () => {
  const current = new URLSearchParams({
    view: "message",
    folder: "Projects/2026",
    uid: "42",
    retained: "yes",
  });
  const next = clearMissingMessageRoute(current, {
    folder: "Projects/2026",
    uid: 42,
  });
  assert.equal(next.toString(), "retained=yes");
  assert.equal(current.get("uid"), "42");
  for (const params of [
    new URLSearchParams({
      view: "message",
      folder: "Projects/2026",
      uid: "43",
    }),
    new URLSearchParams({ view: "message", folder: "INBOX", uid: "42" }),
    new URLSearchParams({ view: "contacts" }),
    new URLSearchParams({ view: "settings" }),
  ])
    assert.equal(
      clearMissingMessageRoute(params, { folder: "Projects/2026", uid: 42 }),
      params,
    );
  assert.equal(
    clearMissingMessageRoute(new URLSearchParams("view=message&uid=42"), {
      folder: "INBOX",
      uid: 42,
    }).toString(),
    "",
  );
});

test("missing-message diagnostics keep the specific code without including mail details", () => {
  const entry = diagnosticFailure(
    "/message?uid=42&folder=private",
    { status: 404, code: "MESSAGE_NOT_FOUND", message: "private subject" },
    500,
  );
  assert.equal(entry.errorCode, "MESSAGE_NOT_FOUND");
  assert.equal(entry.route, "/api/message");
  assert.ok(!JSON.stringify(entry).includes("private"));
  assert.equal(
    diagnosticFailure(
      "/attachment",
      { status: 404, code: "MESSAGE_NOT_FOUND" },
      500,
    ).errorCode,
    "HTTP_ERROR",
  );
});
