import { test } from "node:test";
import assert from "node:assert/strict";
import {
  diagnosticFailure,
  reportDiagnosticFailure,
} from "../src/lib/diagnosticsClient.js";
test("browser reports omit mail queries, raw errors and invalid request references", () => {
  const value = diagnosticFailure(
    "/messages?folder=private-folder&q=private-search",
    {
      message: "private-message",
      password: "private-password",
      requestId: "private-token",
      status: 504,
    },
    4000,
  );
  const serialized = JSON.stringify(value);
  for (const secret of [
    "private-folder",
    "private-search",
    "private-message",
    "private-password",
    "private-token",
  ])
    assert.ok(!serialized.includes(secret));
  assert.equal(value.route, "/api/messages");
  assert.equal(value.errorCode, "HTTP_ERROR");
  assert.equal(
    diagnosticFailure("/messages", { name: "AbortError" }, 50),
    null,
  );
  assert.equal(
    diagnosticFailure("/diagnostics", new Error("apiUnavailable"), 50),
    null,
  );
  assert.equal(
    diagnosticFailure("/calendar", new Error("apiUnavailable"), 50),
    null,
  );
});
test("diagnostic submission is authenticated, best effort and never recursively reports a failed log request", async () => {
  let calls = 0;
  const transport = async (path, options) => {
    calls++;
    assert.equal(path, "/api/diagnostics/client");
    assert.equal(options.headers.Authorization, "Bearer test-token");
    assert.equal(JSON.parse(options.body).errorCode, "apiTimeout");
    throw new TypeError("Failed to fetch");
  };
  const entry = diagnosticFailure(
    "/message?uid=12",
    new Error("apiTimeout"),
    45000,
  );
  await assert.doesNotReject(
    reportDiagnosticFailure(entry, "test-token", transport),
  );
  assert.equal(calls, 1);
  await reportDiagnosticFailure(null, "test-token", transport);
  await reportDiagnosticFailure(entry, null, transport);
  assert.equal(calls, 1);
});
