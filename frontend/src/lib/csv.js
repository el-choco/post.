import { contactImportKey } from "./contactImport.js";

// RFC-style quoted CSV, including embedded newlines and comma/semicolon/tab exports.
export function parseCsv(text) {
  text = text.replace(/^\uFEFF/, "");
  let quoted = false,
    counts = { ",": 0, ";": 0, "\t": 0 };
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '"') {
      if (quoted && text[i + 1] === '"') {
        i++;
        continue;
      }
      quoted = !quoted;
    }
    if (!quoted && /[\r\n]/.test(text[i])) break;
    if (!quoted && Object.hasOwn(counts, text[i])) counts[text[i]]++;
  }
  const delimiter = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  const rows = [];
  let row = [],
    field = "",
    inside = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (inside && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (inside) inside = false;
      else if (!field) inside = true;
      else field += char;
    } else if (!inside && char === delimiter) {
      row.push(field);
      field = "";
    } else if (!inside && (char === "\r" || char === "\n")) {
      row.push(field);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      field = "";
      if (char === "\r" && text[i + 1] === "\n") i++;
    } else field += char;
  }
  if (inside) throw new Error("csvInvalid");
  row.push(field);
  if (row.some((value) => value.trim())) rows.push(row);
  return rows;
}
export function decodeCsv(buffer) {
  const bytes = new Uint8Array(buffer);
  if (bytes[0] === 0xff && bytes[1] === 0xfe)
    return new TextDecoder("utf-16le").decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff)
    return new TextDecoder("utf-16be").decode(bytes);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}
export function importPreview(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error("csvInvalid");
  const normalize = (value) =>
    value
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]/g, "");
  const labels = rows.shift();
  const headers = labels.map(normalize);
  const find = (...names) =>
    headers.findIndex((header) => names.includes(header));
  const emailIndices = headers
    .map((header, index) =>
      /^(email|emailaddress|emailadresse|email\d+(value|address|adresse)?|email\d*address\d*|primaryemail|secondaryemail)$/.test(
        header,
      )
        ? index
        : -1,
    )
    .filter((index) => index >= 0);
  const nameIndex = find(
    "name",
    "fullname",
    "displayname",
    "anzeigename",
    "vollstandigername",
  );
  const noteIndex = find("notes", "note", "notizen", "notiz");
  const fieldIndices = Object.fromEntries(
    Object.entries({
      prefix: ["title", "nameprefix", "anrede"],
      firstName: ["firstname", "givenname", "vorname"],
      middleName: [
        "middlename",
        "additionalname",
        "weiterevornamen",
        "zweitername",
      ],
      lastName: ["lastname", "familyname", "surname", "nachname"],
      suffix: ["suffix", "namesuffix", "namenszusatz"],
      nickname: ["nickname", "spitzname"],
      organization: [
        "company",
        "organization",
        "organization1name",
        "firma",
        "unternehmen",
      ],
      department: ["department", "organization1department", "abteilung"],
      jobTitle: [
        "jobtitle",
        "organization1title",
        "berufsbezeichnung",
        "position",
      ],
      birthday: ["birthday", "birthdate", "geburtstag"],
      anniversary: ["anniversary", "jahrestag"],
      website: ["webpage", "website", "website1value", "webseite"],
      gender: ["gender", "geschlecht"],
    }).map(([key, aliases]) => [key, find(...aliases)]),
  );
  const phoneIndices = headers
    .map((header, index) =>
      /^(primaryphone|mobilephone|mobile|mobiltelefon|telefonmobil|handy|businessphone\d*|businessfax|companymainphone|assistantsphone|homephone\d*|homefax|otherphone|otherfax|pager|callback|carphone|isdn|radiophone|ttytddphone|telex|phone\d*(value)?|telefon\d*|telefonprivat\d*|privattelefon\d*|geschaftlichtelefon\d*|telefongeschaftlich\d*|telefonweitere|faxprivat|faxgeschaftlich|faxweitere)$/.test(
        header,
      )
        ? index
        : -1,
    )
    .filter((index) => index >= 0);
  if (
    nameIndex < 0 &&
    !emailIndices.length &&
    !phoneIndices.length &&
    Object.values(fieldIndices).every((index) => index < 0)
  )
    throw new Error("csvNoColumns");
  const isMail = (value) =>
    /^[^@\s,;<>]+@[^@\s,;<>]+\.[^@\s,;<>]+$/.test(value);
  const fieldType = (label, fallback = "other") => {
    const type = normalize(label);
    if (/fax/.test(type)) return "fax";
    if (/mobile|mobil|cell|handy/.test(type)) return "mobile";
    if (/home|privat/.test(type)) return "home";
    if (/work|business|company|geschaft|arbeit/.test(type)) return "work";
    return fallback;
  };
  const dateValue = (value) => {
    const iso = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T].*)?$/);
    const local = value.match(/^(\d{1,2})([./])(\d{1,2})\2(\d{4})(?:\s.*)?$/);
    if (!iso && !local) return "";
    const [year, month, day] = iso
      ? iso.slice(1, 4)
      : local[2] === "."
        ? [local[4], local[3], local[1]]
        : [local[4], local[1], local[3]];
    const date = new Date(
      Date.UTC(Number(year), Number(month) - 1, Number(day)),
    );
    return date.getUTCFullYear() === Number(year) &&
      date.getUTCMonth() + 1 === Number(month) &&
      date.getUTCDate() === Number(day)
      ? `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`
      : "";
  };
  const contacts = [];
  const fingerprints = new Set();
  let skipped = 0,
    duplicates = 0;
  for (const row of rows) {
    const value = (index) => (row[index] || "").trim();
    const used = new Set([nameIndex, noteIndex]);
    const profile = { emails: [], phones: [], addresses: [], extra: [] };
    for (const [key, index] of Object.entries(fieldIndices)) {
      profile[key] = value(index);
      if (key === "birthday" || key === "anniversary") {
        profile[key] = dateValue(value(index));
        // Keep dates we cannot interpret in an additional field instead of losing them.
        if (value(index) && !profile[key]) continue;
      }
      used.add(index);
    }
    for (const index of emailIndices) {
      const email = value(index);
      if (!email || isMail(email)) {
        const typeIndex = headers.indexOf(
          headers[index].replace(/value$/, "type"),
        );
        if (email)
          profile.emails.push({
            type: fieldType(
              typeIndex !== index ? value(typeIndex) : "",
              "home",
            ),
            value: email,
          });
        used.add(index);
        if (typeIndex !== index) used.add(typeIndex);
      }
      // Invalid addresses remain in extra fields, without rejecting the person.
    }
    for (const index of phoneIndices) {
      const typeIndex = headers.indexOf(
        headers[index].replace(/value$/, "type"),
      );
      if (value(index))
        profile.phones.push({
          type: fieldType(
            typeIndex !== index ? value(typeIndex) : headers[index],
            "other",
          ),
          value: value(index),
        });
      used.add(index);
      if (typeIndex !== index) used.add(typeIndex);
    }
    // Outlook home/business/other addresses and Google's numbered address fields.
    const addressPrefixes = new Map([
      ["home", "home"],
      ["business", "work"],
      ["other", "other"],
      ["privat", "home"],
      ["geschaftlich", "work"],
      ["weitere", "other"],
    ]);
    headers.forEach((header) => {
      const match = header.match(
        /^(address\d+)(?:street|city|postalcode|country|region|formatted)$/,
      );
      if (match) addressPrefixes.set(match[1], "other");
    });
    for (const [prefix, fallback] of addressPrefixes) {
      const typeIndex = find(`${prefix}type`);
      const address = { type: fieldType(value(typeIndex), fallback) };
      const parts = {
        street: [
          `${prefix}street`,
          `${prefix}street2`,
          `${prefix}street3`,
          `${prefix}strae`,
          `${prefix}strasse`,
        ],
        city: [`${prefix}city`, `${prefix}ort`],
        region: [`${prefix}state`, `${prefix}region`, `${prefix}bundesland`],
        postalCode: [
          `${prefix}postalcode`,
          `${prefix}postleitzahl`,
          `${prefix}plz`,
        ],
        country: [
          `${prefix}country`,
          `${prefix}countryregion`,
          `${prefix}landregion`,
          `${prefix}land`,
        ],
      };
      for (const [key, aliases] of Object.entries(parts)) {
        const indices = aliases
          .map((alias) => find(alias))
          .filter((index) => index >= 0);
        address[key] = indices.map(value).filter(Boolean).join("\n");
        indices.forEach((index) => used.add(index));
      }
      const formattedIndex = find(`${prefix}address`, `${prefix}formatted`);
      if (!address.street && value(formattedIndex)) {
        address.street = value(formattedIndex);
        used.add(formattedIndex);
      }
      if (
        Object.entries(address).some(([key, field]) => key !== "type" && field)
      ) {
        profile.addresses.push(address);
        used.add(typeIndex);
      }
    }
    headers.forEach((_, index) => {
      if (!used.has(index) && value(index))
        profile.extra.push({ label: labels[index], value: value(index) });
    });
    const name =
      value(nameIndex) ||
      [
        profile.prefix,
        profile.firstName,
        profile.middleName,
        profile.lastName,
        profile.suffix,
      ]
        .filter(Boolean)
        .join(" ") ||
      profile.organization ||
      (!profile.emails.length && !profile.phones.length
        ? profile.addresses[0]?.street
        : "") ||
      "";
    if (!name && !profile.emails.length && !profile.phones.length) {
      skipped++;
      continue;
    }
    const contact = {
      name,
      email: profile.emails[0]?.value || "",
      phone: profile.phones[0]?.value || "",
      note: value(noteIndex),
      profile,
    };
    const fingerprint = contactImportKey(contact);
    if (fingerprints.has(fingerprint)) duplicates++;
    fingerprints.add(fingerprint);
    // Keep every valid row; duplicate handling is chosen in the import dialog.
    contacts.push(contact);
  }
  return { contacts, skipped, duplicates, totalRows: rows.length };
}
