import { test } from "node:test";
import assert from "node:assert/strict";
import { readApiResponse, mailStatesChanged } from "../src/lib/apiResponse.js";
test("HTML proxy error pages and empty responses become useful errors instead of JSON syntax errors", async () => {
  for (const [status, message] of [
    [502, "apiUnavailable"],
    [503, "apiUnavailable"],
    [504, "apiTimeout"],
    [200, "apiInvalidResponse"],
  ]) {
    await assert.rejects(
      readApiResponse(
        new Response("<html>Proxy error</html>", {
          status,
          headers: { "x-request-id": "test-123" },
        }),
      ),
      { message, status, requestId: "test-123" },
    );
  }
  await assert.rejects(readApiResponse(new Response("")), {
    message: "apiInvalidResponse",
  });
});
test("JSON responses retain arrays, null, server error codes and safe request references", async () => {
  assert.deepEqual(await readApiResponse(new Response('[{"uid":1}]')), [
    { uid: 1 },
  ]);
  assert.equal(await readApiResponse(new Response("null")), null);
  await assert.rejects(
    readApiResponse(
      new Response('{"error":"mailTimeout","code":"IMAP_TIMEOUT"}', {
        status: 504,
        headers: { "x-request-id": "safe-id" },
      }),
    ),
    { message: "mailTimeout", code: "IMAP_TIMEOUT", requestId: "safe-id" },
  );
});
test("attachment conflict responses preserve only the fields needed for explicit user choice", async () => {
  let caught;
  try {
    await readApiResponse(
      new Response(
        JSON.stringify({
          error: "attachmentSave.conflict",
          code: "ATTACHMENT_NAME_CONFLICT",
          conflict: {
            name: "report.pdf",
            canReplace: true,
            token: "opaque-confirmation",
            credentials: "must-not-copy",
          },
        }),
        { status: 409 },
      ),
    );
  } catch (error) {
    caught = error;
  }
  assert.deepEqual(caught.conflict, {
    name: "report.pdf",
    canReplace: true,
    token: "opaque-confirmation",
  });
  assert.ok(!JSON.stringify(caught).includes("must-not-copy"));
  await assert.rejects(
    readApiResponse(
      new Response(
        JSON.stringify({
          error: "missing",
          code: "OTHER",
          conflict: { token: "untrusted" },
        }),
        { status: 404 },
      ),
    ),
    (error) => !error.conflict,
  );
});

test("unchanged mailbox states skip reloads while counts, flags and UID resets trigger updates", () => {
  const state = {
    folder: "INBOX",
    total: 10,
    unseen: 2,
    uidNext: 12,
    uidValidity: "1",
    highestModseq: "7",
  };
  const before = new Map([[state.folder, state]]);
  assert.equal(mailStatesChanged(null, [state]), true);
  assert.equal(mailStatesChanged(before, [{ ...state }]), false);
  for (const [key, value] of [
    ["total", 11],
    ["unseen", 1],
    ["uidNext", 13],
    ["uidValidity", "2"],
    ["highestModseq", "8"],
  ])
    assert.equal(mailStatesChanged(before, [{ ...state, [key]: value }]), true);
});
test("API timeouts and caller aborts stay distinct and remove mail queries from error details", async () => {
  globalThis.localStorage = {
    getItem: () => null,
    setItem() {},
    removeItem() {},
  };
  const { api } = await import("../src/api.js");
  const previous = globalThis.fetch;
  globalThis.fetch = (_url, options) =>
    new Promise((resolve, reject) => {
      if (options.signal.aborted) return reject(options.signal.reason);
      options.signal.addEventListener(
        "abort",
        () => reject(options.signal.reason),
        { once: true },
      );
    });
  try {
    await assert.rejects(
      api("/messages?folder=private&q=secret", { timeoutMs: 15 }),
      { message: "apiTimeout", endpoint: "/messages" },
    );
    const controller = new AbortController();
    const call = api("/message?uid=10", {
      signal: controller.signal,
      timeoutMs: 200,
    });
    controller.abort();
    await assert.rejects(call, { name: "AbortError" });
  } finally {
    globalThis.fetch = previous;
  }
});
