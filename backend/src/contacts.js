const express = require("express");
const { run, get, all, transaction } = require("./db");
const { normalizeProfile, contactRow } = require("./contactProfile");
const { contactImportKey } = require("./contactImport");
const isMail = (value) => /^[^@\s,;<>]+@[^@\s,;<>]+\.[^@\s,;<>]+$/.test(value);
const fail = (message, status = 400) => {
  const error = new Error(message);
  error.status = status;
  throw error;
};
async function defaultBook(accountId) {
  await run(
    "INSERT OR IGNORE INTO address_books (account_id,name,is_default) VALUES (?,'Persönlich',1)",
    [accountId],
  );
  return get(
    "SELECT * FROM address_books WHERE account_id=? AND is_default=1",
    [accountId],
  );
}
async function ownBook(accountId, id) {
  const book = id
    ? await get("SELECT * FROM address_books WHERE account_id=? AND id=?", [
        accountId,
        id,
      ])
    : await defaultBook(accountId);
  if (!book) fail("bookNotFound", 404);
  return book;
}
function contactFields(body) {
  return normalizeProfile(body);
}
async function collectAddresses(accountId, bookId, addresses) {
  const book = await get(
    "SELECT id FROM address_books WHERE id=? AND account_id=?",
    [bookId, accountId],
  );
  if (!book) return;
  for (const entry of addresses.filter((e) => isMail(e.address)))
    await run(
      `INSERT INTO contacts(account_id,book_id,name,email) SELECT ?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM contacts WHERE account_id=? AND book_id=? AND LOWER(email)=LOWER(?))`,
      [
        accountId,
        book.id,
        entry.name || entry.address,
        entry.address,
        accountId,
        book.id,
        entry.address,
      ],
    );
}
async function saveGroups(accountId, contactId, bookId, ids) {
  const groups = await all(
    "SELECT id FROM contact_groups WHERE account_id=? AND book_id=?",
    [accountId, bookId],
  );
  const valid = groups.filter((g) => ids?.map(Number).includes(g.id));
  await transaction(async (exec) => {
    await exec("DELETE FROM contact_group_members WHERE contact_id=?", [
      contactId,
    ]);
    for (const group of valid)
      await exec(
        "INSERT INTO contact_group_members(group_id,contact_id) VALUES(?,?)",
        [group.id, contactId],
      );
  });
}
function createContactsRouter(auth, wrap) {
  const router = express.Router();
  router.get(
    "/address-books",
    auth,
    wrap(async (req, res) => {
      await defaultBook(req.account.id);
      res.json(
        await all(
          `SELECT b.id,b.name,b.is_default AS isDefault,COUNT(c.id) AS count FROM address_books b
      LEFT JOIN contacts c ON c.book_id=b.id AND c.account_id=b.account_id WHERE b.account_id=?
      GROUP BY b.id ORDER BY b.is_default DESC,b.name COLLATE NOCASE`,
          [req.account.id],
        ),
      );
    }),
  );
  router.post(
    "/address-books",
    auth,
    wrap(async (req, res) => {
      const name = String(req.body.name || "")
        .trim()
        .slice(0, 120);
      if (!name) fail("bookNameRequired");
      const result = await run(
        "INSERT INTO address_books (account_id,name) VALUES (?,?)",
        [req.account.id, name],
      );
      res.json({ id: result.lastID, name, isDefault: 0, count: 0 });
    }),
  );
  router.delete(
    "/address-books/:id",
    auth,
    wrap(async (req, res) => {
      const book = await ownBook(req.account.id, req.params.id);
      if (book.is_default) fail("defaultBookProtected", 403);
      if (req.body.confirm !== true) fail("bookDeleteConfirm");
      await run("DELETE FROM address_books WHERE id=? AND account_id=?", [
        book.id,
        req.account.id,
      ]);
      res.json({ success: true });
    }),
  );
  router.get(
    "/contacts",
    auth,
    wrap(async (req, res) => {
      await defaultBook(req.account.id);
      const id = req.query.bookId;
      if (id) await ownBook(req.account.id, id);
      res.json(
        (
          await all(
            `SELECT id,name,email,phone,note,profile,book_id AS bookId FROM contacts WHERE account_id=? ${id ? "AND book_id=?" : ""} ORDER BY name COLLATE NOCASE,email`,
            id ? [req.account.id, id] : [req.account.id],
          )
        ).map(contactRow),
      );
    }),
  );
  router.post(
    "/contacts/import",
    auth,
    wrap(async (req, res) => {
      const book = await ownBook(req.account.id, req.body.bookId);
      if (
        !Array.isArray(req.body.contacts) ||
        !req.body.contacts.length ||
        req.body.contacts.length > 10000
      )
        fail("csvInvalid");
      const contacts = req.body.contacts.map(contactFields);
      const imported = await transaction(async (exec, query) => {
        const existing = new Set(
          (
            await query(
              "SELECT name,email,phone,note,profile FROM contacts WHERE account_id=? AND book_id=?",
              [req.account.id, book.id],
            )
          ).map((row) => contactImportKey(contactRow(row))),
        );
        let count = 0;
        for (const contact of contacts) {
          const key = contactImportKey(contact);
          if (req.body.skipDuplicates !== false && existing.has(key)) continue;
          const result = await exec(
            `INSERT INTO contacts (account_id,book_id,name,email,phone,note,profile)
          VALUES (?,?,?,?,?,?,?)`,
            [
              req.account.id,
              book.id,
              contact.name,
              contact.email,
              contact.phone,
              contact.note,
              JSON.stringify(contact.profile),
            ],
          );
          count += result.changes;
          existing.add(key);
        }
        return count;
      });
      res.json({ imported, duplicates: contacts.length - imported });
    }),
  );
  router.post(
    "/contacts",
    auth,
    wrap(async (req, res) => {
      const contact = contactFields(req.body);
      const book = await ownBook(req.account.id, req.body.bookId);
      const result = await run(
        "INSERT INTO contacts (account_id,book_id,name,email,phone,note,profile) VALUES (?,?,?,?,?,?,?)",
        [
          req.account.id,
          book.id,
          contact.name,
          contact.email,
          contact.phone,
          contact.note,
          JSON.stringify(contact.profile),
        ],
      );
      await saveGroups(
        req.account.id,
        result.lastID,
        book.id,
        req.body.groupIds,
      );
      res.json({ id: result.lastID, ...contact, bookId: book.id });
    }),
  );
  router.put(
    "/contacts/:id",
    auth,
    wrap(async (req, res) => {
      const current = await get(
        "SELECT * FROM contacts WHERE id=? AND account_id=?",
        [req.params.id, req.account.id],
      );
      if (!current) fail("contactNotFound", 404);
      const contact = contactFields(req.body);
      const book = await ownBook(
        req.account.id,
        req.body.bookId || current.book_id,
      );
      await run(
        "UPDATE contacts SET name=?,email=?,phone=?,note=?,profile=?,book_id=? WHERE id=? AND account_id=?",
        [
          contact.name,
          contact.email,
          contact.phone,
          contact.note,
          JSON.stringify(contact.profile),
          book.id,
          current.id,
          req.account.id,
        ],
      );
      await saveGroups(req.account.id, current.id, book.id, req.body.groupIds);
      res.json({ id: current.id, ...contact, bookId: book.id });
    }),
  );
  router.delete(
    "/contacts/:id",
    auth,
    wrap(async (req, res) => {
      const result = await run(
        "DELETE FROM contacts WHERE id=? AND account_id=?",
        [req.params.id, req.account.id],
      );
      if (!result.changes) fail("contactNotFound", 404);
      res.json({ success: true });
    }),
  );
  router.get(
    "/contact-groups",
    auth,
    wrap(async (req, res) => {
      const book = await ownBook(req.account.id, req.query.bookId);
      const groups = await all(
        "SELECT id,name,book_id AS bookId FROM contact_groups WHERE account_id=? AND book_id=? ORDER BY name",
        [req.account.id, book.id],
      );
      for (const group of groups)
        group.contactIds = (
          await all(
            "SELECT m.contact_id AS id FROM contact_group_members m JOIN contacts c ON c.id=m.contact_id WHERE group_id=? AND c.account_id=?",
            [group.id, req.account.id],
          )
        ).map((r) => r.id);
      res.json(groups);
    }),
  );
  router.post(
    "/contact-groups",
    auth,
    wrap(async (req, res) => {
      const book = await ownBook(req.account.id, req.body.bookId),
        name = String(req.body.name || "")
          .trim()
          .slice(0, 120);
      if (!name) fail("bookNameRequired");
      const result = await run(
        "INSERT INTO contact_groups(account_id,book_id,name) VALUES(?,?,?)",
        [req.account.id, book.id, name],
      );
      res.json({ id: result.lastID, bookId: book.id, name, contactIds: [] });
    }),
  );
  router.delete(
    "/contact-groups/:id",
    auth,
    wrap(async (req, res) => {
      const result = await run(
        "DELETE FROM contact_groups WHERE id=? AND account_id=?",
        [req.params.id, req.account.id],
      );
      if (!result.changes) fail("bookNotFound", 404);
      res.json({ success: true });
    }),
  );
  router.post(
    "/trusted-senders",
    auth,
    wrap(async (req, res) => {
      if (req.body.confirm !== true) fail("receiptConfirm");
      const settings = require("./settings").readSettings(req.account);
      if (!settings.trustedSendersBook) fail("chooseBook");
      await collectAddresses(req.account.id, settings.trustedSendersBook, [
        {
          address: String(req.body.email || ""),
          name: String(req.body.name || ""),
        },
      ]);
      res.json({ success: true });
    }),
  );
  return router;
}
module.exports = { createContactsRouter, collectAddresses };
