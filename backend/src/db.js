const sqlite3 = require("sqlite3").verbose();
const path = require("path");
const fs = require("fs");

const dataDir = process.env.DATA_DIR || path.join(__dirname, "../data");
fs.mkdirSync(dataDir, { recursive: true });

const db = new sqlite3.Database(path.join(dataDir, "webmail.db"));

const run = (sql, params = []) =>
  new Promise((resolve, reject) =>
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    }),
  );
const get = (sql, params = []) =>
  new Promise((resolve, reject) =>
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row))),
  );
const all = (sql, params = []) =>
  new Promise((resolve, reject) =>
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows))),
  );

/** Creates the complete schema on first start (idempotent). */
async function init() {
  await run("PRAGMA journal_mode = WAL");
  await run("PRAGMA foreign_keys = ON");
  await run("PRAGMA busy_timeout = 5000");

  // Preserve legacy tables; schema creation must never destroy existing data.

  await run(`CREATE TABLE IF NOT EXISTS mail_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    password_enc TEXT NOT NULL,
    imap_host TEXT NOT NULL,
    imap_port INTEGER NOT NULL,
    imap_secure INTEGER NOT NULL,
    imap_user TEXT NOT NULL,
    smtp_host TEXT NOT NULL,
    smtp_port INTEGER NOT NULL,
    smtp_secure INTEGER NOT NULL,
    smtp_user TEXT NOT NULL,
    settings TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL
  )`);

  await run(`CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    account_id INTEGER NOT NULL REFERENCES mail_accounts(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  )`);

  await run(`CREATE TABLE IF NOT EXISTS contacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL REFERENCES mail_accounts(id) ON DELETE CASCADE,
    name TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL,
    phone TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT ''
  )`);

  await run(`CREATE TABLE IF NOT EXISTS address_books (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL REFERENCES mail_accounts(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    is_default INTEGER NOT NULL DEFAULT 0
  )`);
  await run(
    "CREATE UNIQUE INDEX IF NOT EXISTS default_book_per_account ON address_books(account_id) WHERE is_default=1",
  );
  const columns = await all("PRAGMA table_info(contacts)");
  if (!columns.some((column) => column.name === "book_id"))
    await run(
      "ALTER TABLE contacts ADD COLUMN book_id INTEGER REFERENCES address_books(id) ON DELETE CASCADE",
    );
  await run(`INSERT INTO address_books (account_id, name, is_default)
    SELECT a.id, 'Persönlich', 1 FROM mail_accounts a WHERE NOT EXISTS
    (SELECT 1 FROM address_books b WHERE b.account_id=a.id AND b.is_default=1)`);
  await run(
    `UPDATE contacts SET book_id=(SELECT id FROM address_books WHERE account_id=contacts.account_id AND is_default=1) WHERE book_id IS NULL`,
  );
  await run(
    "CREATE INDEX IF NOT EXISTS contacts_book ON contacts(account_id,book_id)",
  );
  if (!columns.some((column) => column.name === "profile"))
    await run(
      "ALTER TABLE contacts ADD COLUMN profile TEXT NOT NULL DEFAULT '{}'",
    );
  await run(
    `CREATE TABLE IF NOT EXISTS contact_groups (id INTEGER PRIMARY KEY AUTOINCREMENT,account_id INTEGER NOT NULL REFERENCES mail_accounts(id) ON DELETE CASCADE,book_id INTEGER NOT NULL REFERENCES address_books(id) ON DELETE CASCADE,name TEXT NOT NULL)`,
  );
  await run(
    `CREATE TABLE IF NOT EXISTS contact_group_members (group_id INTEGER NOT NULL REFERENCES contact_groups(id) ON DELETE CASCADE,contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,PRIMARY KEY(group_id,contact_id))`,
  );
  await run(
    `CREATE TABLE IF NOT EXISTS receipt_log (account_id INTEGER NOT NULL REFERENCES mail_accounts(id) ON DELETE CASCADE,message_key TEXT NOT NULL,sent_at INTEGER NOT NULL,PRIMARY KEY(account_id,message_key))`,
  );
  await run(
    `CREATE TABLE IF NOT EXISTS local_drafts (account_id INTEGER PRIMARY KEY REFERENCES mail_accounts(id) ON DELETE CASCADE,content TEXT NOT NULL,updated_at INTEGER NOT NULL)`,
  );
  await run(
    `CREATE TABLE IF NOT EXISTS draft_refs (account_id INTEGER PRIMARY KEY REFERENCES mail_accounts(id) ON DELETE CASCADE,folder TEXT NOT NULL,uid INTEGER NOT NULL,uid_validity TEXT NOT NULL,marker TEXT NOT NULL)`,
  );

  await run("DELETE FROM sessions WHERE expires_at < ?", [Date.now()]);
}

// A dedicated connection keeps imports atomic without interleaving unrelated writes.
async function transaction(fn) {
  const connection = new sqlite3.Database(path.join(dataDir, "webmail.db"));
  const exec = (sql, params = []) =>
    new Promise((resolve, reject) =>
      connection.run(sql, params, function (error) {
        if (error) reject(error);
        else resolve({ lastID: this.lastID, changes: this.changes });
      }),
    );
  const query = (sql, params = []) =>
    new Promise((resolve, reject) =>
      connection.all(sql, params, (error, rows) =>
        error ? reject(error) : resolve(rows),
      ),
    );
  try {
    await exec("PRAGMA foreign_keys=ON");
    await exec("PRAGMA busy_timeout=5000");
    await exec("BEGIN IMMEDIATE");
    const result = await fn(exec, query);
    await exec("COMMIT");
    return result;
  } catch (error) {
    try {
      await exec("ROLLBACK");
    } catch {}
    throw error;
  } finally {
    await new Promise((resolve) => connection.close(resolve));
  }
}
module.exports = { db, run, get, all, init, dataDir, transaction };
