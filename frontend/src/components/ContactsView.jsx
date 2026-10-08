import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Plus,
  Pencil,
  Trash2,
  Mail,
  Search,
  BookUser,
  Upload,
  Download,
  Printer,
  Users,
  ChevronLeft,
  ChevronRight,
  LoaderCircle,
} from "lucide-react";
import {
  contactProfile,
  contactName,
  contactSortKey,
  exportContacts,
  downloadText,
  escapeHtml,
} from "../lib/mailFormatting";
import ContactEditor from "./ContactEditor";
export default function ContactsView({
  settings,
  bookList,
  bookId,
  setBookId,
  bookName,
  rows,
  editing,
  setEditing,
  save,
  remove,
  busy,
  loading,
  error,
  notice,
  newBook,
  setNewBook,
  createBook,
  deleteBook,
  preview,
  setPreview,
  readFile,
  importContacts,
  onCompose,
  groups,
  createGroup,
  deleteGroup,
  onError,
}) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState(null),
    [selection, setSelection] = useState(new Set()),
    [query, setQuery] = useState(""),
    [searchField, setSearchField] = useState("all"),
    [advanced, setAdvanced] = useState(false),
    [page, setPage] = useState(1),
    [groupId, setGroupId] = useState(null),
    [newGroup, setNewGroup] = useState(null),
    [detailTab, setDetailTab] = useState("properties");
  const group = groups.find((g) => g.id === groupId);
  const filtered = rows
    .filter((c) => !groupId || group?.contactIds.includes(c.id))
    .filter((c) => {
      const haystack =
        searchField === "all"
          ? [c.name, c.email, c.phone, c.note, JSON.stringify(c.profile)].join(
              " ",
            )
          : c[searchField];
      return String(haystack || "")
        .toLowerCase()
        .includes(query.toLowerCase());
    })
    .sort((a, b) =>
      contactSortKey(a, settings).localeCompare(
        contactSortKey(b, settings),
        settings.language,
      ),
    );
  const maxPage = Math.max(
      1,
      Math.ceil(filtered.length / settings.contactPageSize),
    ),
    currentPage = Math.min(page, maxPage),
    visible = filtered.slice(
      (currentPage - 1) * settings.contactPageSize,
      currentPage * settings.contactPageSize,
    );
  const active = rows.find((c) => c.id === selected),
    p = active ? contactProfile(active).profile : {};
  const selectedRows = filtered.filter((c) => selection.has(c.id));
  function selectBook(id) {
    setBookId(id);
    setSelected(null);
    setSelection(new Set());
    setPage(1);
    setGroupId(null);
    setEditing(null);
    setPreview(null);
    setQuery("");
  }
  function exportFile(format) {
    const contacts = selection.size ? selectedRows : filtered;
    downloadText(
      exportContacts(contacts, format),
      `contacts.${format === "csv" ? "csv" : "vcf"}`,
      format === "csv" ? "text/csv;charset=utf-8" : "text/vcard;charset=utf-8",
    );
  }
  function edit(contact) {
    setEditing({
      ...contactProfile(contact, settings.contactFormMode),
      groupIds: groups
        .filter((g) => g.contactIds.includes(contact.id))
        .map((g) => g.id),
    });
  }
  function print() {
    const contacts = selection.size
      ? selectedRows
      : active
        ? [active]
        : filtered;
    const win = window.open("", "_blank");
    if (!win) return;
    win.opener = null;
    win.document.write(
      "<!doctype html><html><head><title>post. · " +
        escapeHtml(t("contacts")) +
        "</title><style>body{font:15px/1.6 Arial;padding:30px}section{break-inside:avoid;border-bottom:1px solid #ddd;padding:20px}pre{white-space:pre-wrap}</style></head><body>" +
        contacts
          .map(
            (c) =>
              "<section><h2>" +
              escapeHtml(c.name) +
              "</h2><p>" +
              escapeHtml(c.email) +
              "<br>" +
              escapeHtml(c.phone) +
              "</p><pre>" +
              escapeHtml(c.note) +
              "</pre></section>",
          )
          .join("") +
        "</body></html>",
    );
    win.document.close();
    win.print();
  }
  return (
    <div className="contact-workspace">
      <div className="contact-global-toolbar">
        <label
          className={`secondary csv-file-button ${busy ? "disabled" : ""}`}
        >
          <Upload size={16} />
          {t("importCsv")}
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={readFile}
            disabled={busy || !bookId}
          />
        </label>
        <div className="contact-export-menu">
          <button
            className="secondary"
            disabled={!filtered.length}
            onClick={() => exportFile("csv")}
          >
            <Download size={16} />
            {t("exportCsv")}
          </button>
          <button
            className="text-button"
            disabled={!filtered.length}
            onClick={() => exportFile("vcard")}
          >
            {t("exportVcard")}
          </button>
        </div>
        <button
          className="text-button"
          disabled={!active?.email}
          onClick={() => onCompose(active.email)}
        >
          <Mail size={17} />
          {t("compose")}
        </button>
        <button
          className="text-button"
          disabled={!filtered.length}
          onClick={print}
        >
          <Printer size={17} />
          {t("print")}
        </button>
        <button
          className="text-button"
          aria-pressed={advanced}
          onClick={() => setAdvanced((v) => !v)}
        >
          <Search size={17} />
          {t("advancedSearch")}
        </button>
        <div className="search-box">
          {advanced && (
            <select
              aria-label={t("advancedSearch")}
              value={searchField}
              onChange={(e) => {
                setSearchField(e.target.value);
                setPage(1);
              }}
            >
              {["all", "name", "email", "phone", "note"].map((key) => (
                <option value={key} key={key}>
                  {t(
                    key === "all"
                      ? "allContactFields"
                      : key === "name"
                        ? "contactName"
                        : key,
                  )}
                </option>
              ))}
            </select>
          )}
          <input
            aria-label={t("contactSearch")}
            placeholder={t("contactSearch")}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(1);
            }}
          />
        </div>
      </div>
      {error && (
        <p className="notice error" role="alert">
          {t(error)}
        </p>
      )}
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      <div className="contact-three-columns">
        <aside className="books-sidebar">
          <span className="eyebrow">{t("addressBooks")}</span>
          <div className="books-list">
            {bookList.map((book) => (
              <div
                key={book.id}
                className={`book-row ${bookId === book.id ? "active" : ""}`}
              >
                <button
                  className="book-select"
                  onClick={() => selectBook(book.id)}
                  disabled={busy}
                >
                  <BookUser size={17} />
                  <span>{bookName(book)}</span>
                  <small>{book.count}</small>
                </button>
                {!book.isDefault && (
                  <button
                    className="icon-button"
                    disabled={busy}
                    aria-label={t("deleteBookNamed", { name: bookName(book) })}
                    onClick={() => deleteBook(book)}
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            ))}
          </div>
          {newBook !== null ? (
            <form className="new-book-form" onSubmit={createBook}>
              <label>
                {t("bookName")}
                <input
                  autoFocus
                  required
                  value={newBook}
                  onChange={(e) => setNewBook(e.target.value)}
                />
              </label>
              <button className="primary" disabled={busy}>
                {t("create")}
              </button>
              <button
                className="text-button"
                type="button"
                onClick={() => setNewBook(null)}
              >
                {t("cancel")}
              </button>
            </form>
          ) : (
            <button
              className="text-button"
              disabled={busy}
              onClick={() => setNewBook("")}
            >
              <Plus size={16} />
              {t("newBook")}
            </button>
          )}
          <span className="eyebrow contact-group-title">{t("groups")}</span>
          {groups
            .filter((g) => g.bookId === bookId)
            .map((g) => (
              <div
                className={`book-row ${groupId === g.id ? "active" : ""}`}
                key={g.id}
              >
                <button
                  className="book-select"
                  onClick={() => {
                    setGroupId(groupId === g.id ? null : g.id);
                    setPage(1);
                  }}
                >
                  <Users size={15} />
                  <span>{g.name}</span>
                  <small>{g.contactIds.length}</small>
                </button>
                <button
                  className="icon-button"
                  aria-label={t("deleteGroup")}
                  onClick={() => deleteGroup(g)}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          {newGroup !== null ? (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                await createGroup(newGroup);
                setNewGroup(null);
              }}
            >
              <label>
                {t("newGroup")}
                <input
                  autoFocus
                  required
                  value={newGroup}
                  onChange={(e) => setNewGroup(e.target.value)}
                />
              </label>
              <button className="primary" disabled={busy}>
                {t("create")}
              </button>
              <button
                type="button"
                className="text-button"
                onClick={() => setNewGroup(null)}
              >
                {t("cancel")}
              </button>
            </form>
          ) : (
            <button
              className="text-button"
              disabled={busy}
              onClick={() => setNewGroup("")}
            >
              <Plus size={15} />
              {t("newGroup")}
            </button>
          )}
        </aside>
        <section className="contact-list-pane">
          <header>
            <h3>
              {t("contacts")} <small>{filtered.length}</small>
            </h3>
            <button
              className="icon-button"
              disabled={busy}
              title={t("newContact")}
              onClick={() =>
                setEditing({
                  name: "",
                  email: "",
                  phone: "",
                  note: "",
                  bookId,
                  profile: {
                    emails: [{ type: settings.contactFormMode, value: "" }],
                    phones: [],
                    addresses: [],
                    extra: [],
                  },
                  groupIds: groupId ? [groupId] : [],
                })
              }
            >
              <Plus size={20} />
            </button>
          </header>
          <div className="contact-list-scroll">
            {loading || busy ? (
              <div className="empty-state">
                <LoaderCircle className="spinner" size={24} />
              </div>
            ) : (
              visible.map((c) => (
                <div
                  className={`contact-list-entry ${selected === c.id ? "active" : ""}`}
                  key={c.id}
                >
                  <input
                    type="checkbox"
                    aria-label={t("selectContact", {
                      name: contactName(c, settings),
                    })}
                    checked={selection.has(c.id)}
                    onChange={(e) =>
                      setSelection((current) => {
                        const next = new Set(current);
                        if (e.target.checked) next.add(c.id);
                        else next.delete(c.id);
                        return next;
                      })
                    }
                  />
                  <button
                    onClick={() => {
                      setSelected(c.id);
                      setEditing(null);
                      setPreview(null);
                    }}
                  >
                    {c.profile?.photo ? (
                      <img
                        src={c.profile.photo}
                        alt=""
                        className="avatar small"
                      />
                    ) : (
                      <span className="avatar small">
                        {(contactName(c, settings) || "?")
                          .slice(0, 2)
                          .toUpperCase()}
                      </span>
                    )}
                    <span>
                      {contactName(c, settings)}
                      <small>{c.email || c.phone}</small>
                    </span>
                  </button>
                </div>
              ))
            )}
          </div>
          <footer>
            <span>
              {t("contactPagination", {
                start: filtered.length
                  ? (currentPage - 1) * settings.contactPageSize + 1
                  : 0,
                end: Math.min(
                  currentPage * settings.contactPageSize,
                  filtered.length,
                ),
                total: filtered.length,
              })}
            </span>
            <button
              className="icon-button"
              aria-label={t("previousPage")}
              disabled={currentPage === 1}
              onClick={() => setPage(currentPage - 1)}
            >
              <ChevronLeft size={16} />
            </button>
            <button
              className="icon-button"
              aria-label={t("nextPage")}
              disabled={currentPage >= maxPage}
              onClick={() => setPage(currentPage + 1)}
            >
              <ChevronRight size={16} />
            </button>
          </footer>
        </section>
        <section className="contact-detail-pane">
          {preview ? (
            <form className="csv-preview" onSubmit={importContacts}>
              <span className="eyebrow">CSV</span>
              <h3>{preview.fileName}</h3>
              <p>
                {t("csvPreviewCount", {
                  count: preview.contacts.length,
                  skipped: preview.skipped,
                  duplicates: preview.duplicates,
                })}
              </p>
              <label>
                {t("addressBook")}
                <select
                  value={preview.bookId}
                  onChange={(e) =>
                    setPreview((current) => ({
                      ...current,
                      bookId: Number(e.target.value),
                    }))
                  }
                >
                  {bookList.map((book) => (
                    <option key={book.id} value={book.id}>
                      {bookName(book)}
                    </option>
                  ))}
                </select>
              </label>
              <div className="csv-sample">
                {preview.contacts.slice(0, 5).map((c, index) => (
                  <div key={index}>
                    <strong>{c.name || c.email || c.phone}</strong>
                    <span>{c.email || c.phone || t("csvWithoutEmail")}</span>
                  </div>
                ))}
              </div>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={preview.skipDuplicates}
                  onChange={(e) =>
                    setPreview((current) => ({
                      ...current,
                      skipDuplicates: e.target.checked,
                    }))
                  }
                />
                {t("csvSkipDuplicates")}
              </label>
              <p className="muted">{t("csvDuplicateHint")}</p>
              <footer className="dialog-footer">
                <button
                  className="secondary"
                  type="button"
                  onClick={() => setPreview(null)}
                >
                  {t("cancel")}
                </button>
                <button className="primary" disabled={busy}>
                  {t("importContacts")}
                </button>
              </footer>
            </form>
          ) : editing ? (
            <ContactEditor
              value={editing}
              onChange={setEditing}
              onSave={save}
              onCancel={() => setEditing(null)}
              books={bookList}
              groups={groups}
              busy={busy}
              settings={settings}
              onError={onError}
            />
          ) : active ? (
            <>
              <div className="contact-detail-heading">
                {p.photo ? (
                  <img
                    src={p.photo}
                    alt={active.name}
                    className="contact-display-photo"
                  />
                ) : (
                  <div className="contact-display-photo avatar">
                    {contactName(active, settings).slice(0, 2).toUpperCase()}
                  </div>
                )}
                <div>
                  <span className="eyebrow">{t("contactDetails")}</span>
                  <h2>{contactName(active, settings)}</h2>
                  <p>{p.organization}</p>
                </div>
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() => edit(active)}
                >
                  <Pencil size={15} />
                  {t("editContact")}
                </button>
                <button
                  className="icon-button"
                  aria-label={t("delete")}
                  onClick={() => remove(active)}
                >
                  <Trash2 size={17} />
                </button>
              </div>
              <div className="contact-tabs" role="tablist">
                {["properties", "personal", "notes", "groups"].map((key) => (
                  <button
                    key={key}
                    role="tab"
                    aria-selected={detailTab === key}
                    onClick={() => setDetailTab(key)}
                  >
                    {t("contactTabs." + key)}
                  </button>
                ))}
              </div>
              <div className="contact-properties">
                {detailTab === "properties" && (
                  <>
                    {["emails", "phones", "addresses"].map((key) => (
                      <section key={key}>
                        <h4>{t("contactFields." + key)}</h4>
                        {p[key].map((row, i) => (
                          <p key={i}>
                            <span className="muted">
                              {t("contactFields." + row.type)}
                            </span>
                            <strong>
                              {key === "addresses"
                                ? [
                                    row.street,
                                    [row.postalCode, row.city]
                                      .filter(Boolean)
                                      .join(" "),
                                    row.region,
                                    row.country,
                                  ]
                                    .filter(Boolean)
                                    .join(", ")
                                : row.value}
                            </strong>
                          </p>
                        ))}
                      </section>
                    ))}
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
                      .filter((key) => p[key]?.trim())
                      .map((key) => (
                        <p key={key}>
                          <span>{t("contactFields." + key)}</span>
                          <strong>{p[key]}</strong>
                        </p>
                      ))}
                    {p.extra.map((row, i) => (
                      <p key={i}>
                        <span>{row.label}</span>
                        <strong>{row.value}</strong>
                      </p>
                    ))}
                  </>
                )}
                {detailTab === "personal" &&
                  ["gender", "birthday", "anniversary"]
                    .filter((key) => p[key])
                    .map((key) => (
                      <p key={key}>
                        <span>{t("contactFields." + key)}</span>
                        <strong>{key === "gender" ? t(p[key]) : p[key]}</strong>
                      </p>
                    ))}
                {detailTab === "notes" && (
                  <div className="plain-mail">{active.note}</div>
                )}
                {detailTab === "groups" &&
                  groups
                    .filter((g) => g.contactIds.includes(active.id))
                    .map((g) => (
                      <span className="group-pill" key={g.id}>
                        {g.name}
                      </span>
                    ))}
              </div>
            </>
          ) : (
            <div className="empty-state">
              <Users size={44} strokeWidth={1} />
              <h3>{t("chooseContact")}</h3>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
