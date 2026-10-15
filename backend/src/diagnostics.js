const { run, get, all } = require("./db");
const { phases } = require("./diagnosticsTrace");
const version = require("../package.json").version;
const RETENTION_DAYS = 7,
  MAX_ENTRIES = 1000;
const routes = new Set([
  "/api/messages",
  "/api/message",
  "/api/folders",
  "/api/poll",
  "/api/search",
  "/api/attachment",
  "/api/source",
]);
const codes = new Set([
  "IMAP_TIMEOUT",
  "IMAP_CANCELLED",
  "ETIMEDOUT",
  "ETIMEOUT",
  "ECONNRESET",
  "ECONNREFUSED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "EPIPE",
  "ECONNABORTED",
  "AUTHENTICATIONFAILED",
  "ConnectionClosed",
  "NoConnection",
  "apiTimeout",
  "apiUnavailable",
  "apiInvalidResponse",
  "mailTimeout",
  "mailConnection",
  "HTTP_ERROR",
  "UNKNOWN_ERROR",
  "CLIENT_ABORT",
]);
const cutoff = () => Date.now() - RETENTION_DAYS * 86400000;
const bounded = (value, max) =>
  Number.isFinite(value) ? Math.min(max, Math.max(0, Math.round(value))) : 0;
const errorCode = (error) =>
  codes.has(error?.code) ? error.code : error ? "UNKNOWN_ERROR" : "";
const requestId = (value) =>
  typeof value === "string" &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value)
    ? value
    : "";
let queue = Promise.resolve(),
  pending = 0;
function sanitize(entry) {
  if (!entry || !routes.has(entry.route)) return null;
  const status = bounded(entry.status, 599);
  const durationMs = bounded(entry.durationMs, 86400000);
  return {
    source: entry.source === "browser" ? "browser" : "backend",
    route: entry.route,
    status,
    durationMs,
    requestId: requestId(entry.requestId),
    errorCode: codes.has(entry.errorCode)
      ? entry.errorCode
      : entry.errorCode
        ? "UNKNOWN_ERROR"
        : "",
    level:
      status === 499
        ? "info"
        : status === 0 || status >= 400
          ? "error"
          : durationMs >= 3000
            ? "warning"
            : "info",
    stages: (Array.isArray(entry.stages) ? entry.stages : [])
      .filter((stage) => phases.has(stage?.phase))
      .slice(0, phases.size)
      .map((stage) => ({
        phase: stage.phase,
        durationMs: bounded(stage.durationMs, 86400000),
        count: bounded(stage.count, 100000),
        active: stage.active === true,
      })),
  };
}
async function initDiagnostics() {
  await run(
    `CREATE TABLE IF NOT EXISTS diagnostic_events (id INTEGER PRIMARY KEY AUTOINCREMENT,account_id INTEGER NOT NULL REFERENCES mail_accounts(id) ON DELETE CASCADE,created_at INTEGER NOT NULL,payload TEXT NOT NULL)`,
  );
  await run(
    "CREATE INDEX IF NOT EXISTS diagnostic_events_account ON diagnostic_events(account_id,id DESC)",
  );
  await run(
    "CREATE INDEX IF NOT EXISTS diagnostic_events_age ON diagnostic_events(created_at)",
  );
  await cleanup();
}
function record(accountId, value) {
  const entry = sanitize(value);
  if (
    !Number.isSafeInteger(accountId) ||
    accountId <= 0 ||
    !entry ||
    pending >= 200
  )
    return Promise.resolve(false);
  const at = Date.now();
  pending++;
  queue = queue
    .catch(() => {})
    .then(async () => {
      try {
        if (entry.source === "browser") {
          const recent = await get(
            "SELECT COUNT(*) AS total FROM diagnostic_events WHERE account_id=? AND created_at>=? AND json_extract(payload,'$.source')='browser'",
            [accountId, Date.now() - 60000],
          );
          if (recent.total >= 30) return "limited";
        }
        await run(
          "INSERT INTO diagnostic_events(account_id,created_at,payload) VALUES(?,?,?)",
          [accountId, at, JSON.stringify({ ...entry, version })],
        );
        await run(
          "DELETE FROM diagnostic_events WHERE account_id=? AND (created_at<? OR id <= COALESCE((SELECT id FROM diagnostic_events WHERE account_id=? ORDER BY id DESC LIMIT 1 OFFSET ?),0))",
          [accountId, cutoff(), accountId, MAX_ENTRIES],
        );
        return true;
      } catch {
        return false;
      } finally {
        pending--;
      }
    });
  return queue;
}
async function cleanup() {
  await run("DELETE FROM diagnostic_events WHERE created_at<?", [cutoff()]);
}
const flush = () => queue;
function decode(row) {
  return {
    id: row.id,
    at: new Date(row.created_at).toISOString(),
    ...JSON.parse(row.payload),
  };
}
async function entries(accountId, filter = "all", limit = 200) {
  await flush();
  const rows = await all(
    "SELECT id,created_at,payload FROM diagnostic_events WHERE account_id=? AND created_at>=? ORDER BY id DESC LIMIT ?",
    [accountId, cutoff(), MAX_ENTRIES],
  );
  const selected = rows
    .map(decode)
    .filter((row) =>
      filter === "errors"
        ? row.level === "error"
        : filter === "slow"
          ? row.durationMs >= 3000
          : true,
    );
  return {
    entries: selected.slice(0, limit),
    total: selected.length,
    limit,
    retentionDays: RETENTION_DAYS,
    maxEntries: MAX_ENTRIES,
    version,
  };
}
function createDiagnosticsRouter(auth, wrap) {
  const router = require("express").Router();
  router.use(auth);
  router.use((req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  router.get(
    "/",
    wrap(async (req, res) =>
      res.json(await entries(req.account.id, req.query.filter)),
    ),
  );
  router.get(
    "/export",
    wrap(async (req, res) => {
      const data = await entries(req.account.id, "all", MAX_ENTRIES);
      res.setHeader(
        "Content-Disposition",
        'attachment; filename="post-diagnostics.json"',
      );
      res
        .type("json")
        .send(
          JSON.stringify(
            { ...data, exportedAt: new Date().toISOString() },
            null,
            2,
          ),
        );
    }),
  );
  router.post(
    "/client",
    wrap(async (req, res) => {
      const entry = sanitize({ ...req.body, source: "browser", stages: [] });
      if (!entry || !entry.errorCode || entry.status === 499)
        return res.status(400).json({ error: "Invalid diagnostic event" });
      const saved = await record(req.account.id, entry);
      if (saved === "limited")
        return res.status(429).json({ error: "Too many diagnostic events" });
      if (!saved)
        return res
          .status(503)
          .json({ error: "Diagnostic storage unavailable" });
      res.json({ success: true });
    }),
  );
  return router;
}
module.exports = {
  initDiagnostics,
  record,
  entries,
  flush,
  cleanup,
  createDiagnosticsRouter,
  sanitize,
  errorCode,
  routes,
};
