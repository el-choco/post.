const http = require("node:http");
const https = require("node:https");
const { fail } = require("./calendarNetwork");

function origin(value, internal = false) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw fail("office.errors.config", 503);
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/" ||
    !["http:", "https:"].includes(url.protocol) ||
    (!internal && url.protocol !== "https:" && !local)
  )
    throw fail("office.errors.config", 503);
  return url.origin;
}
function config() {
  if (process.env.ONLYOFFICE_ENABLED !== "true") return { enabled: false };
  const secret = process.env.ONLYOFFICE_JWT_SECRET || "";
  if (secret.length < 32) throw fail("office.errors.config", 503);
  const publicUrl = origin(process.env.ONLYOFFICE_URL);
  const internalUrl = origin(
    process.env.ONLYOFFICE_INTERNAL_URL || publicUrl,
    true,
  );
  const callbackBase = origin(
    process.env.ONLYOFFICE_CALLBACK_BASE_URL || process.env.PUBLIC_BASE_URL,
    true,
  );
  const mb = Number(process.env.ONLYOFFICE_MAX_FILE_MB || 50);
  if (!Number.isSafeInteger(mb) || mb < 1 || mb > 100)
    throw fail("office.errors.config", 503);
  return {
    enabled: true,
    secret,
    publicUrl,
    internalUrl,
    callbackBase,
    maxSize: mb * 1024 ** 2,
  };
}
function savedUrl(value, cfg = config()) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw fail("office.errors.remote", 502);
  }
  if (
    url.username ||
    url.password ||
    url.hash ||
    ![cfg.publicUrl, cfg.internalUrl].includes(url.origin) ||
    !/^\/cache\/files\/[A-Za-z0-9._~%/-]+$/.test(url.pathname) ||
    url.pathname
      .split("/")
      .some((p) => [".", ".."].includes(decodeURIComponent(p)))
  )
    throw fail("office.errors.remote", 502);
                                                                            
                                                                              
  return cfg.internalUrl + url.pathname + url.search;
}
async function download(value, cfg = config()) {
  const url = new URL(savedUrl(value, cfg));
  const response = await new Promise((resolve, reject) => {
    const req = (url.protocol === "https:" ? https : http).get(url, resolve);
    req.setTimeout(60000, () =>
      req.destroy(fail("office.errors.timeout", 504)),
    );
    req.on("error", reject);
  });
  if (response.statusCode !== 200) {
    response.destroy();
    throw fail("office.errors.remote", 502);
  }
  if (Number(response.headers["content-length"]) > cfg.maxSize) {
    response.destroy();
    throw fail("office.errors.size", 413);
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of response) {
    size += chunk.length;
    if (size > cfg.maxSize) {
      response.destroy();
      throw fail("office.errors.size", 413);
    }
    chunks.push(chunk);
  }
  if (!size) throw fail("office.errors.remote", 502);
  return Buffer.concat(chunks);
}
module.exports = { origin, config, savedUrl, download };
