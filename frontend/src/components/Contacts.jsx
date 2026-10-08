import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { api, post } from "../api";
import { useStore } from "../store";
import { importPreview, decodeCsv } from "../lib/csv";
import { contactImportKey } from "../lib/contactImport";
import WorkspacePage from "./WorkspacePage";
import ContactsView from "./ContactsView";
import defaults from "../lib/preferences.json";
function demoInitial() {
  try {
    const saved = JSON.parse(localStorage.getItem("demoAddressBooks"));
    if (saved?.books && saved?.contacts) return saved;
  } catch {}
  return {
    books: [{ id: 1, name: "Persönlich", isDefault: 1 }],
    contacts: [
      {
        id: 1,
        bookId: 1,
        name: "Mia Weber",
        email: "mia@example.com",
        phone: "",
        note: "",
      },
      {
        id: 2,
        bookId: 1,
        name: "Studio Nord",
        email: "studio@example.com",
        phone: "",
        note: "",
      },
    ],
  };
}
export default function Contacts({ onClose, onCompose, settings = defaults }) {
  const { t } = useTranslation();
  const { user } = useStore();
  const [demoData, setDemoData] = useState(demoInitial);
  const [books, setBooks] = useState([]);
  const [bookId, setBookId] = useState(() =>
    user.demo
      ? demoData.books.find(
          (book) => book.id === Number(settings.defaultAddressBook),
        )?.id ||
        demoData.books.find((book) => book.isDefault)?.id ||
        demoData.books[0]?.id
      : Number(settings.defaultAddressBook) || null,
  );
  const [contacts, setContacts] = useState([]);
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [newBook, setNewBook] = useState(null);
  const [preview, setPreview] = useState(null);
  const [revision, setRevision] = useState(0);
  const [groupRows, setGroupRows] = useState([]);
  const groups = user.demo ? demoData.groups || [] : groupRows;
  const groupBookId = editing?.bookId || bookId;
  useEffect(() => {
    if (user.demo || !groupBookId) return;
    const controller = new AbortController();
    api(`/contact-groups?bookId=${groupBookId}`, { signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted) setGroupRows(data);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [user.demo, groupBookId, revision]);
  async function createGroup(name) {
    setBusy(true);
    try {
      const group = user.demo
        ? { id: Date.now(), bookId, name, contactIds: [] }
        : await post("/contact-groups", { bookId, name });
      if (user.demo)
        setDemoData((current) => ({
          ...current,
          groups: [...(current.groups || []), group],
        }));
      else setRevision((value) => value + 1);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function deleteGroup(group) {
    if (!confirm(t("deleteGroup"))) return;
    setBusy(true);
    try {
      if (user.demo)
        setDemoData((current) => ({
          ...current,
          groups: (current.groups || []).filter((g) => g.id !== group.id),
        }));
      else await api(`/contact-groups/${group.id}`, { method: "DELETE" });
      setRevision((value) => value + 1);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const bookList = user.demo
    ? demoData.books.map((book) => ({
        ...book,
        count: demoData.contacts.filter((contact) => contact.bookId === book.id)
          .length,
      }))
    : books;
  const bookName = (book) => (book.isDefault ? t("personalBook") : book.name);
  const rows = user.demo
    ? demoData.contacts.filter((contact) => contact.bookId === bookId)
    : contacts;
  const loadBooks = useCallback(async () => {
    if (user.demo) return;
    const data = await api("/address-books");
    setBooks(data);
    setBookId((current) =>
      data.some((book) => book.id === current) ? current : data[0]?.id,
    );
  }, [user.demo]);
  useEffect(() => {
    if (user.demo) return;
    let cancelled = false;
    api("/address-books")
      .then((data) => {
        if (!cancelled) {
          setBooks(data);
          setBookId((current) =>
            data.some((book) => book.id === current) ? current : data[0]?.id,
          );
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [user.demo]);
  useEffect(() => {
    if (user.demo)
      localStorage.setItem("demoAddressBooks", JSON.stringify(demoData));
  }, [user.demo, demoData]);
  useEffect(() => {
    if (user.demo || !bookId) return;
    const controller = new AbortController();
    async function load() {
      setLoading(true);
      try {
        const data = await api(`/contacts?bookId=${bookId}`, {
          signal: controller.signal,
        });
        if (!controller.signal.aborted) setContacts(data);
      } catch (e) {
        if (!controller.signal.aborted) setError(e.message);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    load();
    return () => controller.abort();
  }, [user.demo, bookId, revision]);
  const refresh = async () => {
    await loadBooks();
    setRevision((value) => value + 1);
  };
  async function save(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const body = { ...editing, bookId: Number(editing.bookId) };
      if (body.profile) {
        body.profile = {
          ...body.profile,
          emails: body.profile.emails.filter((e) => e.value.trim()),
          phones: body.profile.phones.filter((e) => e.value.trim()),
        };
        body.email = body.profile.emails[0]?.value || "";
        body.phone = body.profile.phones[0]?.value || "";
        if (!body.name?.trim())
          body.name = [
            body.profile.prefix,
            body.profile.firstName,
            body.profile.lastName,
          ]
            .filter(Boolean)
            .join(" ");
      }
      if (!body.name?.trim() && !body.email && !body.phone)
        throw new Error("contactRequired");
      if (
        body.profile?.emails.some(
          (email) =>
            !/^[^@\s,;<>]+@[^@\s,;<>]+\.[^@\s,;<>]+$/.test(email.value),
        )
      )
        throw new Error("invalidContactEmail");
      if (user.demo) {
        const saved = { ...body, id: body.id || Date.now() };
        setDemoData((current) => ({
          ...current,
          contacts: [
            ...current.contacts.filter((contact) => contact.id !== saved.id),
            saved,
          ],
          groups: (current.groups || []).map((group) => ({
            ...group,
            contactIds: [
              ...group.contactIds.filter((id) => id !== saved.id),
              ...(body.groupIds?.includes(group.id) &&
              group.bookId === body.bookId
                ? [saved.id]
                : []),
            ],
          })),
        }));
      } else {
        await post(
          editing.id ? `/contacts/${editing.id}` : "/contacts",
          body,
          editing.id ? "PUT" : "POST",
        );
        await refresh();
      }
      setEditing(null);
    } catch (e) {
      setError(t(e.message));
    } finally {
      setBusy(false);
    }
  }
  async function remove(contact) {
    if (!confirm(t("deleteConfirm"))) return;
    setBusy(true);
    try {
      if (user.demo)
        setDemoData((current) => ({
          ...current,
          contacts: current.contacts.filter((item) => item.id !== contact.id),
          groups: (current.groups || []).map((group) => ({
            ...group,
            contactIds: group.contactIds.filter((id) => id !== contact.id),
          })),
        }));
      else {
        await api(`/contacts/${contact.id}`, { method: "DELETE" });
        await refresh();
      }
    } catch (e) {
      setError(t(e.message));
    } finally {
      setBusy(false);
    }
  }
  async function createBook(event) {
    event.preventDefault();
    if (!newBook?.trim()) return;
    setBusy(true);
    setError("");
    try {
      if (
        bookList.some(
          (book) => book.name.toLowerCase() === newBook.trim().toLowerCase(),
        )
      )
        throw new Error("bookExists");
      const book = user.demo
        ? { id: Date.now(), name: newBook.trim(), isDefault: 0, count: 0 }
        : await post("/address-books", { name: newBook.trim() });
      if (user.demo)
        setDemoData((current) => ({
          ...current,
          books: [...current.books, book],
        }));
      else await loadBooks();
      setBookId(book.id);
      setNewBook(null);
      setEditing(null);
      setPreview(null);
    } catch (e) {
      setError(t(e.message));
    } finally {
      setBusy(false);
    }
  }
  async function deleteBook(book) {
    if (
      !confirm(
        t("deleteBookWarning", { name: bookName(book), count: book.count }),
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      if (user.demo) {
        setDemoData((current) => ({
          ...current,
          books: current.books.filter((item) => item.id !== book.id),
          contacts: current.contacts.filter((item) => item.bookId !== book.id),
          groups: (current.groups || []).filter(
            (group) => group.bookId !== book.id,
          ),
        }));
        setBookId(demoData.books.find((item) => item.isDefault).id);
      } else {
        await post(`/address-books/${book.id}`, { confirm: true }, "DELETE");
        await loadBooks();
      }
      setEditing(null);
      setPreview(null);
    } catch (e) {
      setError(t(e.message));
    } finally {
      setBusy(false);
    }
  }
  async function readFile(event) {
    const file = event.target.files[0];
    event.target.value = "";
    if (!file) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (file.size > 10 * 1024 * 1024) throw new Error("csvTooLarge");
      const parsed = importPreview(decodeCsv(await file.arrayBuffer()));
      if (!parsed.contacts.length) throw new Error("csvNoContacts");
      if (parsed.contacts.length > 10000) throw new Error("csvTooLarge");
      setPreview({
        ...parsed,
        fileName: file.name,
        bookId,
        skipDuplicates: true,
      });
      setEditing(null);
    } catch (e) {
      setError(t(e.message));
    } finally {
      setBusy(false);
    }
  }
  async function importContacts(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      let result;
      if (user.demo) {
        const existing = new Set(
          demoData.contacts
            .filter((contact) => contact.bookId === Number(preview.bookId))
            .map(contactImportKey),
        );
        const added = preview.contacts
          .filter((contact) => {
            const key = contactImportKey(contact);
            if (preview.skipDuplicates && existing.has(key)) return false;
            existing.add(key);
            return true;
          })
          .map((contact, i) => ({
            ...contact,
            id: Date.now() + i,
            bookId: Number(preview.bookId),
          }));
        setDemoData((current) => ({
          ...current,
          contacts: [...current.contacts, ...added],
        }));
        result = {
          imported: added.length,
          duplicates: preview.contacts.length - added.length,
        };
      } else {
        result = await post("/contacts/import", {
          bookId: Number(preview.bookId),
          contacts: preview.contacts,
          skipDuplicates: preview.skipDuplicates,
        });
        await refresh();
      }
      setBookId(Number(preview.bookId));
      setNotice(
        t("csvImported", {
          imported: result.imported,
          duplicates: result.duplicates,
          skipped: preview.skipped,
        }),
      );
      setPreview(null);
    } catch (e) {
      setError(t(e.message));
    } finally {
      setBusy(false);
    }
  }
  return (
    <WorkspacePage title={t("contacts")} onBack={onClose}>
      <ContactsView
        {...{
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
        }}
        onError={setError}
      />
    </WorkspacePage>
  );
}
