import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Minus, UserRound, Upload, X, Check } from "lucide-react";
import { contactProfile } from "../lib/mailFormatting";
export default function ContactEditor({
  value,
  onChange,
  onSave,
  onCancel,
  books,
  groups,
  busy,
  settings,
  onError,
}) {
  const { t } = useTranslation();
  const [tab, setTab] = useState("properties");
  const contact = contactProfile(value, settings.contactFormMode),
    p = contact.profile;
  const update = (key, data) => onChange({ ...contact, [key]: data });
  const profile = (key, data) =>
    onChange({ ...contact, profile: { ...p, [key]: data } });
  const rowChange = (key, index, field, data) =>
    profile(
      key,
      p[key].map((row, i) => (i === index ? { ...row, [field]: data } : row)),
    );
  function addField(key) {
    if (["emails", "phones", "addresses", "extra"].includes(key)) {
      const field =
        key === "extra"
          ? { label: "", value: "" }
          : key === "addresses"
            ? {
                type: settings.contactFormMode,
                street: "",
                city: "",
                postalCode: "",
                country: "",
                region: "",
              }
            : {
                type: key === "phones" ? "mobile" : settings.contactFormMode,
                value: "",
              };
      profile(key, [...p[key], field]);
    } else profile(key, " ");
  }
  async function photo(event) {
    const file = event.target.files[0];
    event.target.value = "";
    if (!file) return;
    if (
      file.size > 500 * 1024 ||
      !["image/png", "image/jpeg", "image/webp"].includes(file.type)
    ) {
      onError("photoInvalid");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => profile("photo", reader.result);
    reader.onerror = () => onError("photoInvalid");
    reader.readAsDataURL(file);
  }
  const field = (key) => (
    <label key={key}>
      {t("contactFields." + key)}
      <input
        type={["birthday", "anniversary"].includes(key) ? "date" : "text"}
        value={p[key] || ""}
        onChange={(e) => profile(key, e.target.value)}
      />
    </label>
  );
  function repeated(key) {
    return (
      <section className="contact-field-section" key={key}>
        <h4>{t("contactFields." + key)}</h4>
        {p[key].map((row, index) => (
          <div className="contact-repeat-row" key={index}>
            {key !== "extra" && (
              <select
                aria-label={
                  t("contactFields." + key) +
                  " " +
                  (index + 1) +
                  " · " +
                  t("contactFields.label")
                }
                value={row.type}
                onChange={(e) => rowChange(key, index, "type", e.target.value)}
              >
                {(key === "phones"
                  ? ["mobile", "home", "work", "fax", "other"]
                  : ["home", "work", "other"]
                ).map((type) => (
                  <option key={type} value={type}>
                    {t("contactFields." + type)}
                  </option>
                ))}
              </select>
            )}
            {key === "addresses" ? (
              <div className="contact-address-grid">
                {["street", "city", "postalCode", "country", "region"].map(
                  (name) => (
                    <input
                      key={name}
                      aria-label={
                        t("contactFields." + name) + " " + (index + 1)
                      }
                      placeholder={t("contactFields." + name)}
                      value={row[name] || ""}
                      onChange={(e) =>
                        rowChange(key, index, name, e.target.value)
                      }
                    />
                  ),
                )}
              </div>
            ) : (
              <>
                {key === "extra" && (
                  <input
                    aria-label={t("contactFields.label") + " " + (index + 1)}
                    placeholder={t("contactFields.label")}
                    value={row.label}
                    onChange={(e) =>
                      rowChange(key, index, "label", e.target.value)
                    }
                  />
                )}
                <input
                  aria-label={t("contactFields." + key) + " " + (index + 1)}
                  type={
                    key === "emails"
                      ? "email"
                      : key === "phones"
                        ? "tel"
                        : "text"
                  }
                  placeholder={t("contactFields." + key)}
                  value={row.value}
                  onChange={(e) =>
                    rowChange(key, index, "value", e.target.value)
                  }
                />
              </>
            )}
            <button
              type="button"
              className="icon-button"
              aria-label={
                t("removeField") +
                " " +
                t("contactFields." + key) +
                " " +
                (index + 1)
              }
              onClick={() =>
                profile(
                  key,
                  p[key].filter((_, i) => i !== index),
                )
              }
            >
              <Minus size={17} />
            </button>
          </div>
        ))}
        <button
          type="button"
          className="text-button"
          onClick={() => addField(key)}
        >
          <Plus size={14} />
          {t("addField")}
        </button>
      </section>
    );
  }
  return (
    <form className="contact-editor" onSubmit={onSave}>
      <div className="contact-editor-header">
        <div className="contact-photo">
          {p.photo ? (
            <img src={p.photo} alt={t("contactFields.photo")} />
          ) : (
            <UserRound size={52} strokeWidth={1} />
          )}
          <label className="text-button csv-file-button">
            <Upload size={14} />
            {t("changePhoto")}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={photo}
            />
          </label>
          {p.photo && (
            <button
              type="button"
              className="text-button"
              onClick={() => profile("photo", "")}
            >
              <X size={14} />
              {t("removePhoto")}
            </button>
          )}
        </div>
        <div className="contact-name-fields">
          <h3>{t(value.id ? "editContact" : "newContact")}</h3>
          <label>
            {t("addressBook")}
            <select
              value={contact.bookId}
              onChange={(e) =>
                onChange({
                  ...contact,
                  bookId: Number(e.target.value),
                  groupIds: [],
                })
              }
            >
              {books.map((book) => (
                <option key={book.id} value={book.id}>
                  {book.isDefault ? t("personalBook") : book.name}
                </option>
              ))}
            </select>
          </label>
          <div className="field-grid">
            {field("firstName")}
            {field("lastName")}
          </div>
          <label>
            {t("contactName")}
            <input
              value={contact.name || ""}
              onChange={(e) => update("name", e.target.value)}
            />
          </label>
        </div>
      </div>
      <div className="contact-tabs" role="tablist">
        {["properties", "personal", "notes", "groups"].map((key) => (
          <button
            type="button"
            role="tab"
            aria-selected={tab === key}
            key={key}
            onClick={() => setTab(key)}
          >
            {t("contactTabs." + key)}
          </button>
        ))}
      </div>
      <div className="contact-editor-fields">
        {tab === "properties" && (
          <>
            {[
              "prefix",
              "middleName",
              "suffix",
              "nickname",
              "organization",
              "department",
              "jobTitle",
              "website",
            ]
              .filter((key) => p[key] !== undefined && p[key] !== "")
              .map(field)}
            {["emails", "phones", "addresses", "extra"].map(repeated)}
            <label>
              {t("addField")}
              <select value="" onChange={(e) => addField(e.target.value)}>
                <option value="">{t("addField")} …</option>
                {[
                  "prefix",
                  "middleName",
                  "suffix",
                  "nickname",
                  "organization",
                  "department",
                  "jobTitle",
                  "website",
                ].map((key) => (
                  <option key={key} value={key}>
                    {t("contactFields." + key)}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
        {tab === "personal" && (
          <>
            <label>
              {t("contactFields.gender")}
              <select
                value={p.gender || ""}
                onChange={(e) => profile("gender", e.target.value)}
              >
                {["", "male", "female", "diverse"].map((key) => (
                  <option key={key} value={key}>
                    {t(key || "unspecified")}
                  </option>
                ))}
              </select>
            </label>
            {field("birthday")}
            {field("anniversary")}
          </>
        )}
        {tab === "notes" && (
          <label>
            {t("note")}
            <textarea
              rows="9"
              value={contact.note || ""}
              onChange={(e) => update("note", e.target.value)}
            />
          </label>
        )}
        {tab === "groups" && (
          <div className="contact-group-checks">
            {groups
              .filter((g) => g.bookId === Number(contact.bookId))
              .map((group) => (
                <label key={group.id}>
                  <input
                    type="checkbox"
                    checked={contact.groupIds?.includes(group.id) || false}
                    onChange={(e) =>
                      update(
                        "groupIds",
                        e.target.checked
                          ? [...(contact.groupIds || []), group.id]
                          : (contact.groupIds || []).filter(
                              (id) => id !== group.id,
                            ),
                      )
                    }
                  />
                  {group.name}
                </label>
              ))}
            {!groups.length && <p className="muted">{t("newGroup")}</p>}
          </div>
        )}
      </div>
      <footer className="dialog-footer">
        <button
          className="secondary"
          type="button"
          disabled={busy}
          onClick={onCancel}
        >
          {t("cancel")}
        </button>
        <button className="primary" disabled={busy}>
          <Check size={16} />
          {t(busy ? "saving" : "save")}
        </button>
      </footer>
    </form>
  );
}
