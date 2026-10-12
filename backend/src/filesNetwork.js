const https = require("node:https");
const dns = require("node:dns/promises");
const { publicAddress, fail } = require("./calendarNetwork");

// Provider-supplied upload/download URLs are resolved and pinned too. The CalDAV
// exception for LAN servers must never relax this boundary for file transfers.
async function request(
  value,
  { method = "GET", headers = {}, body, signal } = {},
) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash ||
    (url.port && url.port !== "443")
  )
    throw fail("files.errors.remote", 502);
  const records = await dns.lookup(url.hostname, { all: true });
  if (!records.length || records.some((r) => !publicAddress(r.address)))
    throw fail("files.errors.remote", 502);
  const record = records.find((r) => r.family === 4) || records[0];
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method,
        headers,
        signal,
        lookup: (_host, opts, cb) =>
          opts.all
            ? cb(null, [record])
            : cb(null, record.address, record.family),
      },
      resolve,
    );
    req.setTimeout(60000, () => req.destroy(fail("files.errors.timeout", 504)));
    req.on("error", reject);
    req.end(body);
  });
}
async function collect(res) {
  const chunks = [];
  let size = 0;
  for await (const chunk of res) {
    size += chunk.length;
    if (size > 4 * 1024 * 1024) {
      res.destroy();
      throw fail("files.errors.remote", 502);
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}
function check(status) {
  if (status >= 200 && status < 300) return;
  if ([409, 412].includes(status)) throw fail("files.errors.conflict", 409);
  if (status === 404) throw fail("files.errors.notFound", 404);
  if ([401, 403].includes(status)) throw fail("files.errors.remoteAuth", 502);
  if (status === 429) throw fail("files.errors.rate", 429);
  if (status === 507) throw fail("files.errors.quota", 507);
  throw fail("files.errors.remote", 502);
}
async function json(url, options = {}) {
  const res = await request(url, options),
    text = await collect(res);
  check(res.statusCode);
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw fail("files.errors.remote", 502);
  }
}
module.exports = { request, collect, check, json };
