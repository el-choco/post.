const https = require("node:https");
const http = require("node:http");
const dns = require("node:dns/promises");
const ipaddr = require("ipaddr.js");

function fail(code, status = 400) {
  return Object.assign(new Error(code), { status });
}
function publicAddress(address) {
  try {
    let ip = ipaddr.parse(address);
    if (ip.kind() === "ipv6" && ip.isIPv4MappedAddress())
      ip = ip.toIPv4Address();
    return ip.range() === "unicast";
  } catch {
    return false;
  }
}
function calendarUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw fail("calendar.errors.url");
  }
  const privateAllowed = process.env.ALLOW_PRIVATE_CALDAV === "true";
  if (
    (url.protocol !== "https:" &&
      !(privateAllowed && url.protocol === "http:")) ||
    url.username ||
    url.password ||
    url.hash
  )
    throw fail("calendar.errors.url");
  return url;
}
// Resolve once and pin the validated address for this request, including TLS SNI.
async function request(
  value,
  { method = "GET", headers = {}, body, redirects = 0 } = {},
) {
  const url = calendarUrl(value),
    host = url.hostname.replace(/^\[|\]$/g, "");
  const records = ipaddr.isValid(host)
    ? [{ address: host, family: ipaddr.parse(host).kind() === "ipv4" ? 4 : 6 }]
    : await dns.lookup(host, { all: true });
  if (
    !records.length ||
    (process.env.ALLOW_PRIVATE_CALDAV !== "true" &&
      records.some((r) => !publicAddress(r.address)))
  )
    throw fail("calendar.errors.privateHost");
  const record = records.find((r) => r.family === 4) || records[0];
  const result = await new Promise((resolve, reject) => {
    const req = (url.protocol === "https:" ? https : http).request(
      url,
      {
        method,
        headers,
        lookup: (_host, opts, cb) =>
          opts.all
            ? cb(null, [record])
            : cb(null, record.address, record.family),
      },
      (res) => {
        let size = 0;
        const chunks = [];
        res.on("data", (chunk) => {
          size += chunk.length;
          if (size > 10 * 1024 * 1024)
            res.destroy(fail("calendar.errors.tooLarge"));
          else chunks.push(chunk);
        });
        res.on("end", () =>
          resolve({
            status: res.statusCode,
            headers: res.headers,
            text: Buffer.concat(chunks).toString("utf8"),
          }),
        );
        res.on("error", reject);
      },
    );
    const timer = setTimeout(
      () => req.destroy(fail("calendar.errors.timeout", 504)),
      20000,
    );
    req.on("close", () => clearTimeout(timer));
    req.on("error", reject);
    req.end(body);
  });
  if ([301, 302, 307, 308].includes(result.status) && result.headers.location) {
    const target = new URL(result.headers.location, url);
    if (redirects >= 3 || target.origin !== url.origin)
      throw fail("calendar.errors.redirect");
    return request(target.href, {
      method,
      headers,
      body,
      redirects: redirects + 1,
    });
  }
  return result;
}
function check(result) {
  if (result.status >= 200 && result.status < 300) return result;
  if ([409, 412].includes(result.status))
    throw fail("calendar.errors.conflict", 409);
  if ([401, 403].includes(result.status))
    throw fail("calendar.errors.remoteAuth", 502);
  if (result.status === 404) throw fail("calendar.errors.notFound", 404);
  throw fail("calendar.errors.remote", 502);
}
module.exports = { request, check, calendarUrl, publicAddress, fail };
