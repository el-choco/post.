export const escapeHtml = (value) =>
  String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
export function formatDate(value, settings, short = false) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.valueOf())) return "";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: settings.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const p = Object.fromEntries(parts.map((v) => [v.type, v.value]));
  const full = settings.dateFormat
    .replace("yyyy", p.year)
    .replace("MM", p.month)
    .replace("dd", p.day);
  if (short && settings.shortDate) {
    const today = new Intl.DateTimeFormat("en-GB", {
      timeZone: settings.timezone,
    }).format(new Date());
    const day = new Intl.DateTimeFormat("en-GB", {
      timeZone: settings.timezone,
    }).format(date);
    if (today === day) return formatTime(value, settings);
    return full
      .replace(/[./-]?\s*\d{4}[./-]?/, "")
      .replace(/^[/.-]|[/.-]$/g, "");
  }
  return full;
}
export const formatTime = (value, settings) =>
  new Date(value).toLocaleTimeString(settings.language, {
    timeZone: settings.timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: settings.timeFormat === "12",
  });
export const emoticons = (text) =>
  text.replace(
    /(^|\s)(:-?\)|;-?\)|:-?\(|:-?D|<3)(?=\s|$)/g,
    (_, space, face) =>
      space +
      ({
        "<3": "❤️",
        ":)": "🙂",
        ":-)": "🙂",
        ";)": "😉",
        ";-)": "😉",
        ":(": "🙁",
        ":-(": "🙁",
        ":D": "😃",
        ":-D": "😃",
      }[face] || face),
  );
export function textHtml(text, settings) {
  let html = escapeHtml(
    settings.composeEmoticons ? emoticons(text) : text,
  ).replace(/\n/g, "<br>");
  if (settings.autoLinks)
    html = html.replace(
      /https?:\/\/[^\s<]+/g,
      (url) =>
        `<a href="${url.replace(/&quot;.*/, "")}" rel="noopener noreferrer">${url}</a>`,
    );
  return `<div style="font-family:${settings.htmlFont};font-size:${settings.htmlFontSize}px">${html}</div>`;
}
export function signatureText(settings, kind = "new") {
  if (
    !settings.signature ||
    settings.signatureMode === "never" ||
    (settings.signatureMode === "new" && kind !== "new") ||
    (settings.signatureMode === "reply" && kind === "new")
  )
    return "";
  return (
    "\n\n" + (settings.signatureSeparator ? "-- \n" : "") + settings.signature
  );
}
export function replyText(message, settings, kind = "reply") {
  let text = message.text || "";
  if (settings.stripOriginalSignature) text = text.split(/\n-- \r?\n/)[0];
  const quote =
    `${formatDate(message.date, settings)} ${formatTime(message.date || Date.now(), settings)} · ${message.from.name || message.from.address}\n` +
    text
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n");
  const signature = signatureText(settings, kind);
  if (settings.replyPosition === "below") return quote + "\n\n" + signature;
  return settings.signatureBelowQuote
    ? "\n\n" + quote + signature
    : signature + "\n\n" + quote;
}
export function contactProfile(contact, mode = "home") {
  const profile = contact.profile || {};
  return {
    ...contact,
    profile: {
      ...profile,
      emails:
        profile.emails ||
        (contact.email ? [{ type: mode, value: contact.email }] : []),
      phones:
        profile.phones ||
        (contact.phone ? [{ type: "mobile", value: contact.phone }] : []),
      addresses: profile.addresses || [],
      extra: profile.extra || [],
    },
  };
}
export function contactName(contact, settings) {
  const p = contact.profile || {};
  return settings.contactDisplay === "lastFirst"
    ? [p.lastName, p.firstName].filter(Boolean).join(", ") || contact.name
    : settings.contactDisplay === "firstLast"
      ? [p.firstName, p.lastName].filter(Boolean).join(" ") || contact.name
      : contact.name || contact.email || contact.phone;
}
export function contactSortKey(contact, settings) {
  const p = contact.profile || {};
  return (
    (settings.contactSort === "last"
      ? p.lastName
      : settings.contactSort === "first"
        ? p.firstName
        : contact.name) ||
    contact.name ||
    contact.email
  );
}
export function exportContacts(contacts, format) {
  if (format === "csv") {
    const keys = [
      "Name",
      "Given Name",
      "Family Name",
      "E-mail 1 - Value",
      "E-mail 2 - Value",
      "Phone 1 - Value",
      "Notes",
    ];
    const quote = (value) =>
      '"' + String(value || "").replace(/"/g, '""') + '"';
    return (
      "\uFEFF" +
      [
        keys,
        ...contacts.map((c) => [
          c.name,
          c.profile?.firstName,
          c.profile?.lastName,
          c.email,
          c.profile?.emails?.[1]?.value,
          c.phone,
          c.note,
        ]),
      ]
        .map((row) => row.map(quote).join(","))
        .join("\r\n")
    );
  }
  const esc = (value) =>
    String(value || "")
      .replace(/\\/g, "\\\\")
      .replace(/\r?\n/g, "\\n")
      .replace(/;/g, "\\;")
      .replace(/,/g, "\\,");
  return contacts
    .map((c) => {
      const p = contactProfile(c).profile;
      return [
        "BEGIN:VCARD",
        "VERSION:3.0",
        `FN:${esc(c.name)}`,
        `N:${esc(p.lastName)};${esc(p.firstName)};${esc(p.middleName)};${esc(p.prefix)};${esc(p.suffix)}`,
        ...p.emails.map(
          (e) => `EMAIL;TYPE=${e.type.toUpperCase()}:${esc(e.value)}`,
        ),
        ...p.phones.map(
          (e) => `TEL;TYPE=${e.type.toUpperCase()}:${esc(e.value)}`,
        ),
        ...p.addresses.map(
          (a) =>
            `ADR;TYPE=${a.type.toUpperCase()}:;;${esc(a.street)};${esc(a.city)};${esc(a.region)};${esc(a.postalCode)};${esc(a.country)}`,
        ),
        `ORG:${esc(p.organization)}`,
        `TITLE:${esc(p.jobTitle)}`,
        `NOTE:${esc(c.note)}`,
        p.birthday ? `BDAY:${p.birthday}` : "",
        "END:VCARD",
      ]
        .filter(Boolean)
        .join("\r\n");
    })
    .join("\r\n");
}
export function downloadText(text, filename, type = "text/plain") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
