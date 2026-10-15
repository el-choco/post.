const mailRoutes = new Set([
  "/messages",
  "/message",
  "/folders",
  "/poll",
  "/search",
  "/attachment",
  "/source",
]);
const errors = new Set([
  "apiTimeout",
  "apiUnavailable",
  "apiInvalidResponse",
  "mailTimeout",
  "mailConnection",
]);
export function diagnosticFailure(path, error, durationMs) {
  const route = path.split("?")[0];
  if (!mailRoutes.has(route) || error?.name === "AbortError") return null;
  return {
    route: "/api" + route,
    status: Number.isInteger(error?.status) ? error.status : 0,
    durationMs,
    errorCode: errors.has(error?.message) ? error.message : "HTTP_ERROR",
    requestId: /^[a-f0-9-]{36}$/i.test(error?.requestId || "")
      ? error.requestId
      : "",
  };
}
export async function reportDiagnosticFailure(entry, token, transport = fetch) {
  if (!entry || !token) return;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    await transport("/api/diagnostics/client", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(entry),
      signal: controller.signal,
    });
  } catch {
  } finally {
    clearTimeout(timer);
  }
}
