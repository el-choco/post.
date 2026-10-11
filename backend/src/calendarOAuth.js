const net = require("node:net");
const db = require("./db");
const { encrypt, decrypt } = require("./crypto");
const { fail } = require("./calendarNetwork");

function environment(provider) {
  const prefix = provider === "google" ? "GOOGLE" : "MICROSOFT";
  return {
    baseUrl: process.env.PUBLIC_BASE_URL || "",
    clientId: process.env[prefix + "_CLIENT_ID"] || "",
    clientSecret: process.env[prefix + "_CLIENT_SECRET"] || "",
    tenant: process.env.MICROSOFT_TENANT_ID || "common",
  };
}
function validate(provider, input) {
  if (!["google", "microsoft"].includes(provider))
    throw fail("calendar.errors.input");
  const value = {
    baseUrl: String(input.baseUrl || "")
      .trim()
      .replace(/\/$/, ""),
    clientId: String(input.clientId || "").trim(),
    clientSecret: String(input.clientSecret || "").trim(),
    tenant: String(input.tenant || "common").trim(),
  };
  if (
    !value.clientId ||
    !value.clientSecret ||
    value.clientId.length > 1000 ||
    value.clientSecret.length > 4000 ||
    value.baseUrl.length > 2000
  )
    throw fail("calendar.errors.oauthConfig");
  let url;
  try {
    url = new URL(value.baseUrl);
  } catch {
    throw fail("calendar.errors.oauthAddress");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const loopback =
    host === "localhost" || host === "127.0.0.1" || host === "::1";
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !["", "/"].includes(url.pathname) ||
    (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) ||
    (provider === "google" &&
      !loopback &&
      (net.isIP(host) || !host.includes(".")))
  )
    throw fail("calendar.errors.oauthAddress");
  if (provider === "microsoft" && !/^[a-zA-Z0-9-]{1,150}$/.test(value.tenant))
    throw fail("calendar.errors.input");
  value.baseUrl = url.origin;
  return value;
}
async function load(provider, accountId) {
  if (accountId != null) {
    const row = await db.get(
      "SELECT config_enc FROM calendar_oauth_configs WHERE account_id=? AND provider=?",
      [accountId, provider],
    );
    if (row) return JSON.parse(decrypt(row.config_enc));
  }
  return environment(provider);
}
function config(provider, profile = environment(provider)) {
  const value = validate(provider, profile);
  return {
    clientId: value.clientId,
    clientSecret: value.clientSecret,
    redirectUri:
      value.baseUrl + "/api/calendar/oauth/" + provider + "/callback",
    authorize:
      provider === "google"
        ? "https://accounts.google.com/o/oauth2/v2/auth"
        : `https://login.microsoftonline.com/${value.tenant}/oauth2/v2.0/authorize`,
    token:
      provider === "google"
        ? "https://oauth2.googleapis.com/token"
        : `https://login.microsoftonline.com/${value.tenant}/oauth2/v2.0/token`,
    scope:
      provider === "google"
        ? "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.calendarlist.readonly"
        : "offline_access https://graph.microsoft.com/Calendars.ReadWrite",
  };
}
async function settings(accountId) {
  const result = { oauthSetup: {} };
  for (const provider of ["google", "microsoft"]) {
    const value = await load(provider, accountId);
    try {
      config(provider, value);
      result[provider] = true;
    } catch {
      result[provider] = false;
    }
    result.oauthSetup[provider] = {
      baseUrl: value.baseUrl,
      clientId: value.clientId,
      secretSaved: !!value.clientSecret,
      tenant: value.tenant,
    };
  }
  return result;
}
async function save(provider, accountId, input) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw fail("calendar.errors.input");
  const old = await load(provider, accountId);
  const profile = validate(provider, {
    ...input,
    clientSecret:
      input.clientSecret ||
      (String(input.clientId || "").trim() === old.clientId
        ? old.clientSecret
        : ""),
  });
  await db.run(
    `INSERT INTO calendar_oauth_configs(account_id,provider,config_enc) VALUES(?,?,?)
     ON CONFLICT(account_id,provider) DO UPDATE SET config_enc=excluded.config_enc`,
    [accountId, provider, encrypt(JSON.stringify(profile))],
  );
  return settings(accountId);
}
module.exports = { config, load, save, settings, validate };
