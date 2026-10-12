const crypto = require("node:crypto");
const db = require("./db");
const calendar = require("./calendarOAuth");
const { encrypt, decrypt } = require("./crypto");
const network = require("./filesNetwork");
const { fail } = require("./calendarNetwork");

async function init() {
  await db.run(
    `CREATE TABLE IF NOT EXISTS file_connections (id INTEGER PRIMARY KEY AUTOINCREMENT,account_id INTEGER NOT NULL REFERENCES mail_accounts(id) ON DELETE CASCADE,kind TEXT NOT NULL,name TEXT NOT NULL,credentials_enc TEXT NOT NULL)`,
  );
  await db.run(
    `CREATE TABLE IF NOT EXISTS file_oauth_configs (account_id INTEGER NOT NULL REFERENCES mail_accounts(id) ON DELETE CASCADE,provider TEXT NOT NULL,config_enc TEXT NOT NULL,PRIMARY KEY(account_id,provider))`,
  );
  await db.run(
    `CREATE TABLE IF NOT EXISTS file_oauth_states (state_hash TEXT PRIMARY KEY,account_id INTEGER NOT NULL REFERENCES mail_accounts(id) ON DELETE CASCADE,session_hash TEXT NOT NULL,provider TEXT NOT NULL,verifier TEXT NOT NULL,expires_at INTEGER NOT NULL,config_enc TEXT NOT NULL)`,
  );
  await db.run("DELETE FROM file_oauth_states WHERE expires_at<?", [
    Date.now(),
  ]);
}
async function load(provider, accountId) {
  if (!["google", "microsoft"].includes(provider))
    throw fail("files.errors.input");
  const row = await db.get(
    "SELECT config_enc FROM file_oauth_configs WHERE account_id=? AND provider=?",
    [accountId, provider],
  );
  return row
    ? JSON.parse(decrypt(row.config_enc))
    : { ...(await calendar.load(provider, accountId)), access: "app" };
}
function config(provider, profile) {
  const valid = calendar.validate(provider, profile);
  const result = calendar.config(provider, valid);
  result.redirectUri =
    valid.baseUrl + "/api/files/oauth/" + provider + "/callback";
  result.scope =
    provider === "google"
      ? "https://www.googleapis.com/auth/" +
        (profile.access === "all" ? "drive" : "drive.file")
      : "offline_access https://graph.microsoft.com/Files.ReadWrite";
  return result;
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
      access: value.access || "app",
    };
  }
  return result;
}
async function save(provider, accountId, input) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw fail("files.errors.input");
  const old = await load(provider, accountId);
  const profile = {
    ...calendar.validate(provider, {
      ...input,
      clientSecret:
        input.clientSecret ||
        (String(input.clientId || "").trim() === old.clientId
          ? old.clientSecret
          : ""),
    }),
    access: input.access === "all" ? "all" : "app",
  };
  await db.run(
    "INSERT INTO file_oauth_configs VALUES(?,?,?) ON CONFLICT(account_id,provider) DO UPDATE SET config_enc=excluded.config_enc",
    [accountId, provider, encrypt(JSON.stringify(profile))],
  );
  return settings(accountId);
}
function authorize(provider, state, verifier, profile) {
  const c = config(provider, profile),
    url = new URL(c.authorize);
  url.search = new URLSearchParams({
    client_id: c.clientId,
    redirect_uri: c.redirectUri,
    response_type: "code",
    scope: c.scope,
    state,
    code_challenge: crypto
      .createHash("sha256")
      .update(verifier)
      .digest("base64url"),
    code_challenge_method: "S256",
    ...(provider === "google"
      ? { access_type: "offline", prompt: "consent" }
      : { response_mode: "query" }),
  });
  return url.href;
}
async function exchange(provider, params, profile) {
  const c = config(provider, profile);
  const data = await network.json(c.token, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: c.clientId,
      client_secret: c.clientSecret,
      redirect_uri: c.redirectUri,
      ...params,
    }).toString(),
  });
  if (!data.access_token) throw fail("files.errors.remoteAuth", 502);
  return {
    ...data,
    expiresAt: Date.now() + Number(data.expires_in || 3600) * 1000,
  };
}
const refreshing = new Map();
async function credentials(connection) {
  const row = await db.get(
    "SELECT * FROM file_connections WHERE id=? AND account_id=?",
    [connection.id, connection.account_id],
  );
  if (!row) throw fail("files.errors.notFound", 404);
  const data = JSON.parse(decrypt(row.credentials_enc));
  if (data.expiresAt > Date.now() + 60000) return data;
  if (!refreshing.has(row.id))
    refreshing.set(
      row.id,
      (async () => {
        if (!data.refresh_token) throw fail("files.errors.reconnect", 502);
        const updated = await exchange(
          row.kind,
          { grant_type: "refresh_token", refresh_token: data.refresh_token },
          data.oauth,
        );
        const merged = {
          ...data,
          ...updated,
          refresh_token: updated.refresh_token || data.refresh_token,
        };
        await db.run(
          "UPDATE file_connections SET credentials_enc=? WHERE id=? AND account_id=?",
          [encrypt(JSON.stringify(merged)), row.id, row.account_id],
        );
        return merged;
      })().finally(() => refreshing.delete(row.id)),
    );
  return refreshing.get(row.id);
}
module.exports = {
  init,
  load,
  config,
  settings,
  save,
  authorize,
  exchange,
  credentials,
};
