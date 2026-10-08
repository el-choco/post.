// Same canonical form as frontend/src/lib/contactImport.js, including legacy contacts.
function contactImportKey(contact) {
  function canonical(value) {
    if (typeof value === "string") return value.trim();
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.keys(value)
          .sort()
          .flatMap((key) => {
            const item = canonical(value[key]);
            return item === "" ||
              item == null ||
              (typeof item === "object" && !Object.keys(item).length)
              ? []
              : [[key, item]];
          }),
      );
    return value;
  }
  const profile = { ...contact.profile };
  profile.emails = (
    profile.emails ||
    (contact.email ? [{ type: "home", value: contact.email }] : [])
  ).map((email) => ({ ...email, value: email.value.trim().toLowerCase() }));
  profile.phones =
    profile.phones ||
    (contact.phone ? [{ type: "mobile", value: contact.phone }] : []);
  return JSON.stringify(
    canonical({
      name: contact.name,
      email: contact.email?.toLowerCase(),
      phone: contact.phone,
      note: contact.note,
      profile,
    }),
  );
}
module.exports = { contactImportKey };
