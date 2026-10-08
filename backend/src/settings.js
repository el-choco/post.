const defaults = require("./preferences.json");
const choices = {
  language: ["de", "en"],
  layout: ["right", "bottom", "list"],
  timeFormat: ["24", "12"],
  dateFormat: ["dd.MM.yyyy", "yyyy-MM-dd", "MM/dd/yyyy", "dd/MM/yyyy"],
  refreshInterval: [0, 30, 60, 120, 300, 600],
  markReadDelay: [-1, 0, 2, 5, 10, 30],
  notificationDuration: [0, 5, 10, 30],
  externalImages: ["ask", "always", "never"],
  sendReceipts: ["ask", "never"],
  composeHtml: ["never", "always", "reply"],
  draftInterval: [0, 30, 60, 120, 300],
  replyPosition: ["above", "below"],
  forwardMode: ["inline", "attachment"],
  htmlFont: ["Arial", "Georgia", "Verdana", "Courier New"],
  htmlFontSize: [10, 12, 14, 16, 18, 20],
  replyAllDefault: ["all", "sender"],
  signatureMode: ["always", "new", "reply", "never"],
  contactDisplay: ["display", "firstLast", "lastFirst"],
  contactSort: ["first", "last", "display"],
  contactFormMode: ["home", "work"],
  archiveStructure: [
    "none",
    "year",
    "month",
    "thunderbird",
    "sender",
    "folder",
    "yearFolder",
    "monthFolder",
  ],
  emptyTrashOnLogout: ["never", "all", "30", "60", "90"],
};
function readSettings(account) {
  let stored = {};
  try {
    stored = JSON.parse(account.settings || "{}");
  } catch {}
  return { ...defaults, name: account.email?.split("@")[0] || "", ...stored };
}
function normalizeSettings(body, current = defaults) {
  const result = { ...current };
  for (const [key, fallback] of Object.entries(defaults)) {
    if (body[key] === undefined) continue;
    const value = body[key];
    if (choices[key])
      result[key] = choices[key].includes(value) ? value : fallback;
    else if (typeof fallback === "boolean") result[key] = value === true;
    else if (["pageSize", "contactPageSize"].includes(key))
      result[key] = Math.min(200, Math.max(5, parseInt(value, 10) || fallback));
    else if (key === "collapseQuotes")
      result[key] = Math.min(10000, Math.max(0, parseInt(value, 10) || 0));
    else if (key === "hiddenFolders")
      result[key] = Array.isArray(value)
        ? value.filter((v) => typeof v === "string").slice(0, 5000)
        : [];
    else if (typeof fallback === "string")
      result[key] = String(value || "").slice(
        0,
        key === "signature" ? 20000 : 1000,
      );
  }
  try {
    new Intl.DateTimeFormat("de", { timeZone: result.timezone });
  } catch {
    result.timezone = defaults.timezone;
  }
  return result;
}
function specialFolder(folders, settings, key, use) {
  if (settings[key])
    return folders.find(
      (f) => f.path === settings[key] && f.selectable !== false,
    );
  return folders.find((f) => f.specialUse === use && f.selectable !== false);
}
function archiveParts(settings, message, source, delimiter = "/") {
  const date = new Date(
    message.envelope?.date || message.internalDate || Date.now(),
  );
  const valid = Number.isNaN(date.valueOf()) ? new Date() : date;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: settings.timezone,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(valid);
  const year = parts.find((p) => p.type === "year").value,
    month = parts.find((p) => p.type === "month").value;
  const origin = source.split(delimiter);
  const sender = String(message.envelope?.from?.[0]?.address || "unknown")
    .replace(/[\r\n\0/\\]/g, "_")
    .split(delimiter)
    .join("_")
    .slice(0, 150);
  return (
    {
      none: [],
      year: [year],
      month: [year, month],
      thunderbird: [year, `${year}-${month}`],
      sender: [sender],
      folder: origin,
      yearFolder: [year, ...origin],
      monthFolder: [year, month, ...origin],
    }[settings.archiveStructure] || []
  );
}
module.exports = {
  defaults,
  choices,
  readSettings,
  normalizeSettings,
  specialFolder,
  archiveParts,
};
