import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { importPreview, decodeCsv, parseCsv } from "../src/lib/csv.js";
import { buildFolderTree, canDeleteFolder } from "../src/lib/folders.js";
test("Google CSV recognizes names, primary email, quoted commas and multiline notes", () => {
  const csv =
    '\uFEFFName,Given Name,Family Name,E-mail 1 - Value,Phone 1 - Value,Notes\r\n"Weber, Mia",Mia,Weber,mia@example.com,+49123,"Line one\nLine two"\r\n';
  const preview = importPreview(csv);
  assert.equal(preview.contacts.length, 1);
  assert.equal(preview.contacts[0].name, "Weber, Mia");
  assert.equal(preview.contacts[0].note, "Line one\nLine two");
  assert.equal(preview.contacts[0].phone, "+49123");
});
test("Outlook German CSV preserves people without email and detects only identical records", () => {
  const preview = importPreview(
    "Vorname;Nachname;E-Mail-Adresse;Mobiltelefon;Notizen\nMia;Weber;mia@example.com;123;Hallo\nMia;Weber;MIA@example.com;123;Hallo\nBad;Address;invalid;;",
  );
  assert.equal(preview.contacts[0].name, "Mia Weber");
  assert.equal(preview.duplicates, 1);
  assert.equal(preview.skipped, 0);
  assert.equal(preview.contacts.length, 3);
  assert.equal(preview.contacts[2].email, "");
  assert.deepEqual(preview.contacts[2].profile.extra, [
    { label: "E-Mail-Adresse", value: "invalid" },
  ]);
  assert.equal(
    importPreview(
      "First Name,Last Name,E-mail Address,Home Phone\nAlex,Miller,alex@example.com,321",
    ).contacts[0].phone,
    "321",
  );
});
test("CSV accepts name/phone exports, handles quotes and rejects unrelated headers", () => {
  assert.equal(
    parseCsv('Name,Email\n"Mia ""M""",mia@example.com')[1][0],
    'Mia "M"',
  );
  assert.throws(() => parseCsv('Name,Email\n"unclosed'), /csvInvalid/);
  assert.equal(importPreview("Name,Phone\nMia,123").contacts[0].phone, "123");
  assert.throws(() => importPreview("Product,Price\nBook,123"), /csvNoColumns/);
});
test("Outlook imports all 227 rows including 210 contacts without an email", () => {
  const preview = importPreview(
    fs.readFileSync(
      new URL("./fixtures/outlook-phone-contacts.csv", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(preview.contacts.length, 227);
  assert.equal(preview.contacts.filter((c) => !c.email).length, 210);
  assert.equal(preview.contacts.filter((c) => c.phone).length, 227);
  assert.equal(preview.skipped, 0);
  assert.equal(preview.duplicates, 0);
});
test("Outlook preserves multiple phone types, addresses, dates and additional fields", () => {
  const preview = importPreview(
    'First Name,Middle Name,Last Name,Title,Primary Phone,Home Phone,Mobile Phone,Business Phone,Other Phone,Home Street,Home Street 2,Home City,Home Postal Code,Home Country,Birthday,Company,Notes,Categories\nAda,M,Example,Dr,,0123,0456,0789,0111,Example Road,Unit 2,Berlin,12345,Germany,12/31/1990,Example Ltd,"A note",Family',
  );
  const c = preview.contacts[0];
  assert.equal(c.name, "Dr Ada M Example");
  assert.equal(c.phone, "0123");
  assert.deepEqual(
    c.profile.phones.map((p) => p.type),
    ["home", "mobile", "work", "other"],
  );
  assert.equal(c.profile.phones.length, 4);
  assert.equal(c.profile.addresses[0].street, "Example Road\nUnit 2");
  assert.equal(c.profile.addresses[0].postalCode, "12345");
  assert.equal(c.profile.birthday, "1990-12-31");
  assert.equal(c.profile.organization, "Example Ltd");
  assert.deepEqual(c.profile.extra, [{ label: "Categories", value: "Family" }]);
});
test("Google labeled fields and shared addresses survive without collapsing contacts", () => {
  const preview = importPreview(
    "Name,E-mail 1 - Type,E-mail 1 - Value,E-mail 2 - Type,E-mail 2 - Value,Phone 1 - Type,Phone 1 - Value,Phone 2 - Type,Phone 2 - Value,Address 1 - Type,Address 1 - Street,Address 1 - City\nAda,Work,shared@example.org,Home,ada@example.org,Mobile,0123,Home,0456,Home,Example Road,Berlin\nBob,Work,shared@example.org,,,,,,,,",
  );
  assert.equal(preview.contacts.length, 2);
  assert.equal(preview.duplicates, 0);
  assert.deepEqual(
    preview.contacts[0].profile.emails.map((e) => e.type),
    ["work", "home"],
  );
  assert.deepEqual(
    preview.contacts[0].profile.phones.map((p) => p.type),
    ["mobile", "home"],
  );
  assert.equal(preview.contacts[0].profile.addresses[0].type, "home");
});
test("Outlook Windows-1252 encoded names are preserved", () => {
  const bytes = new Uint8Array([
    78, 97, 109, 101, 44, 69, 109, 97, 105, 108, 10, 74, 246, 114, 103, 44, 106,
    111, 114, 103, 64, 101, 120, 97, 109, 112, 108, 101, 46, 99, 111, 109,
  ]);
  assert.equal(importPreview(decodeCsv(bytes.buffer)).contacts[0].name, "Jörg");
});
test("folder tree builds year/month hierarchy including missing parent containers", () => {
  const tree = buildFolderTree([
    { path: "2026/09", delimiter: "/" },
    { path: "2025/12", delimiter: "/" },
    { path: "2026/01", delimiter: "/" },
  ]);
  assert.deepEqual(
    tree.map((node) => node.name),
    ["2025", "2026"],
  );
  assert.deepEqual(
    tree[1].children.map((node) => node.name),
    ["01", "09"],
  );
  assert.equal(tree[1].synthetic, true);
  assert.equal(canDeleteFolder(tree[1]), false);
});
test("folder tree honors dot delimiters, system folders and hidden subtrees", () => {
  const folders = [
    { path: "2026.01", delimiter: "." },
    { path: "INBOX", specialUse: "\\Inbox", delimiter: "." },
    { path: "2026.02", delimiter: "." },
  ];
  const tree = buildFolderTree(folders, ["2026.01"]);
  assert.equal(tree[0].path, "INBOX");
  assert.equal(tree[0].selectable, true);
  assert.equal(canDeleteFolder(tree[0]), false);
  assert.deepEqual(
    tree[1].children.map((node) => node.name),
    ["02"],
  );
  assert.equal(buildFolderTree(folders, ["2026"]).length, 1);
});
