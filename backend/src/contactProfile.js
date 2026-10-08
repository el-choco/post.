const isMail = (value) => /^[^@\s,;<>]+@[^@\s,;<>]+\.[^@\s,;<>]+$/.test(value);
const str = (v, n = 500) =>
  String(v || "")
    .trim()
    .slice(0, n);
function normalizeProfile(body) {
  const p = body.profile || {},
    result = {};
  for (const key of [
    "prefix",
    "firstName",
    "middleName",
    "lastName",
    "suffix",
    "nickname",
    "organization",
    "department",
    "jobTitle",
    "gender",
    "birthday",
    "anniversary",
    "website",
  ])
    result[key] = str(p[key]);
  if (result.birthday && !/^\d{4}-\d{2}-\d{2}$/.test(result.birthday))
    result.birthday = "";
  result.emails = (
    Array.isArray(p.emails)
      ? p.emails
      : body.email
        ? [{ type: "home", value: body.email }]
        : []
  )
    .slice(0, 20)
    .map((e) => ({
      type: ["home", "work", "other"].includes(e.type) ? e.type : "other",
      value: str(e.value),
    }))
    .filter((e) => e.value);
  if (result.emails.some((e) => !isMail(e.value)))
    throw Object.assign(new Error("invalidContactEmail"), { status: 400 });
  result.phones = (
    Array.isArray(p.phones)
      ? p.phones
      : body.phone
        ? [{ type: "mobile", value: body.phone }]
        : []
  )
    .slice(0, 20)
    .map((e) => ({
      type: ["mobile", "home", "work", "fax", "other"].includes(e.type)
        ? e.type
        : "other",
      value: str(e.value, 200),
    }))
    .filter((e) => e.value);
  result.addresses = (Array.isArray(p.addresses) ? p.addresses : [])
    .slice(0, 10)
    .map((e) =>
      Object.fromEntries(
        ["type", "street", "city", "postalCode", "country", "region"].map(
          (k) => [k, str(e[k])],
        ),
      ),
    );
  result.extra = (Array.isArray(p.extra) ? p.extra : [])
    .slice(0, 20)
    .map((e) => ({ label: str(e.label, 80), value: str(e.value, 2000) }));
  result.photo = "";
  if (p.photo) {
    if (
      !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(p.photo) ||
      p.photo.length > 750000
    )
      throw Object.assign(new Error("photoInvalid"), { status: 400 });
    result.photo = p.photo;
  }
  const name = str(
    body.name ||
      [
        result.prefix,
        result.firstName,
        result.middleName,
        result.lastName,
        result.suffix,
      ]
        .filter(Boolean)
        .join(" ") ||
      result.organization,
  );
  if (!name && !result.emails.length && !result.phones.length)
    throw Object.assign(new Error("contactRequired"), { status: 400 });
  return {
    name,
    email: result.emails[0]?.value || "",
    phone: result.phones[0]?.value || "",
    note: str(body.note, 20000),
    profile: result,
  };
}
function contactRow(row) {
  let profile = {};
  try {
    profile = JSON.parse(row.profile || "{}");
  } catch {}
  return { ...row, profile };
}
module.exports = { normalizeProfile, contactRow };
