import { useState, useEffect, useRef, useCallback } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import i18n from "../i18n";
import {
  Mail,
  Inbox,
  Send,
  FileText,
  Archive,
  Trash2,
  ShieldAlert,
  Folder,
  Users,
  Settings,
  Sun,
  Moon,
  LogOut,
  Search,
  X,
  Plus,
  RefreshCw,
  Reply,
  ReplyAll,
  Forward,
  CheckCheck,
  MoreHorizontal,
  Star,
  Paperclip,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  PanelRight,
  PanelBottom,
  List,
  Printer,
  Download,
  Code,
  LoaderCircle,
  ArrowLeft,
} from "lucide-react";
import { Panel, PanelGroup, PanelResizeHandle } from "../components/Panels";
import { useStore } from "../store";
import { api, post, messageKey, selectRange } from "../api";
import SettingsPage from "../components/SettingsPage";
import Dialog from "../components/Dialog";
import Composer from "../components/Composer";
import Contacts from "../components/Contacts";
import { demoFolders, demoMessages } from "../demo";
import FolderTree from "../components/FolderTree";
import FolderManager from "../components/FolderManager";
import defaults from "../lib/preferences.json";
import {
  formatDate,
  formatTime,
  signatureText,
  replyText,
} from "../lib/mailFormatting";
import { desktopNotification, playSound } from "../lib/notifications";
import MessageBody from "../components/MessageBody";
import MessageAttachments from "../components/MessageAttachments";
import WindowFrame from "../components/WindowFrame";
const folderTypes = {
  "\\Inbox": ["inbox", Inbox],
  "\\Sent": ["sent", Send],
  "\\Drafts": ["drafts", FileText],
  "\\Archive": ["archive", Archive],
  "\\Trash": ["trash", Trash2],
  "\\Junk": ["spam", ShieldAlert],
};
const initialColumns = [
  { key: "from", width: 170 },
  { key: "subject", width: 270 },
  { key: "date", width: 135 },
  { key: "size", width: 78 },
];
function storedColumns() {
  try {
    const value = JSON.parse(localStorage.getItem("columns"));
    return value?.length === 4 &&
      value.every(
        (c) => initialColumns.some((x) => x.key === c.key) && c.width >= 60,
      )
      ? value
      : initialColumns;
  } catch {
    return initialColumns;
  }
}
export default function Mailbox() {
  const { user, logout, darkMode, toggleDarkMode } = useStore();
  const { t } = useTranslation();
  const [viewParams, setViewParams] = useSearchParams();
  const view = viewParams.get("view") || "mail";
  const section = ["contacts", "settings"].includes(view) ? view : "mail";
  const routeUid = Number(viewParams.get("uid"));
  const routeFolder = viewParams.get("folder") || "INBOX";
  const [settings, setSettings] = useState(defaults);
  const [folders, setFolders] = useState([]);
  const [folder, setFolder] = useState(
    () => viewParams.get("folder") || "INBOX",
  );
  const [messages, setMessages] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(new Set());
  const [active, setActive] = useState(null);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [field, setField] = useState("all");
  const [refresh, setRefresh] = useState(0);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState("");
  const [modal, setModal] = useState("");
  const [compose, setCompose] = useState(null);
  const [archiveFolder, setArchiveFolder] = useState("");
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [demoFolderData, setDemoFolderData] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("demoFolders"));
      if (Array.isArray(saved)) return saved;
    } catch {}
    return demoFolders;
  });
  const [columns, setColumns] = useState(storedColumns);
  const [source, setSource] = useState("");
  const [images, setImages] = useState(false);
  const [downloading, setDownloading] = useState(new Set());
  const [readerWindow, setReaderWindow] = useState(null),
    [composerWindow, setComposerWindow] = useState(null);
  const viewKey = useRef(""),
    nextAfter = useRef(null),
    pollState = useRef(null);
  const anchor = useRef(null);
  const dragColumn = useRef(null);
  const detailRef = useRef(null);
  const readKeys = useRef(new Set());
  const navigateSection = useCallback(
    (next) => {
      setMenu("");
      setModal("");
      setViewParams(next === "mail" ? {} : { view: next });
    },
    [setViewParams],
  );
  const showError = useCallback(
    (e) => setError(i18n.t(e.message || "error")),
    [],
  );
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    async function load() {
      try {
        let demoSettings = {};
        if (user.demo) {
          try {
            demoSettings =
              JSON.parse(localStorage.getItem("demoSettings")) || {};
          } catch {}
        }
        const cfg = user.demo
          ? {
              ...defaults,
              name: "Alex Morgan",
              language: i18n.language,
              ...demoSettings,
            }
          : await api("/settings");
        if (cancelled) return;
        setSettings(cfg);
        if (i18n.language !== cfg.language)
          await i18n.changeLanguage(cfg.language);
        setReady(true);
      } catch (e) {
        if (!cancelled) showError(e);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [user, showError]);
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (user.demo ? Promise.resolve(demoFolderData) : api("/folders"))
      .then((data) => {
        if (!cancelled) {
          setFolders(data);
        }
      })
      .catch((e) => {
        if (!cancelled) showError(e);
      });
    return () => {
      cancelled = true;
    };
  }, [user, refresh, showError, demoFolderData]);
  useEffect(() => {
    if (user?.demo)
      localStorage.setItem("demoFolders", JSON.stringify(demoFolderData));
  }, [user, demoFolderData]);
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(query.trim());
      setPage(1);
    }, 400);
    return () => clearTimeout(timer);
  }, [query]);
  useEffect(() => {
    if (!user || !ready) return;
    const controller = new AbortController();
    async function load() {
      setLoading(true);
      setError("");
      const key = JSON.stringify([
        folder,
        page,
        search,
        field,
        settings.pageSize,
      ]);
      if (viewKey.current !== key) {
        setSelected(new Set());
        setActive(null);
        setDetail(null);
        anchor.current = null;
        viewKey.current = key;
      }
      try {
        let data;
        if (user.demo) {
          const rows = demoMessages.filter((m) =>
            search
              ? `${m.subject} ${m.from.name} ${m.text}`
                  .toLowerCase()
                  .includes(search.toLowerCase())
              : m.folder === folder,
          );
          data = {
            total: rows.length,
            messages: rows.slice(
              (page - 1) * settings.pageSize,
              page * settings.pageSize,
            ),
          };
        } else {
          const params = new URLSearchParams({
            folder,
            page,
            pageSize: settings.pageSize,
            q: search,
            field,
          });
          data = await api(`/${search ? "search" : "messages"}?${params}`, {
            signal: controller.signal,
          });
        }
        if (controller.signal.aborted) return;
        if (page > 1 && data.total <= (page - 1) * settings.pageSize) {
          setPage(Math.max(1, Math.ceil(data.total / settings.pageSize)));
          return;
        }
        setMessages(data.messages);
        setTotal(data.total || 0);
        if (nextAfter.current) {
          const target =
            data.messages.find(
              (row) => messageKey(row) === nextAfter.current,
            ) || data.messages[0];
          setActive(target || null);
          setSelected(new Set(target ? [messageKey(target)] : []));
          nextAfter.current = null;
          setViewParams(
            (current) =>
              current.get("view") === "message"
                ? target
                  ? {
                      view: "message",
                      uid: String(target.uid),
                      folder: target.folder,
                    }
                  : {}
                : current,
            { replace: true },
          );
        }
        if (data.skippedFolders?.length) setNotice(t("searchPartial"));
      } catch (e) {
        if (!controller.signal.aborted) showError(e);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    load();
    return () => controller.abort();
  }, [
    user,
    ready,
    folder,
    page,
    settings.pageSize,
    search,
    field,
    refresh,
    showError,
    t,
    setViewParams,
  ]);
  useEffect(() => {
    if (
      !ready ||
      !user ||
      view !== "message" ||
      !Number.isInteger(routeUid) ||
      routeUid <= 0
    )
      return;
    const restored = user.demo
      ? demoMessages.find(
          (row) => row.uid === routeUid && row.folder === routeFolder,
        )
      : { folder: routeFolder, uid: routeUid, seen: false };
    if (!restored) return;
    // oxlint-disable-next-line react/set-state-in-effect -- Restore the reader when browser history or the URL changes.
    setActive((current) =>
      current && messageKey(current) === messageKey(restored)
        ? current
        : restored,
    );
    setSelected(new Set([messageKey(restored)]));
    setImages(false);
  }, [ready, user, view, routeUid, routeFolder]);
  useEffect(() => {
    if (!active || !user) return;
    const controller = new AbortController();
    async function load() {
      setReading(true);
      setDetail(null);
      try {
        const data = user.demo
          ? {
              ...active,
              to: [active.to],
              cc: [],
              html: "",
              attachments: active.attachments || [],
            }
          : await api(
              `/message?${new URLSearchParams({ folder: active.folder, uid: active.uid, images: images ? "1" : "0", peek: "1" })}`,
              { signal: controller.signal },
            );
        if (controller.signal.aborted) return;
        setDetail(data);
      } catch (e) {
        if (!controller.signal.aborted) showError(e);
      } finally {
        if (!controller.signal.aborted) setReading(false);
      }
    }
    load();
    return () => controller.abort();
  }, [active, user, images, settings.externalImages, showError]);
  useEffect(() => {
    if (
      !active ||
      !detail ||
      section !== "mail" ||
      (settings.layout === "list" && view !== "message" && !readerWindow) ||
      (detail.seen ?? active.seen) ||
      settings.markReadDelay < 0 ||
      readKeys.current.has(messageKey(active))
    )
      return;
    const timer = setTimeout(async () => {
      try {
        if (!user.demo)
          await post("/messages/flags", {
            items: [{ folder: active.folder, uid: active.uid }],
            add: ["\\Seen"],
          });
        readKeys.current.add(messageKey(active));
        setMessages((rows) =>
          rows.map((row) =>
            messageKey(row) === messageKey(active)
              ? { ...row, seen: true }
              : row,
          ),
        );
        setFolders((rows) =>
          rows.map((row) =>
            row.path === active.folder
              ? { ...row, unseen: Math.max(0, row.unseen - 1) }
              : row,
          ),
        );
      } catch (e) {
        showError(e);
      }
    }, settings.markReadDelay * 1000);
    return () => clearTimeout(timer);
  }, [
    active,
    detail,
    settings.markReadDelay,
    settings.layout,
    section,
    view,
    readerWindow,
    user,
    showError,
  ]);
  useEffect(() => {
    if (!ready || user?.demo || !settings.refreshInterval) return;
    let stopped = false,
      running = false;
    const poll = async () => {
      if (running) return;
      running = true;
      try {
        const data = await api("/poll");
        if (stopped) return;
        let count = 0;
        for (const state of data.states) {
          const before = pollState.current?.get(state.folder);
          if (
            before &&
            before.uidValidity === state.uidValidity &&
            state.uidNext > before.uidNext
          )
            count += Math.min(state.total, state.uidNext - before.uidNext);
        }
        pollState.current = new Map(
          data.states.map((state) => [state.folder, state]),
        );
        setFolders((rows) =>
          rows.map((row) => {
            const state = pollState.current.get(row.path);
            return state
              ? { ...row, total: state.total, unseen: state.unseen }
              : row;
          }),
        );
        if (count) {
          const body = t("newMailCount", { count });
          if (settings.browserNotifications) setNotice(body);
          if (settings.soundNotifications) playSound();
          if (settings.desktopNotifications)
            await desktopNotification(
              t("newMail"),
              body,
              settings.notificationDuration,
            );
        }
        if (data.skippedFolders.length && settings.browserNotifications)
          setNotice(t("pollPartial"));
        setRefresh((value) => value + 1);
      } catch (e) {
        if (!stopped) showError(e);
      } finally {
        running = false;
      }
    };
    poll();
    const timer = setInterval(poll, settings.refreshInterval * 1000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [
    ready,
    user,
    settings.refreshInterval,
    settings.checkAllFolders,
    settings.browserNotifications,
    settings.desktopNotifications,
    settings.soundNotifications,
    settings.notificationDuration,
    t,
    showError,
  ]);
  useEffect(() => {
    if (!menu) return;
    const close = (e) => {
      if (!e.target.closest(".dropdown")) setMenu("");
    };
    const escape = (e) => {
      if (e.key === "Escape") setMenu("");
    };
    document.addEventListener("click", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("click", close);
      document.removeEventListener("keydown", escape);
    };
  }, [menu]);
  useEffect(() => {
    localStorage.setItem("columns", JSON.stringify(columns));
  }, [columns]);
  const closeModal = useCallback(() => setModal(""), []);
  const closeCompose = useCallback(() => {
    setCompose(null);
    setComposerWindow(null);
  }, []);
  const closeReader = useCallback(() => {
    setActive(null);
    setDetail(null);
    setReaderWindow(null);
    setViewParams(
      (current) => {
        if (current.get("view") !== "message") return current;
        const next = new URLSearchParams(current);
        next.delete("view");
        next.delete("uid");
        next.delete("folder");
        return next;
      },
      { replace: true },
    );
  }, [setViewParams]);
  if (!user) return <Navigate to="/login" />;
  const searching =
    Boolean(query.trim()) && (loading || query.trim() !== search);
  const maxPage = Math.max(1, Math.ceil(total / settings.pageSize));
  const fullMessage =
    settings.layout === "list" && active && !readerWindow && view === "message";
  const folderLabel = (f) =>
    settings.realFolderNames
      ? f.path
      : t(folderTypes[f.specialUse]?.[0] || "", { defaultValue: f.path }) ||
        f.path;
  const currentFolder = folders.find((f) => f.path === folder);
  const title = search
    ? t("searchResults")
    : currentFolder
      ? folderLabel(currentFolder)
      : t("inbox");
  async function saveSettings(saved) {
    setSettings(saved);
    if (!saved.messageNewWindow) setReaderWindow(null);
    setPage(1);
    if (saved.hiddenFolders.includes(folder)) {
      const visible = folders.find(
        (f) =>
          f.selectable !== false &&
          !saved.hiddenFolders.some(
            (path) =>
              f.path === path || f.path.startsWith(path + (f.delimiter || "/")),
          ),
      );
      if (visible) setFolder(visible.path);
    }
    if (user.demo) localStorage.setItem("demoSettings", JSON.stringify(saved));
  }
  async function changeLayout(layout) {
    const next = { ...settings, layout };
    try {
      if (!user.demo) await post("/settings", { layout }, "PUT");
      setSettings(next);
    } catch (e) {
      showError(e);
    }
  }
  function clickRow(event, row, checkbox = false) {
    const key = messageKey(row);
    if (event.shiftKey && anchor.current) {
      setSelected(
        selectRange(
          messages,
          selected,
          anchor.current,
          key,
          event.ctrlKey || event.metaKey,
        ),
      );
    } else if (event.ctrlKey || event.metaKey || checkbox) {
      setSelected((current) => {
        const next = new Set(current);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      });
      anchor.current = key;
    } else {
      setSelected(new Set([key]));
      anchor.current = key;
      setImages(false);
      if (settings.messageNewWindow) {
        const popup = window.open("", "_blank", "width=960,height=780");
        if (popup) setReaderWindow(popup);
        else setNotice(t("popupBlocked"));
      }
      setActive(row);
      if (settings.layout === "list")
        setViewParams({
          view: "message",
          uid: String(row.uid),
          folder: row.folder,
        });
      else if (view === "message") setViewParams({}, { replace: true });
    }
  }
  function selectBy(value) {
    setSelected(
      new Set(
        messages
          .filter(
            (row) =>
              value === "all" ||
              (value === "read" && row.seen) ||
              (value === "unread" && !row.seen),
          )
          .map(messageKey),
      ),
    );
    anchor.current = null;
    setMenu("");
  }
  async function bulk(action, body = {}) {
    if (busy || !selected.size) return;
    if (action === "archive" && !settings.archiveFolder) {
      setArchiveFolder(
        folders.find((f) => f.specialUse === "\\Archive")?.path || "",
      );
      setModal("archive");
      return;
    }
    if (user.demo) {
      setNotice(t("demoAction"));
      return;
    }
    const permanent =
      action === "delete" &&
      !settings.flagDeleted &&
      messages.some(
        (row) =>
          selected.has(messageKey(row)) &&
          (row.folder ===
            (settings.trashFolder ||
              folders.find((f) => f.specialUse === "\\Trash")?.path) ||
            !(
              settings.trashFolder ||
              folders.some((f) => f.specialUse === "\\Trash")
            ) ||
            (settings.deleteSpamDirectly &&
              row.folder ===
                (settings.spamFolder ||
                  folders.find((f) => f.specialUse === "\\Junk")?.path))),
      );
    if (action === "delete" && permanent && !confirm(t("permanentDelete")))
      return;
    setBusy(true);
    setError("");
    setMenu("");
    try {
      await post(`/messages/${action}`, {
        items: messages
          .filter((row) => selected.has(messageKey(row)))
          .map(({ folder, uid }) => ({ folder, uid })),
        ...body,
        confirmPermanent: permanent,
      });
      if (["delete", "move", "archive", "spam"].includes(action)) {
        if (settings.nextAfterAction) {
          const first = messages.findIndex((row) =>
            selected.has(messageKey(row)),
          );
          const next =
            messages
              .slice(first + 1)
              .find((row) => !selected.has(messageKey(row))) ||
            messages.find((row) => !selected.has(messageKey(row)));
          nextAfter.current = next ? messageKey(next) : "first";
        }
        setSelected(new Set());
        setActive(null);
        setDetail(null);
        setViewParams(
          (current) =>
            current.get("view") === "message" ? { view: "message" } : current,
          { replace: true },
        );
      }
      setRefresh((value) => value + 1);
    } catch (e) {
      showError(e);
    } finally {
      setBusy(false);
    }
  }
  async function archive(event) {
    event.preventDefault();
    setBusy(true);
    try {
      const saved = user.demo
        ? { ...settings, archiveFolder }
        : await post("/settings", { archiveFolder }, "PUT");
      setSettings(saved);
      setModal("");
      if (!user.demo) {
        await post("/messages/archive", {
          items: messages
            .filter((row) => selected.has(messageKey(row)))
            .map(({ folder, uid }) => ({ folder, uid })),
        });
        setRefresh((value) => value + 1);
      } else setNotice(t("demoAction"));
    } catch (e) {
      showError(e);
    } finally {
      setBusy(false);
    }
  }
  function newCompose(to = "") {
    if (settings.composeNewWindow) {
      const popup = window.open("", "_blank", "width=980,height=820");
      if (popup) setComposerWindow(popup);
      else setNotice(t("popupBlocked"));
    }
    setCompose(
      to
        ? {
            to,
            cc: "",
            bcc: "",
            subject: "",
            text: signatureText(settings),
          }
        : {},
    );
  }
  function respond(kind) {
    if (!detail) return;
    if (kind === "replyAll" && settings.replyAllDefault === "sender")
      kind = "reply";
    if (settings.composeNewWindow) {
      const popup = window.open("", "_blank", "width=980,height=820");
      if (popup) setComposerWindow(popup);
      else setNotice(t("popupBlocked"));
    }
    const from = detail.replyTo?.address || detail.from.address;
    const to = kind === "forward" ? "" : from;
    const cc =
      kind === "replyAll"
        ? [...detail.to, ...detail.cc]
            .map((a) => a.address)
            .filter((a) => a !== user.email && a !== from)
            .filter((a, i, arr) => arr.indexOf(a) === i)
            .join(", ")
        : "";
    setCompose({
      to,
      cc,
      bcc: "",
      subject: `${kind === "forward" ? "Fwd" : "Re"}: ${(detail.subject || "").replace(/^(re|fwd):\s*/i, "")}`,
      text:
        kind === "forward" && settings.forwardMode === "attachment"
          ? signatureText(settings, "forward")
          : replyText(detail, settings, kind),
      kind,
      hasHtml: detail.hasHtml,
      sourceFolder: detail.folder,
      original: { folder: detail.folder, uid: detail.uid },
      originalHtml: settings.keepFormatting ? detail.html : undefined,
      inReplyTo: kind === "forward" ? undefined : detail.messageId,
      references:
        kind === "forward"
          ? []
          : [...(detail.references || []), detail.messageId].filter(Boolean),
    });
  }
  async function download(kind, index) {
    if (!detail) return;
    if (user.demo && kind !== "attachment") {
      setNotice(t("demoAction"));
      return;
    }
    if (kind === "attachment") {
      if (downloading.has(index)) return;
      setDownloading((current) => new Set([...current, index]));
    }
    try {
      const params = new URLSearchParams({
        folder: detail.folder,
        uid: detail.uid,
        download: "1",
      });
      if (index !== undefined) params.set("index", index);
      let blob;
      if (user.demo) {
        const attachment = detail.attachments.find((a) => a.index === index);
        if (!attachment) throw new Error(t("error"));
        blob = new Blob([attachment.content], { type: attachment.contentType });
      } else {
        const response = await fetch(`/api/${kind}?${params}`, {
          headers: { Authorization: `Bearer ${user.token}` },
        });
        if (!response.ok) throw new Error(t("error"));
        blob = await response.blob();
      }
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download =
        kind === "source"
          ? `message-${detail.uid}.eml`
          : detail.attachments.find((a) => a.index === index)?.filename ||
            "attachment";
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      showError(e);
    } finally {
      if (kind === "attachment")
        setDownloading((current) => {
          const next = new Set(current);
          next.delete(index);
          return next;
        });
    }
  }
  async function viewSource() {
    setMenu("");
    try {
      setSource(
        user.demo
          ? detail.text
          : await (
              await fetch(
                `/api/source?${new URLSearchParams({ folder: detail.folder, uid: detail.uid })}`,
                { headers: { Authorization: `Bearer ${user.token}` } },
              )
            ).text(),
      );
      setModal("source");
    } catch (e) {
      showError(e);
    }
  }
  function resizeColumn(event, key) {
    event.preventDefault();
    event.stopPropagation();
    const start = event.clientX;
    const width = columns.find((c) => c.key === key).width;
    event.currentTarget.setPointerCapture(event.pointerId);
    const move = (e) =>
      setColumns((current) =>
        current.map((c) =>
          c.key === key
            ? {
                ...c,
                width: Math.max(65, Math.min(700, width + e.clientX - start)),
              }
            : c,
        ),
      );
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
  }
  const grid = {
    gridTemplateColumns: `38px 30px ${columns.map((c) => `${c.width}px`).join(" ")}`,
  };
  const renderList = () => (
    <div className="mail-list">
      <div className="list-controls">
        <div className="selection-controls">
          <input
            aria-label={t("all")}
            type="checkbox"
            checked={messages.length > 0 && selected.size === messages.length}
            ref={(element) => {
              if (element)
                element.indeterminate =
                  selected.size > 0 && selected.size < messages.length;
            }}
            onChange={(e) => selectBy(e.target.checked ? "all" : "none")}
          />
          <div className="dropdown">
            <button
              className="select-trigger"
              onClick={() => setMenu(menu === "select" ? "" : "select")}
            >
              {selected.size
                ? t("selected", { count: selected.size })
                : t("selection")}
              <ChevronRight className="rotate" size={14} />
            </button>
            {menu === "select" && (
              <div className="dropdown-menu">
                {["all", "none", "read", "unread"].map((value) => (
                  <button key={value} onClick={() => selectBy(value)}>
                    {t(value)}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="pagination">
          <span>
            {t("messages_count", {
              start: total ? (page - 1) * settings.pageSize + 1 : 0,
              end: Math.min(page * settings.pageSize, total),
              total,
            })}
          </span>
          <button
            title={t("firstPage")}
            disabled={page === 1 || loading}
            onClick={() => setPage(1)}
          >
            <ChevronsLeft size={15} />
          </button>
          <button
            aria-label={t("previousPage")}
            disabled={page === 1 || loading}
            onClick={() => setPage(page - 1)}
          >
            <ChevronLeft size={15} />
          </button>
          <span className="page-number">{page}</span>
          <button
            aria-label={t("nextPage")}
            disabled={page === maxPage || loading}
            onClick={() => setPage(page + 1)}
          >
            <ChevronRight size={15} />
          </button>
          <button
            aria-label={t("lastPage")}
            disabled={page === maxPage || loading}
            onClick={() => setPage(maxPage)}
          >
            <ChevronsRight size={15} />
          </button>
        </div>
      </div>
      <div className="table-scroll">
        <div className="table-grid table-heading" style={grid}>
          <span />
          <span>
            <Star size={13} />
          </span>
          {columns.map((column) => (
            <div
              className="column-heading"
              key={column.key}
              draggable
              onDragStart={() => {
                dragColumn.current = column.key;
              }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => {
                const next = [...columns];
                const from = next.findIndex(
                  (c) => c.key === dragColumn.current,
                );
                if (from < 0) return;
                const to = next.findIndex((c) => c.key === column.key);
                const [moved] = next.splice(from, 1);
                next.splice(to, 0, moved);
                setColumns(next);
              }}
            >
              {t(column.key)}
              <span
                className="column-resizer"
                draggable={false}
                onPointerDown={(e) => resizeColumn(e, column.key)}
              />
            </div>
          ))}
        </div>
        {loading ? (
          <div className="empty-state">
            <LoaderCircle className="spinner" size={28} />
            <p>{t("loading")}</p>
          </div>
        ) : messages.length ? (
          messages.map((row) => (
            <div
              key={messageKey(row)}
              className={`table-grid message-row ${!row.seen ? "unread" : ""} ${selected.has(messageKey(row)) ? "selected" : ""}`}
              style={grid}
              onClick={(e) => clickRow(e, row)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  clickRow(e, row);
                }
              }}
              role="row"
              tabIndex="0"
            >
              <span className="row-check">
                <input
                  type="checkbox"
                  aria-label={`${t("selection")}: ${row.subject}`}
                  checked={selected.has(messageKey(row))}
                  onClick={(e) => {
                    e.stopPropagation();
                    clickRow(e, row, true);
                  }}
                  onChange={() => {}}
                />
              </span>
              <span className="row-star">
                <button
                  className={`star-button ${row.flagged ? "flagged" : ""}`}
                  aria-label={t(row.flagged ? "unflag" : "flag")}
                  onClick={async (e) => {
                    e.stopPropagation();
                    if (user.demo) {
                      setMessages((current) =>
                        current.map((m) =>
                          messageKey(m) === messageKey(row)
                            ? { ...m, flagged: !m.flagged }
                            : m,
                        ),
                      );
                      return;
                    }
                    try {
                      await post("/messages/flags", {
                        items: [{ folder: row.folder, uid: row.uid }],
                        ...(row.flagged
                          ? { remove: ["\\Flagged"] }
                          : { add: ["\\Flagged"] }),
                      });
                      setMessages((current) =>
                        current.map((m) =>
                          messageKey(m) === messageKey(row)
                            ? { ...m, flagged: !m.flagged }
                            : m,
                        ),
                      );
                    } catch (err) {
                      showError(err);
                    }
                  }}
                >
                  <Star size={14} />
                </button>
              </span>
              {columns.map((column) => (
                <div key={column.key} className={`cell cell-${column.key}`}>
                  {column.key === "from" ? (
                    <>
                      <span
                        className={`sender-dot ${row.seen ? "seen" : ""}`}
                      />
                      <span>
                        {settings.showEmailAddress && row.from.name
                          ? `${row.from.name} <${row.from.address}>`
                          : row.from.name || row.from.address}
                      </span>
                    </>
                  ) : column.key === "subject" ? (
                    <>
                      <span>{row.subject || t("noSubject")}</span>
                      {row.attachment && <Paperclip size={13} />}
                      {search && <small>{row.folder}</small>}
                    </>
                  ) : column.key === "date" ? (
                    formatDate(row.date, settings, true)
                  ) : (
                    `${Math.max(1, Math.round(row.size / 1024))} KB`
                  )}
                </div>
              ))}
            </div>
          ))
        ) : (
          <div className="empty-state">
            <Inbox size={38} strokeWidth={1.3} />
            <p>{t("empty")}</p>
          </div>
        )}
      </div>
      <div className="list-footnote">{t("keyboardHint")}</div>
    </div>
  );
  const renderDetail = () => (
    <div className="reading-pane">
      {active ? (
        <>
          <header className="reading-top">
            {fullMessage ? (
              <button
                className="secondary"
                onClick={() => navigateSection("mail")}
              >
                <ArrowLeft size={18} /> {t("backToList")}
              </button>
            ) : (
              <span className="eyebrow">{t("preview")}</span>
            )}
            <button
              className="icon-button"
              title={t("close")}
              onClick={() => {
                closeReader();
              }}
            >
              <X size={18} />
            </button>
          </header>
          {reading ? (
            <div className="empty-state">
              <LoaderCircle className="spinner" size={28} />
              <p>{t("loading")}</p>
            </div>
          ) : detail ? (
            <>
              <div className="message-heading">
                <h2>{detail.subject || t("noSubject")}</h2>
                <div className="sender-card">
                  <span className="avatar">
                    {(detail.from.name || detail.from.address)
                      .slice(0, 2)
                      .toUpperCase()}
                  </span>
                  <div>
                    <strong>{detail.from.name || detail.from.address}</strong>
                    <small>{detail.from.address}</small>
                    <small>
                      {t("to")}: {detail.to.map((a) => a.address).join(", ")}
                    </small>
                  </div>
                </div>
                <div className="message-date">
                  {formatDate(detail.date, settings)} ·{" "}
                  {detail.date ? formatTime(detail.date, settings) : ""}
                </div>
              </div>
              <MessageAttachments
                attachments={detail.attachments}
                downloading={downloading}
                onDownload={(index) => download("attachment", index)}
              />
              {settings.showHtml &&
                detail.remoteImagesBlocked &&
                settings.externalImages === "ask" && (
                  <div className="images-notice">
                    {t("imagesBlocked")}
                    <button
                      className="text-button"
                      onClick={() => setImages(true)}
                    >
                      {t("loadImages")}
                    </button>
                  </div>
                )}
              {detail.receiptRequested && settings.sendReceipts === "ask" && (
                <div className="images-notice">
                  {t("receiptRequested")}
                  <button
                    className="text-button"
                    onClick={async () => {
                      if (
                        !confirm(
                          t("receiptConfirm", { email: detail.receiptTo }),
                        )
                      )
                        return;
                      try {
                        if (user.demo) return;
                        await post("/messages/receipt", {
                          folder: detail.folder,
                          uid: detail.uid,
                          confirm: true,
                        });
                        setNotice(t("receiptSent"));
                        setDetail((current) => ({
                          ...current,
                          receiptRequested: false,
                        }));
                      } catch (e) {
                        showError(e);
                      }
                    }}
                  >
                    {t("sendReceipt")}
                  </button>
                </div>
              )}
              <div className="message-body" ref={detailRef}>
                <MessageBody
                  detail={detail}
                  settings={settings}
                  images={images}
                  darkMode={darkMode}
                />
              </div>
              <footer className="reading-footer">
                {settings.trustedSendersBook && (
                  <button
                    className="text-button"
                    onClick={async () => {
                      try {
                        if (!user.demo)
                          await post("/trusted-senders", {
                            email: detail.from.address,
                            name: detail.from.name,
                            confirm: true,
                          });
                        setNotice(t("trustedSenderSaved"));
                      } catch (e) {
                        showError(e);
                      }
                    }}
                  >
                    {t("trustSender")}
                  </button>
                )}
                <button className="secondary" onClick={() => respond("reply")}>
                  <Reply size={17} />
                  {t("reply")}
                </button>
                <button
                  className="text-button"
                  onClick={() => respond("forward")}
                >
                  <Forward size={17} />
                  {t("forward")}
                </button>
              </footer>
            </>
          ) : null}
        </>
      ) : (
        <div className="reading-empty">
          <div className="empty-envelope">
            <Mail size={48} strokeWidth={1.2} />
          </div>
          <h3>{t("selectMessage")}</h3>
          <p>{t("selectMessageHint")}</p>
          <span className="decorative-line" />
        </div>
      )}
    </div>
  );
  return (
    <div className="webmail">
      <header className="app-header">
        <div className="brand">
          <span className="brand-icon">
            <Mail size={22} />
          </span>
          post<span className="brand-dot">.</span>
        </div>
        <nav className="main-nav">
          <button
            className={section === "mail" ? "active" : ""}
            aria-current={section === "mail" ? "page" : undefined}
            onClick={() => navigateSection("mail")}
          >
            <Mail size={18} />
            {t("mail")}
          </button>
          <button
            className={section === "contacts" ? "active" : ""}
            aria-current={section === "contacts" ? "page" : undefined}
            onClick={() => navigateSection("contacts")}
          >
            <Users size={18} />
            {t("contacts")}
          </button>
          <button
            className={section === "settings" ? "active" : ""}
            aria-current={section === "settings" ? "page" : undefined}
            onClick={() => navigateSection("settings")}
          >
            <Settings size={18} />
            {t("settings")}
          </button>
        </nav>
        <div className="header-actions">
          <span className="account-email">{user.email}</span>
          <button
            className="icon-button"
            title={t(darkMode ? "light" : "dark")}
            onClick={toggleDarkMode}
          >
            {darkMode ? <Sun size={19} /> : <Moon size={19} />}
          </button>
          <button
            className="icon-button"
            title={t("logout")}
            onClick={async () => {
              if (
                (settings.emptyTrashOnLogout !== "never" ||
                  settings.expungeInboxOnLogout) &&
                !confirm(t("maintenanceConfirm"))
              )
                return;
              try {
                if (!user.demo)
                  await post("/logout", { confirmMaintenance: true });
                logout();
              } catch (e) {
                showError(e);
              }
            }}
          >
            <LogOut size={18} />
          </button>
          <span className="avatar small">
            {(settings.name || user.email).slice(0, 2).toUpperCase()}
          </span>
        </div>
      </header>
      {user.demo && <div className="demo-banner">{t("demoHint")}</div>}
      <div className="workspace" hidden={section !== "mail"}>
        <PanelGroup direction="horizontal" autoSaveId="post-sidebar">
          <Panel id="sidebar" defaultSize={18} minSize={12} maxSize={35}>
            <aside className="folder-sidebar">
              <button
                className="primary compose-button"
                onClick={() => newCompose()}
              >
                <Plus size={21} />
                {t("compose")}
              </button>
              <div className="sidebar-label">
                {t("account")}
                <span className="status-dot" />
              </div>
              <FolderTree
                folders={folders}
                hidden={settings.hiddenFolders}
                selected={folder}
                realNames={settings.realFolderNames}
                search={search}
                onSelect={(path) => {
                  navigateSection("mail");
                  setFolder(path);
                  setPage(1);
                  setQuery("");
                  setSearch("");
                }}
                onDelete={(target) => {
                  setDeleteTarget(target);
                  setModal("deleteFolder");
                }}
              />
              <button
                className="text-button new-folder"
                onClick={() => setModal("folder")}
              >
                <Plus size={16} />
                {t("newFolder")}
              </button>
              <div className="sidebar-bottom">
                <div className="account-chip">
                  <span className="avatar small">
                    {(settings.name || user.email).slice(0, 2).toUpperCase()}
                  </span>
                  <div>
                    <strong>{settings.name || user.email.split("@")[0]}</strong>
                    <small>{user.email}</small>
                  </div>
                  <button
                    className="icon-button"
                    title={t("settings")}
                    onClick={() => navigateSection("settings")}
                  >
                    <Settings size={16} />
                  </button>
                </div>
                <span className="sidebar-caption">a calmer inbox</span>
              </div>
            </aside>
          </Panel>
          <PanelResizeHandle className="resize-handle sidebar-resize" />
          <Panel id="workspace" minSize={45}>
            <main className="mail-workspace">
              <div className="mail-heading">
                <div>
                  <span className="eyebrow">{t("mail")}</span>
                  <h1>
                    {title}
                    <span className="total-badge">{total}</span>
                  </h1>
                </div>
                <div
                  className={`search-box ${searching ? "searching" : ""}`}
                  aria-busy={searching}
                >
                  <select
                    aria-label={t("search")}
                    value={field}
                    onChange={(e) => {
                      setField(e.target.value);
                      setPage(1);
                    }}
                  >
                    {["all", "subject", "from", "to"].map((value) => (
                      <option key={value} value={value}>
                        {t(value)}
                      </option>
                    ))}
                  </select>
                  <input
                    aria-label={t("search")}
                    placeholder={t("search")}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                  {searching && (
                    <LoaderCircle
                      size={19}
                      className="spinner search-spinner"
                      aria-hidden="true"
                    />
                  )}
                  {query ? (
                    <button
                      className="icon-button"
                      aria-label={t("searchClear")}
                      onClick={() => setQuery("")}
                    >
                      <X size={16} />
                    </button>
                  ) : (
                    <Search size={19} />
                  )}
                </div>
              </div>
              <div className="action-toolbar">
                <div className="toolbar-actions">
                  <Tool
                    icon={RefreshCw}
                    label={t("refresh")}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        if (!user.demo) await post("/refresh", {});
                        setRefresh((value) => value + 1);
                      } catch (e) {
                        showError(e);
                      } finally {
                        setBusy(false);
                      }
                    }}
                    disabled={loading || busy}
                  />
                  <span className="toolbar-separator" />
                  <Tool
                    icon={Reply}
                    label={t("reply")}
                    onClick={() => respond("reply")}
                    disabled={!detail || busy}
                  />
                  <Tool
                    icon={ReplyAll}
                    label={t("replyAll")}
                    onClick={() => respond("replyAll")}
                    disabled={!detail || busy}
                  />
                  <Tool
                    icon={Forward}
                    label={t("forward")}
                    onClick={() => respond("forward")}
                    disabled={!detail || busy}
                  />
                  <span className="toolbar-separator" />
                  <Tool
                    icon={Trash2}
                    label={t("delete")}
                    onClick={() => bulk("delete")}
                    disabled={!selected.size || busy}
                  />
                  <Tool
                    icon={Archive}
                    label={t("archive")}
                    onClick={() => bulk("archive")}
                    disabled={!selected.size || busy}
                  />
                  <Tool
                    icon={ShieldAlert}
                    label={t("spam")}
                    onClick={() => bulk("spam")}
                    disabled={!selected.size || busy}
                  />
                  <div className="dropdown">
                    <Tool
                      icon={CheckCheck}
                      label={t("mark")}
                      onClick={() => setMenu(menu === "mark" ? "" : "mark")}
                      disabled={!selected.size || busy}
                    />
                    {menu === "mark" && (
                      <div className="dropdown-menu">
                        {[
                          ["markRead", "add", "\\Seen"],
                          ["markUnread", "remove", "\\Seen"],
                          ["flag", "add", "\\Flagged"],
                          ["unflag", "remove", "\\Flagged"],
                        ].map(([key, type, flag]) => (
                          <button
                            key={key}
                            onClick={() => bulk("flags", { [type]: [flag] })}
                          >
                            {t(key)}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="dropdown">
                    <Tool
                      icon={MoreHorizontal}
                      label={t("more")}
                      onClick={() => setMenu(menu === "more" ? "" : "more")}
                    />
                    {menu === "more" && (
                      <div className="dropdown-menu more-menu">
                        <button
                          disabled={!detail}
                          onClick={() => {
                            setMenu("");
                            const printWindow = window.open("", "_blank");
                            if (!printWindow) {
                              setError(t("error"));
                              return;
                            }
                            printWindow.opener = null;
                            const escape = (value) =>
                              String(value || "")
                                .replace(/&/g, "&amp;")
                                .replace(/</g, "&lt;")
                                .replace(/>/g, "&gt;");
                            printWindow.addEventListener(
                              "load",
                              () => printWindow.print(),
                              { once: true },
                            );
                            printWindow.document.write(
                              `<!doctype html><html><head><title>${escape(detail.subject)}</title><style>body{font:14px/1.6 Arial;margin:40px}img,table{max-width:100%}pre{white-space:pre-wrap;font:inherit}</style></head><body><h1>${escape(detail.subject)}</h1><p>${escape(detail.from.address)} · ${escape(detail.date)}</p>${detail.html || `<pre>${escape(detail.text)}</pre>`}</body></html>`,
                            );
                            printWindow.document.close();
                          }}
                        >
                          <Printer size={16} />
                          {t("print")}
                        </button>
                        <button
                          disabled={!detail}
                          onClick={() => download("source")}
                        >
                          <Download size={16} />
                          {t("export")}
                        </button>
                        <button disabled={!detail} onClick={viewSource}>
                          <Code size={16} />
                          {t("source")}
                        </button>
                        <div className="menu-label">{t("move")}</div>
                        {folders
                          .filter((f) => f.selectable !== false)
                          .map((f) => (
                            <button
                              key={f.path}
                              disabled={!selected.size || busy}
                              onClick={() => bulk("move", { dest: f.path })}
                            >
                              <Folder size={15} />
                              {folderLabel(f)}
                            </button>
                          ))}
                      </div>
                    )}
                  </div>
                </div>
                <div className="layout-switch">
                  {[
                    ["list", List],
                    ["bottom", PanelBottom],
                    ["right", PanelRight],
                  ].map(([value, Icon]) => (
                    <button
                      key={value}
                      className={settings.layout === value ? "active" : ""}
                      title={t(`layout_${value}`)}
                      aria-pressed={settings.layout === value}
                      onClick={() => changeLayout(value)}
                    >
                      <Icon size={18} />
                    </button>
                  ))}
                </div>
              </div>
              {searching && (
                <div className="search-progress" role="status">
                  <LoaderCircle size={14} className="spinner" />
                  <span>{t("searching")}</span>
                  <span className="search-beam" />
                </div>
              )}
              {error && (
                <div className="notice error" role="alert">
                  {error}
                  <button
                    className="text-button"
                    onClick={() => setRefresh((value) => value + 1)}
                  >
                    {t("retry")}
                  </button>
                  <button className="icon-button" onClick={() => setError("")}>
                    <X size={15} />
                  </button>
                </div>
              )}
              {notice && (
                <div className="notice" role="status">
                  {notice}
                  <button className="icon-button" onClick={() => setNotice("")}>
                    <X size={15} />
                  </button>
                </div>
              )}
              <div className={`mail-content layout-${settings.layout}`}>
                <PanelGroup
                  key={settings.layout}
                  direction={
                    settings.layout === "bottom" ? "vertical" : "horizontal"
                  }
                  autoSaveId={`post-${settings.layout}`}
                >
                  <Panel
                    id="messages"
                    minSize={25}
                    defaultSize={settings.layout === "list" ? 100 : 55}
                  >
                    <div
                      className="message-list-screen"
                      hidden={Boolean(fullMessage)}
                    >
                      {renderList()}
                    </div>
                    {fullMessage && renderDetail()}
                  </Panel>
                  {settings.layout !== "list" && (
                    <>
                      <PanelResizeHandle
                        className={`resize-handle ${settings.layout === "bottom" ? "horizontal" : ""}`}
                      />
                      <Panel id="reader" minSize={25}>
                        {readerWindow ? (
                          <div className="reading-empty">
                            <Mail size={40} />
                            <p>{t("prefs.messageNewWindow")}</p>
                          </div>
                        ) : (
                          renderDetail()
                        )}
                      </Panel>
                    </>
                  )}
                </PanelGroup>
              </div>
            </main>
          </Panel>
        </PanelGroup>
      </div>
      {readerWindow && active && (
        <WindowFrame popup={readerWindow} onClose={closeReader}>
          {renderDetail()}
        </WindowFrame>
      )}
      {section === "settings" && (
        <div className="workspace">
          <SettingsPage
            initial={settings}
            folders={folders}
            onSaved={saveSettings}
            onClose={() => navigateSection("mail")}
          />
        </div>
      )}
      {section === "contacts" && (
        <div className="workspace">
          <Contacts
            settings={settings}
            onClose={() => navigateSection("mail")}
            onCompose={(to) => {
              navigateSection("mail");
              newCompose(to);
            }}
          />
        </div>
      )}
      {compose && (
        <Composer
          initial={Object.keys(compose).length ? compose : null}
          settings={settings}
          popup={composerWindow}
          onClose={closeCompose}
          onSent={() => {
            setNotice(t("sentSuccess"));
            setRefresh((value) => value + 1);
          }}
        />
      )}
      {modal === "archive" && (
        <Dialog title={t("noArchive")} onClose={closeModal}>
          <form className="simple-form" onSubmit={archive}>
            <p className="muted">{t("archiveHint")}</p>
            <label>
              {t("archiveFolder")}
              <select
                required
                value={archiveFolder}
                onChange={(e) => setArchiveFolder(e.target.value)}
              >
                <option value="">{t("chooseFolder")}</option>
                {folders
                  .filter((f) => f.selectable !== false)
                  .map((f) => (
                    <option key={f.path} value={f.path}>
                      {folderLabel(f)}
                    </option>
                  ))}
              </select>
            </label>
            <footer className="dialog-footer">
              <button type="button" className="secondary" onClick={closeModal}>
                {t("cancel")}
              </button>
              <button className="primary" disabled={busy}>
                {t("archive")}
              </button>
            </footer>
          </form>
        </Dialog>
      )}
      {modal === "source" && (
        <Dialog title={t("source")} onClose={closeModal} wide>
          <pre className="source-view">{source}</pre>
        </Dialog>
      )}
      {(modal === "folder" || modal === "deleteFolder") && (
        <FolderManager
          mode={modal === "folder" ? "create" : "delete"}
          target={deleteTarget}
          folders={folders}
          selected={folder}
          demo={user.demo}
          onClose={closeModal}
          onCreated={(created) => {
            if (user.demo)
              setDemoFolderData((current) => [...current, created]);
            else setRefresh((value) => value + 1);
            setFolder(created.path);
            setPage(1);
            setQuery("");
            setSearch("");
          }}
          onDeleted={(result) => {
            if (user.demo)
              setDemoFolderData((current) =>
                current.filter((f) => !result.deleted.includes(f.path)),
              );
            else setRefresh((value) => value + 1);
            if (result.settings) setSettings(result.settings);
            if (result.deleted.includes(folder)) {
              setFolder("INBOX");
              setPage(1);
            }
            setNotice(t("folderDeleted"));
          }}
        />
      )}
    </div>
  );
}
function Tool({ icon: Icon, label, onClick, disabled }) {
  return (
    <button
      className="tool-button"
      title={label}
      onClick={onClick}
      disabled={disabled}
    >
      <Icon size={18} strokeWidth={1.7} />
      <span>{label}</span>
    </button>
  );
}
