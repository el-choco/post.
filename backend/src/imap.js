const { ImapFlow } = require("imapflow");
const { createImapPool } = require("./imapPool");

const SELF_SIGNED = process.env.ALLOW_SELF_SIGNED === "true";

function makeClient(acc) {
  const client = new ImapFlow({
    host: acc.imap_host,
    port: acc.imap_port,
    secure: !!acc.imap_secure,
    doSTARTTLS: !acc.imap_secure,
    auth: { user: acc.imap_user, pass: acc.password },
    logger: false,
    tls: { rejectUnauthorized: !SELF_SIGNED },
    connectionTimeout: 15000,
    greetingTimeout: 10000,
    socketTimeout: 120000,
  });
  client.on("error", () => {});
  return client;
}

const { withImap, closeAll } = createImapPool(makeClient);

// Fallback detection for servers that do not announce SPECIAL-USE flags
const NAME_HINTS = {
  "\\Sent": [
    "sent",
    "sent items",
    "sent messages",
    "gesendet",
    "gesendete objekte",
    "gesendete elemente",
  ],
  "\\Drafts": ["drafts", "entwürfe", "entwuerfe"],
  "\\Trash": [
    "trash",
    "deleted items",
    "deleted messages",
    "papierkorb",
    "gelöscht",
    "geloescht",
  ],
  "\\Junk": ["junk", "spam", "junk e-mail", "bulk mail"],
  "\\Archive": ["archive", "archiv", "archives"],
};

function detectSpecial(entry) {
  if (entry.specialUse) return entry.specialUse;
  if (entry.path.toUpperCase() === "INBOX") return "\\Inbox";
  const last = entry.path
    .split(entry.delimiter || "/")
    .pop()
    .toLowerCase();
  for (const [use, names] of Object.entries(NAME_HINTS)) {
    if (names.includes(last)) return use;
  }
  return null;
}

async function listFolders(client, withStatus = false) {
  let list;
  try {
    list = await client.list(
      withStatus ? { statusQuery: { messages: true, unseen: true } } : {},
    );
  } catch {
    list = await client.list();
  }
  return list
    .filter((f) => !(f.flags && f.flags.has("\\NonExistent")))
    .map((f) => ({
      path: f.path,
      name: f.name,
      delimiter: f.delimiter || "/",
      specialUse: detectSpecial(f),
      selectable: !(f.flags && f.flags.has("\\Noselect")),
      unseen: f.status ? f.status.unseen || 0 : 0,
      total: f.status ? f.status.messages || 0 : 0,
    }));
}

const findSpecial = (folders, use) => folders.find((f) => f.specialUse === use);

/** Groups [{folder, uid}] into Map(folder -> uid[]) */
function groupItems(items) {
  const map = new Map();
  for (const it of Array.isArray(items) ? items : []) {
    const uid = Number(it.uid);
    if (
      typeof it.folder !== "string" ||
      !it.folder ||
      !Number.isInteger(uid) ||
      uid <= 0
    )
      continue;
    if (!map.has(it.folder)) map.set(it.folder, []);
    map.get(it.folder).push(uid);
  }
  return map;
}

module.exports = { withImap, listFolders, findSpecial, groupItems, closeAll };
