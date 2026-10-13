import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Folder,
  FolderPlus,
  FolderUp,
  Upload,
  Download,
  HardDrive,
  Cloud,
  Trash2,
  Pencil,
  FolderInput,
  RotateCcw,
  ChevronRight,
  Search,
  List,
  LayoutGrid,
  RefreshCw,
  X,
  FileText,
  Image,
  File,
  Lock,
  Link,
  ExternalLink,
  Check,
  LoaderCircle,
  Eye,
} from "lucide-react";
import WorkspacePage from "./WorkspacePage";
import Dialog from "./Dialog";
import CalendarOAuthSetup from "./CalendarOAuthSetup";
import OfficePreview from "./OfficePreview";
import { officeFile } from "../lib/office";
import { useStore } from "../store";
import { api, post } from "../api";
import {
  fileSize,
  fileSelection,
  uploadPath,
  droppedFiles,
  uploadChunk,
  saveBlob,
} from "../lib/files";
import { demoFiles } from "../lib/filesDemo";

function ItemIcon({ item, size = 22 }) {
  const Icon = item.folder
    ? Folder
    : (item.mime || "").startsWith("image/")
      ? Image
      : /text|pdf|document|spreadsheet|json/.test(item.mime || "")
        ? FileText
        : File;
  return (
    <Icon
      size={size}
      className={item.folder ? "files-folder-icon" : "files-file-icon"}
    />
  );
}
export default function FilesPage({ settings, onBack, active = true }) {
  const { user } = useStore(),
    { t } = useTranslation();
  const locale = settings.language === "en" ? "en-GB" : "de-DE";
  const [sources, setSources] = useState([
    { id: "local", kind: "local", name: "files.private", trash: true },
  ]);
  const [sourceId, setSourceId] = useState("local"),
    [parent, setParent] = useState("root"),
    [trash, setTrash] = useState(false);
  const [items, setItems] = useState([]),
    [breadcrumbs, setBreadcrumbs] = useState([]),
    [next, setNext] = useState(null);
  const [query, setQuery] = useState(""),
    [search, setSearch] = useState(""),
    [view, setView] = useState("list"),
    [sort, setSort] = useState("name");
  const [loading, setLoading] = useState(true),
    [working, setWorking] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [selected, setSelected] = useState(new Set()),
    [modal, setModal] = useState(null),
    [refresh, setRefresh] = useState(0);
  const [config, setConfig] = useState({
    maxFileSize: 1024 ** 3,
    chunkSize: 10 * 1024 ** 2,
    quota: 5 * 1024 ** 3,
  });
  const [used, setUsed] = useState(0),
    [queue, setQueue] = useState([]),
    [uploading, setUploading] = useState(false),
    [dragging, setDragging] = useState(false);
  const [pickerParent, setPickerParent] = useState("root"),
    [pickerItems, setPickerItems] = useState([]),
    [pickerCrumbs, setPickerCrumbs] = useState([]),
    [pickerLoading, setPickerLoading] = useState(false);
  const [preview, setPreview] = useState(null);
  const [officePreview, setOfficePreview] = useState(null);
  const [recoveries, setRecoveries] = useState([]);
  const anchor = useRef(null),
    fileInput = useRef(null),
    folderInput = useRef(null),
    uploadController = useRef(null),
    dragDepth = useRef(0),
    sequence = useRef(0),
    queueLock = useRef(false),
    previewSequence = useRef(0);
  const source = sources.find((s) => s.id === sourceId) || sources[0];
  const busy = working || uploading;
  const path = "/files/sources/" + sourceId;
  const chosen = items.filter((item) => selected.has(item.id));
  const one = chosen.length === 1 ? chosen[0] : null;
  const rows = useMemo(
    () =>
      [...items].sort(
        (a, b) =>
          Number(b.folder) - Number(a.folder) ||
          (sort === "size"
            ? b.size - a.size
            : sort === "date"
              ? b.modifiedAt - a.modifiedAt
              : a.name.localeCompare(b.name, locale, { numeric: true })),
      ),
    [items, sort, locale],
  );
  const label = (s) => (s.kind === "local" ? t("files.private") : s.name);
  const showError = (e) => setError(e.message || "files.errors.remote");
  const readSources = useCallback(async () => {
    if (user.demo) return;
    const result = await api("/files/sources");
    setSources(result.sources);
  }, [user.demo]);
  useEffect(() => {
    readSources().catch(showError);
    if (!user.demo) api("/files/config").then(setConfig).catch(showError);
    const params = new URLSearchParams(location.search);
    if (params.has("filesConnected")) {
      setNotice("files.connected");
      setSourceId(params.get("filesConnected"));
    }
    if (params.has("filesError"))
      setError(
        "files.errors." +
          (params.get("filesError") === "denied" ? "denied" : "connect"),
      );
  }, [readSources, user.demo]);
  useEffect(() => {
    if (!active || user.demo) return;
    let stopped = false;
    api("/office/recoveries")
      .then((result) => {
        if (!stopped) setRecoveries(result.items);
      })
      .catch(() => {});
    return () => {
      stopped = true;
    };
  }, [active, user.demo, refresh, officePreview]);
  async function keepRecovery(id) {
    setWorking(true);
    try {
      const saved = await post("/office/sessions/" + id + "/keep", {
        language: settings.language,
      });
      setRecoveries((rows) => rows.filter((r) => r.id !== id));
      setNotice("office.recoveryKept");
      setSourceId("local");
      setTrash(false);
      setParent(saved.folderId);
      setRefresh((v) => v + 1);
    } catch (e) {
      showError(e);
    } finally {
      setWorking(false);
    }
  }
  useEffect(() => {
    const timer = setTimeout(() => setSearch(query), 250);
    return () => clearTimeout(timer);
  }, [query]);
  useEffect(() => {
    setSelected(new Set());
    anchor.current = null;
  }, [sourceId, parent, trash, search]);
  useEffect(() => () => uploadController.current?.abort(), []);
  useEffect(() => {
    return () => {
      if (preview?.url) URL.revokeObjectURL(preview.url);
    };
  }, [preview]);
  const load = useCallback(
    async (cursor = "", append = false) => {
      const current = ++sequence.current;
      setLoading(true);
      try {
        const result = user.demo
          ? {
              items: demoFiles.list(parent, trash, search),
              breadcrumbs: trash ? [] : demoFiles.ancestors(parent),
              next: null,
              used: demoFiles.nodes.reduce(
                (sum, n) => sum + (n.folder ? 0 : n.size),
                0,
              ),
            }
          : await api(
              path +
                "/items?" +
                new URLSearchParams({
                  parent,
                  trash: trash ? "1" : "0",
                  q: search,
                  cursor,
                }),
            );
        if (current !== sequence.current) return;
        setItems((old) =>
          append
            ? [
                ...old,
                ...result.items.filter((n) => !old.some((o) => o.id === n.id)),
              ]
            : result.items,
        );
        setBreadcrumbs(result.breadcrumbs);
        setNext(result.next);
        setUsed(result.used || 0);
      } catch (e) {
        if (current === sequence.current) showError(e);
      } finally {
        if (current === sequence.current) setLoading(false);
      }
    },
    [parent, trash, search, path, user.demo],
  );
  useEffect(() => {
    if (active) {
      void load();
      return () => {
        sequence.current++;
      };
    }
  }, [load, refresh, active]);
  function openFolder(id) {
    setParent(id);
    setTrash(false);
    setQuery("");
    setSearch("");
    setError("");
  }
  function chooseSource(s) {
    setSourceId(s.id);
    setParent("root");
    setTrash(false);
    setQuery("");
    setSearch("");
    setItems([]);
    setError("");
  }
  function select(item, event, checkbox = false) {
    if (event.shiftKey)
      setSelected((old) =>
        fileSelection(
          rows,
          old,
          anchor.current,
          item.id,
          event.ctrlKey || event.metaKey,
        ),
      );
    else if (checkbox || event.ctrlKey || event.metaKey)
      setSelected((old) => {
        const next = new Set(old);
        if (next.has(item.id)) next.delete(item.id);
        else next.add(item.id);
        return next;
      });
    else setSelected(new Set([item.id]));
    if (!event.shiftKey) anchor.current = item.id;
  }
  async function action(fn, message = "files.saved") {
    setWorking(true);
    setError("");
    try {
      await fn();
      setRefresh((v) => v + 1);
      setSelected(new Set());
      if (message) setNotice(message);
      return true;
    } catch (e) {
      showError(e);
      return false;
    } finally {
      setWorking(false);
    }
  }
  async function submitName(event) {
    event.preventDefault();
    const success = await action(async () => {
      uploadPath(modal.name);
      if (modal.mode === "folder") {
        if (user.demo) demoFiles.mkdir(parent, modal.name);
        else
          await post(path + "/folders", { parentId: parent, path: modal.name });
      } else if (user.demo)
        demoFiles.change(modal.item.id, { name: modal.name });
      else
        await post(
          path + "/items/" + encodeURIComponent(modal.item.id),
          { name: modal.name },
          "PATCH",
        );
    });
    if (success) setModal(null);
  }
  async function bulk(mode) {
    const entries = modal?.items || chosen;
    let succeeded = 0,
      failure;
    await action(async () => {
      for (const entry of entries)
        try {
          if (user.demo) {
            if (mode === "move")
              demoFiles.change(entry.id, { parentId: pickerParent });
            else demoFiles[mode](entry.id);
          } else
            await post(
              path +
                "/items/" +
                encodeURIComponent(entry.id) +
                (mode === "move" || mode === "purge" ? "" : "/" + mode),
              mode === "move" ? { parentId: pickerParent } : { confirm: true },
              mode === "move" ? "PATCH" : mode === "purge" ? "DELETE" : "POST",
            );
          succeeded++;
        } catch (e) {
          failure = e;
        }
      setModal(null);
      setSelected(new Set());
      setRefresh((v) => v + 1);
      if (failure)
        throw new Error(
          t("files.partial", { count: succeeded, total: entries.length }) +
            " " +
            t(failure.message),
        );
    }, "files.saved");
  }
  useEffect(() => {
    if (modal?.mode !== "move") return;
    let cancelled = false;
    setPickerLoading(true);
    (async () => {
      const collected = [];
      let cursor = "",
        result;
      do {
        result = user.demo
          ? {
              items: demoFiles
                .list(pickerParent, false)
                .filter((n) => n.folder),
              breadcrumbs: demoFiles.ancestors(pickerParent),
              next: null,
            }
          : await api(
              path +
                "/items?" +
                new URLSearchParams({
                  parent: pickerParent,
                  folders: "1",
                  cursor,
                }),
            );
        collected.push(...result.items);
        cursor = result.next || "";
      } while (cursor && collected.length < 10000 && !cancelled);
      if (!cancelled) {
        setPickerItems(
          collected.filter((n) => !modal.items.some((s) => s.id === n.id)),
        );
        setPickerCrumbs(result.breadcrumbs);
      }
    })()
      .catch((e) => {
        if (!cancelled) showError(e);
      })
      .finally(() => {
        if (!cancelled) setPickerLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [modal?.mode, pickerParent, path, user.demo]);
  async function download(item, bubble = false) {
    try {
      if (user.demo) {
        const blob = demoFiles.blobs.get(item.id);
        if (!blob) throw new Error("files.errors.preview");
        saveBlob(blob, item.name);
        return;
      }
      const result = await post(
        path + "/items/" + encodeURIComponent(item.id) + "/download",
        {},
      );
      const link = document.createElement("a");
      link.href = result.url;
      link.download = item.name;
      link.rel = "noreferrer";
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (e) {
      if (bubble) throw e;
      showError(e);
    }
  }
  async function openItem(item) {
    if (item.folder) {
      if (!trash) openFolder(item.id);
      return;
    }
    setSelected(new Set([item.id]));
    const requestId = ++previewSequence.current;
    if (!trash && officeFile(item)) {
      setPreview(null);
      setOfficePreview({ item, source: sourceId });
      return;
    }
    const image = /^image\/(png|jpeg|gif|webp|avif|bmp)$/.test(item.mime || ""),
      text =
        /^(text\/|application\/(json|xml))/.test(item.mime || "") ||
        /\.(txt|md|csv|json|log|xml)$/i.test(item.name);
    setPreview({ item, loading: image || text });
    if ((!image && !text) || item.size > 10 * 1024 ** 2 || trash) {
      setPreview({ item, unsupported: true });
      return;
    }
    try {
      let blob;
      if (user.demo) blob = demoFiles.blobs.get(item.id);
      else {
        const res = await fetch(
          "/api" +
            path +
            "/items/" +
            encodeURIComponent(item.id) +
            "/content?preview=1",
          { headers: { Authorization: "Bearer " + user.token } },
        );
        if (!res.ok)
          throw new Error((await res.json()).error || "files.errors.preview");
        blob = await res.blob();
      }
      if (!blob || blob.size > 10 * 1024 ** 2)
        throw new Error("files.errors.preview");
      if (requestId !== previewSequence.current) return;
      const previewText = image ? undefined : await blob.text();
      if (requestId !== previewSequence.current) return;
      setPreview(
        image
          ? { item, url: URL.createObjectURL(blob) }
          : { item, text: previewText },
      );
    } catch (e) {
      if (requestId === previewSequence.current)
        setPreview({ item, error: e.message });
    }
  }
  async function addUploads(batch) {
    if (queueLock.current || trash) {
      setError("files.errors.busy");
      return;
    }
    if (batch.files.length + batch.directories.length > 10000) {
      setError("files.errors.depth");
      return;
    }
    queueLock.current = true;
    setUploading(true);
    setError("");
    const controller = new AbortController();
    uploadController.current = controller;
    const targetPath = path,
      targetSource = sourceId,
      targetParent = parent;
    const entries = batch.files.map(({ file, path }) => ({
      id: crypto.randomUUID(),
      name: path,
      size: file.size,
      state: "queued",
      progress: 0,
    }));
    setQueue(entries);
    const folders = new Map([["", targetParent]]);
    const update = (id, values) =>
      setQueue((old) =>
        old.map((r) => (r.id === id ? { ...r, ...values } : r)),
      );
    const ensureFolder = async (relative) => {
      if (folders.has(relative)) return folders.get(relative);
      uploadPath(relative);
      const result = user.demo
        ? demoFiles.mkdir(targetParent, relative)
        : await post(targetPath + "/folders", {
            parentId: targetParent,
            path: relative,
          });
      folders.set(relative, result.id);
      return result.id;
    };
    try {
      for (const directory of batch.directories) {
        if (controller.signal.aborted) break;
        await ensureFolder(directory);
      }
      for (let i = 0; i < batch.files.length; i++) {
        const { file, path: relative } = batch.files[i],
          entry = entries[i];
        let uploadId,
          committing = false;
        if (controller.signal.aborted) {
          update(entry.id, { state: "cancelled" });
          continue;
        }
        try {
          update(entry.id, { state: "uploading" });
          if (file.size > config.maxFileSize)
            throw new Error("files.errors.size");
          const segments = uploadPath(relative);
          segments.pop();
          const parentId = await ensureFolder(segments.join("/"));
          if (user.demo) {
            demoFiles.upload(parentId, file);
            update(entry.id, { state: "completed", progress: 100 });
            continue;
          }
          const started = await post(targetPath + "/uploads", {
            parentId,
            name: file.name,
            size: file.size,
            mime: file.type || "application/octet-stream",
          });
          uploadId = started.id;
          let received = 0,
            chunk = 0;
          while (received < file.size) {
            const bytes = file.slice(received, received + started.chunkSize);
            await uploadChunk(
              "/files/uploads/" + uploadId + "/chunks/" + chunk++,
              bytes,
              user.token,
              controller.signal,
              (loaded) =>
                update(entry.id, {
                  progress: Math.round(
                    ((received + loaded) / Math.max(1, file.size)) * 100,
                  ),
                }),
            );
            received += bytes.size;
          }
          if (controller.signal.aborted)
            throw new DOMException("Aborted", "AbortError");
          update(entry.id, { state: "processing", progress: 0 });
          committing = true;
          await post("/files/uploads/" + uploadId + "/commit", {});
          while (true) {
            const result = await api("/files/uploads/" + uploadId);
            if (result.state === "failed")
              throw new Error(result.error || "files.errors.upload");
            if (result.state === "completed") break;
            update(entry.id, { progress: result.progress });
            await new Promise((resolve) => setTimeout(resolve, 750));
          }
          update(entry.id, { state: "completed", progress: 100 });
          await post("/files/uploads/" + uploadId, {}, "DELETE");
        } catch (e) {
          if (uploadId && !committing)
            await post("/files/uploads/" + uploadId, {}, "DELETE").catch(
              () => {},
            );
          update(entry.id, {
            state: e.name === "AbortError" ? "cancelled" : "failed",
            error: e.name === "AbortError" ? "" : e.message,
          });
        }
      }
      if (batch.directories.length && !batch.files.length)
        setNotice("files.saved");
    } catch (e) {
      showError(e);
    } finally {
      queueLock.current = false;
      setUploading(false);
      uploadController.current = null;
      if (targetSource === sourceId) setRefresh((v) => v + 1);
    }
  }
  const formatDate = (value) =>
    value
      ? new Intl.DateTimeFormat(locale, {
          dateStyle: "medium",
          timeStyle: "short",
          timeZone: settings.timezone || "Europe/Berlin",
        }).format(value)
      : "–";
  const crumbButtons = (crumbs, open) => (
    <>
      <button onClick={() => open("root")}>{label(source)}</button>
      {crumbs.map((c) => (
        <span key={c.id}>
          <ChevronRight size={14} />
          <button onClick={() => open(c.id)}>{c.name}</button>
        </span>
      ))}
    </>
  );
  return (
    <WorkspacePage
      className="files-page"
      title={t("files.title")}
      onBack={onBack}
      headerActions={
        <div className="files-toolbar">
          {!trash && (
            <>
              <button
                className="primary"
                disabled={busy}
                onClick={() => fileInput.current.click()}
              >
                <Upload size={17} />
                {t("files.upload")}
              </button>
              <button
                className="secondary"
                disabled={busy}
                onClick={() => folderInput.current.click()}
              >
                <FolderUp size={17} />
                {t("files.uploadFolder")}
              </button>
              <button
                className="secondary"
                disabled={busy}
                onClick={() => {
                  setError("");
                  setModal({ mode: "folder", name: "" });
                }}
              >
                <FolderPlus size={17} />
                {t("files.newFolder")}
              </button>
            </>
          )}
          <input
            ref={fileInput}
            className="files-input"
            type="file"
            multiple
            onChange={(e) => {
              const files = [...e.target.files].map((file) => ({
                file,
                path: file.name,
              }));
              e.target.value = "";
              void addUploads({ files, directories: [] });
            }}
          />
          <input
            ref={folderInput}
            className="files-input"
            type="file"
            multiple
            webkitdirectory=""
            directory=""
            onChange={(e) => {
              const files = [...e.target.files].map((file) => ({
                file,
                path: file.webkitRelativePath || file.name,
              }));
              e.target.value = "";
              void addUploads({ files, directories: [] });
            }}
          />
          <button
            className="icon-button"
            disabled={loading}
            aria-label={t("refresh")}
            title={t("refresh")}
            onClick={() => setRefresh((v) => v + 1)}
          >
            <RefreshCw size={18} className={loading ? "spinner" : ""} />
          </button>
          <div className="files-search">
            <Search size={17} />
            <input
              aria-label={t("files.search")}
              placeholder={t("files.search")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="calendar-view-switch">
            <button
              className={view === "list" ? "active" : ""}
              aria-label={t("files.list")}
              aria-pressed={view === "list"}
              onClick={() => setView("list")}
            >
              <List size={17} />
            </button>
            <button
              className={view === "grid" ? "active" : ""}
              aria-label={t("files.grid")}
              aria-pressed={view === "grid"}
              onClick={() => setView("grid")}
            >
              <LayoutGrid size={17} />
            </button>
          </div>
        </div>
      }
    >
      {!!recoveries.length && (
        <div className="office-recovery-banner" role="status">
          <strong>
            {t("office.recoveryAvailable", { count: recoveries.length })}
          </strong>
          {recoveries.map((r) => (
            <div key={r.id}>
              <span>{r.name}</span>
              <button
                className="secondary"
                disabled={working}
                onClick={() => void keepRecovery(r.id)}
              >
                {t("office.keepRecovery")}
              </button>
            </div>
          ))}
        </div>
      )}
      {error && !modal && (
        <div className="notice error" role="alert">
          {t(error)}
          <button
            className="icon-button"
            aria-label={t("close")}
            onClick={() => setError("")}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {notice && (
        <div className="notice" role="status">
          <Check size={16} />
          {t(notice)}
          <button
            className="icon-button"
            aria-label={t("close")}
            onClick={() => setNotice("")}
          >
            <X size={16} />
          </button>
        </div>
      )}
      <div className="files-body">
        <aside className="files-sidebar">
          <span className="eyebrow">{t("files.storages")}</span>
          <div className="files-sources">
            {sources.map((s) => (
              <button
                key={s.id}
                className={sourceId === s.id && !trash ? "active" : ""}
                onClick={() => chooseSource(s)}
              >
                {s.kind === "local" ? (
                  <HardDrive size={19} />
                ) : (
                  <Cloud size={19} />
                )}
                <span>
                  {label(s)}
                  <small>{t("files.kind_" + s.kind)}</small>
                </span>
              </button>
            ))}
          </div>
          <button
            className="text-button"
            disabled={busy}
            onClick={() => {
              setError("");
              setModal({ mode: "connect" });
            }}
          >
            <PlusIcon />
            {t("files.connectCloud")}
          </button>
          {source.trash ? (
            <button
              className={"files-trash-button " + (trash ? "active" : "")}
              onClick={() => {
                setTrash(true);
                setParent("root");
                setQuery("");
                setSearch("");
              }}
            >
              <Trash2 size={18} />
              {t("files.trash")}
            </button>
          ) : (
            <a
              className="files-trash-link"
              href="https://onedrive.live.com/"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Trash2 size={16} />
              {t("files.providerTrash")}
            </a>
          )}
          {source.kind !== "local" && (
            <button
              className="text-button danger"
              disabled={busy}
              onClick={() => {
                setError("");
                setModal({ mode: "disconnect" });
              }}
            >
              <Link size={15} />
              {t("files.disconnect")}
            </button>
          )}
          <div className="files-storage-note">
            <Lock size={16} />
            <strong>{t("files.privateHint")}</strong>
            <p>{t(user.demo ? "files.demoHint" : "files.encryptedHint")}</p>
            {source.kind === "local" && (
              <>
                <div className="files-quota">
                  <span
                    style={{
                      width: Math.min(100, (used / config.quota) * 100) + "%",
                    }}
                  />
                </div>
                <small>
                  {t("files.quota", {
                    used: fileSize(used, locale),
                    total: fileSize(config.quota, locale),
                  })}
                </small>
              </>
            )}
          </div>
        </aside>
        <section
          className="files-main"
          aria-busy={loading}
          onDragEnter={(e) => {
            if (e.dataTransfer.types.includes("Files")) {
              e.preventDefault();
              dragDepth.current++;
              setDragging(true);
            }
          }}
          onDragLeave={() => {
            dragDepth.current--;
            if (dragDepth.current <= 0) setDragging(false);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = trash || uploading ? "none" : "copy";
          }}
          onDrop={async (e) => {
            e.preventDefault();
            dragDepth.current = 0;
            setDragging(false);
            try {
              const batch = await droppedFiles(e.dataTransfer);
              await addUploads(batch);
            } catch (err) {
              showError(err);
            }
          }}
        >
          <div className="files-breadcrumbs">
            {trash ? (
              <>
                <Trash2 size={16} />
                {t("files.trash")}
                <small>{label(source)}</small>
              </>
            ) : (
              crumbButtons(breadcrumbs, openFolder)
            )}
          </div>
          <div className="files-selection-bar">
            <label>
              <input
                type="checkbox"
                aria-label={t("files.selectAll")}
                checked={!!rows.length && rows.every((r) => selected.has(r.id))}
                onChange={(e) =>
                  setSelected(
                    e.target.checked
                      ? new Set(rows.map((r) => r.id))
                      : new Set(),
                  )
                }
              />
              {selected.size
                ? t("files.selected", { count: selected.size })
                : t("files.entries", { count: items.length })}
            </label>
            <div className="files-selection-actions">
              {trash ? (
                <>
                  <button
                    className="text-button"
                    disabled={busy || !chosen.length}
                    onClick={() => void bulk("restore")}
                  >
                    <RotateCcw size={16} />
                    {t("files.restore")}
                  </button>
                  {source.kind === "local" && (
                    <button
                      className="text-button danger"
                      disabled={busy || !chosen.length}
                      onClick={() => {
                        setError("");
                        setModal({ mode: "purge", items: chosen });
                      }}
                    >
                      <Trash2 size={16} />
                      {t("files.purge")}
                    </button>
                  )}
                </>
              ) : (
                <>
                  <button
                    className="text-button"
                    disabled={
                      busy || !one || one.folder || one.downloadable === false
                    }
                    onClick={() => void download(one)}
                  >
                    <Download size={16} />
                    {t("files.download")}
                  </button>
                  <button
                    className="text-button"
                    disabled={busy || !one || one.readOnly}
                    onClick={() => {
                      setError("");
                      setModal({ mode: "rename", item: one, name: one.name });
                    }}
                  >
                    <Pencil size={16} />
                    {t("files.rename")}
                  </button>
                  <button
                    className="text-button"
                    disabled={
                      busy || !chosen.length || chosen.some((i) => i.readOnly)
                    }
                    onClick={() => {
                      setError("");
                      setPickerParent("root");
                      setModal({ mode: "move", items: chosen });
                    }}
                  >
                    <FolderInput size={16} />
                    {t("files.move")}
                  </button>
                  <button
                    className="text-button danger"
                    disabled={
                      busy || !chosen.length || chosen.some((i) => i.readOnly)
                    }
                    onClick={() => {
                      setError("");
                      setModal({ mode: "trash", items: chosen });
                    }}
                  >
                    <Trash2 size={16} />
                    {t("delete")}
                  </button>
                </>
              )}
            </div>
          </div>
          <div className={"files-content " + (one ? "with-details" : "")}>
            <div className="files-browser">
              {view === "list" && !!rows.length && (
                <div className="files-columns">
                  <span />
                  <button onClick={() => setSort("name")}>
                    {t("files.name")}
                  </button>
                  <button onClick={() => setSort("date")}>
                    {t("files.modified")}
                  </button>
                  <button onClick={() => setSort("size")}>
                    {t("files.size")}
                  </button>
                </div>
              )}
              <div
                className={view === "grid" ? "files-grid" : "files-list"}
                role="grid"
                aria-label={t("files.title")}
              >
                {rows.map((item) => (
                  <div
                    key={item.id}
                    role="row"
                    tabIndex={0}
                    aria-selected={selected.has(item.id)}
                    className={
                      "files-row " + (selected.has(item.id) ? "selected" : "")
                    }
                    onClick={(e) => select(item, e)}
                    onDoubleClick={() => void openItem(item)}
                    onKeyDown={(e) => {
                      if (e.target !== e.currentTarget) return;
                      if (e.key === "Enter") void openItem(item);
                      if (e.key === " ") {
                        e.preventDefault();
                        select(item, e, true);
                      }
                    }}
                  >
                    <input
                      type="checkbox"
                      aria-label={t("files.select", { name: item.name })}
                      checked={selected.has(item.id)}
                      onClick={(e) => {
                        e.stopPropagation();
                        select(item, e, true);
                      }}
                      onChange={() => {}}
                    />
                    <button
                      className="files-item-name"
                      onClick={(e) => {
                        e.stopPropagation();
                        void openItem(item);
                      }}
                      title={item.name}
                    >
                      <ItemIcon item={item} size={view === "grid" ? 38 : 22} />
                      <span>{item.name}</span>
                      {item.readOnly && <Lock size={13} />}
                    </button>
                    <span className="files-date">
                      {formatDate(item.modifiedAt)}
                    </span>
                    <span className="files-size">
                      {item.folder
                        ? t("files.folder")
                        : item.native
                          ? t("files.cloudDocument")
                          : fileSize(item.size, locale)}
                    </span>
                  </div>
                ))}
              </div>
              {!rows.length && (
                <div className="files-empty">
                  <span>
                    <Folder size={44} strokeWidth={1.3} />
                  </span>
                  <h2>
                    {t(
                      loading
                        ? "loading"
                        : trash
                          ? "files.emptyTrash"
                          : search
                            ? "files.noResults"
                            : "files.empty",
                    )}
                  </h2>
                  <p>{t(trash ? "files.emptyTrashHint" : "files.dropHint")}</p>
                  {!trash && !search && (
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() => fileInput.current.click()}
                    >
                      <Upload size={17} />
                      {t("files.upload")}
                    </button>
                  )}
                </div>
              )}
              {next && (
                <button
                  className="secondary files-load-more"
                  disabled={loading}
                  onClick={() => void load(next, true)}
                >
                  {t("files.loadMore")}
                </button>
              )}
            </div>
            {one && (
              <aside className="files-details">
                <button
                  className="icon-button files-details-close"
                  aria-label={t("close")}
                  onClick={() => setSelected(new Set())}
                >
                  <X size={17} />
                </button>
                <div className="files-details-icon">
                  <ItemIcon item={one} size={44} />
                </div>
                <h3>{one.name}</h3>
                <span className="eyebrow">{t("files.details")}</span>
                <dl>
                  <dt>{t("files.storage")}</dt>
                  <dd>{label(source)}</dd>
                  <dt>{t("files.type")}</dt>
                  <dd>
                    {one.folder
                      ? t("files.folder")
                      : one.mime || t("files.file")}
                  </dd>
                  <dt>{t("files.size")}</dt>
                  <dd>{one.folder ? "–" : fileSize(one.size, locale)}</dd>
                  <dt>{t("files.modified")}</dt>
                  <dd>{formatDate(one.modifiedAt)}</dd>
                </dl>
                {!trash && (
                  <button
                    className="secondary"
                    onClick={() => void openItem(one)}
                  >
                    {one.folder ? <Folder size={16} /> : <Eye size={16} />}
                    {t(one.folder ? "files.openFolder" : "files.preview")}
                  </button>
                )}
                {one.webUrl && (
                  <a
                    className="text-button"
                    href={one.webUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <ExternalLink size={15} />
                    {t("files.openProvider")}
                  </a>
                )}
              </aside>
            )}
          </div>
          {!!queue.length && (
            <div className="files-upload-panel">
              <header>
                <strong>{t("files.uploads")}</strong>
                {uploading ? (
                  <button
                    className="text-button"
                    onClick={() => uploadController.current?.abort()}
                  >
                    {t("files.cancelUploads")}
                  </button>
                ) : (
                  <button
                    className="icon-button"
                    aria-label={t("close")}
                    onClick={() => setQueue([])}
                  >
                    <X size={16} />
                  </button>
                )}
              </header>
              <div>
                {queue.map((entry) => (
                  <div className="files-upload-row" key={entry.id}>
                    {entry.state === "completed" ? (
                      <Check size={16} />
                    ) : entry.state === "failed" ||
                      entry.state === "cancelled" ? (
                      <X size={16} />
                    ) : (
                      <LoaderCircle size={16} className="spinner" />
                    )}
                    <span>
                      <strong>{entry.name}</strong>
                      <small>
                        {entry.error
                          ? t(entry.error)
                          : t("files.upload_" + entry.state)}
                        {entry.state === "processing" && source.kind !== "local"
                          ? " · " + entry.progress + "%"
                          : ""}
                      </small>
                    </span>
                    <progress
                      aria-label={entry.name}
                      max={100}
                      value={entry.progress}
                    />
                    <small>{fileSize(entry.size, locale)}</small>
                  </div>
                ))}
              </div>
              <p className="files-upload-hint">{t("files.cancelHint")}</p>
            </div>
          )}
          {dragging && (
            <div className="files-drop-overlay">
              <Upload size={42} />
              <h2>{t("files.dropHere")}</h2>
              <p>
                {label(source)} · {breadcrumbs.at(-1)?.name || t("files.root")}
              </p>
            </div>
          )}
        </section>
      </div>
      {modal && (
        <Dialog
          title={t("files.modal_" + modal.mode)}
          onClose={() => {
            if (!working) {
              setModal(null);
              setError("");
            }
          }}
        >
          <div className="files-modal">
            {error && (
              <p className="notice error" role="alert">
                {t(error)}
              </p>
            )}
            {["folder", "rename"].includes(modal.mode) && (
              <form onSubmit={submitName}>
                <label>
                  {t("files.name")}
                  <input
                    autoFocus
                    required
                    maxLength={180}
                    value={modal.name}
                    onChange={(e) =>
                      setModal({ ...modal, name: e.target.value })
                    }
                  />
                </label>
                <div className="files-modal-actions">
                  <button
                    className="secondary"
                    type="button"
                    disabled={working}
                    onClick={() => setModal(null)}
                  >
                    {t("cancel")}
                  </button>
                  <button className="primary" disabled={working}>
                    {t("save")}
                  </button>
                </div>
              </form>
            )}
            {["trash", "purge"].includes(modal.mode) && (
              <>
                <p>
                  {t(
                    modal.mode === "purge"
                      ? "files.confirmPurge"
                      : "files.confirmTrash",
                    { count: modal.items.length },
                  )}
                </p>
                <ul className="files-confirm-list">
                  {modal.items.map((item) => (
                    <li key={item.id}>{item.name}</li>
                  ))}
                </ul>
                <div className="files-modal-actions">
                  <button
                    className="secondary"
                    disabled={working}
                    onClick={() => setModal(null)}
                  >
                    {t("cancel")}
                  </button>
                  <button
                    className="primary"
                    disabled={working}
                    onClick={() => void bulk(modal.mode)}
                  >
                    {t(modal.mode === "purge" ? "files.purge" : "delete")}
                  </button>
                </div>
              </>
            )}
            {modal.mode === "move" && (
              <>
                <p>{t("files.moveHint", { count: modal.items.length })}</p>
                <div className="files-breadcrumbs">
                  {crumbButtons(pickerCrumbs, setPickerParent)}
                </div>
                <div className="files-folder-picker">
                  {pickerLoading ? (
                    <LoaderCircle className="spinner" />
                  ) : (
                    pickerItems.map((item) => (
                      <button
                        key={item.id}
                        onClick={() => setPickerParent(item.id)}
                      >
                        <Folder size={19} />
                        {item.name}
                        <ChevronRight size={16} />
                      </button>
                    ))
                  )}
                </div>
                <div className="files-modal-actions">
                  <button
                    className="secondary"
                    disabled={working}
                    onClick={() => setModal(null)}
                  >
                    {t("cancel")}
                  </button>
                  <button
                    className="primary"
                    disabled={working || pickerLoading}
                    onClick={() => void bulk("move")}
                  >
                    {t("files.moveHere")}
                  </button>
                </div>
              </>
            )}
            {modal.mode === "connect" && (
              <>
                <p className="muted">{t("files.connectHint")}</p>
                <div className="files-cloud-choices">
                  {["google", "microsoft"].map((provider) => (
                    <button
                      key={provider}
                      className="secondary"
                      onClick={() => setModal({ mode: "oauth", provider })}
                    >
                      <Cloud size={24} />
                      <strong>{t("files.kind_" + provider)}</strong>
                      <span>{t("files.connect")}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
            {modal.mode === "oauth" && (
              <div className="calendar-editor files-oauth">
                <CalendarOAuthSetup
                  purpose="files"
                  provider={modal.provider}
                  setup={config.oauthSetup?.[modal.provider]}
                  demo={user.demo}
                  onSaved={(result) =>
                    setConfig((old) => ({ ...old, ...result }))
                  }
                  onBack={() => setModal({ mode: "connect" })}
                />
              </div>
            )}
            {modal.mode === "disconnect" && (
              <>
                <p>{t("files.disconnectHint", { name: label(source) })}</p>
                <div className="files-modal-actions">
                  <button
                    className="secondary"
                    disabled={working}
                    onClick={() => setModal(null)}
                  >
                    {t("cancel")}
                  </button>
                  <button
                    className="primary"
                    disabled={working}
                    onClick={() =>
                      void action(async () => {
                        await post(path, { confirm: true }, "DELETE");
                        await readSources();
                        chooseSource(sources[0]);
                        setModal(null);
                      })
                    }
                  >
                    {t("files.disconnect")}
                  </button>
                </div>
              </>
            )}
          </div>
        </Dialog>
      )}
      {officePreview && (
        <OfficePreview
          key={officePreview.source + ":" + officePreview.item.id}
          item={officePreview.item}
          source={officePreview.source}
          onDownload={() => download(officePreview.item, true)}
          onClose={() => setOfficePreview(null)}
          onChanged={() => setRefresh((v) => v + 1)}
        />
      )}
      {preview && (
        <Dialog
          wide
          title={preview.item.name}
          onClose={() => {
            previewSequence.current++;
            setPreview(null);
          }}
        >
          <div className="files-preview">
            {preview.loading ? (
              <LoaderCircle className="spinner" />
            ) : preview.url ? (
              <img src={preview.url} alt={preview.item.name} />
            ) : preview.text !== undefined ? (
              <pre>{preview.text}</pre>
            ) : (
              <>
                <ItemIcon item={preview.item} size={48} />
                <p>{t(preview.error || "files.previewHint")}</p>
              </>
            )}
          </div>
          <footer className="dialog-footer">
            <button
              className="secondary"
              onClick={() => {
                previewSequence.current++;
                setPreview(null);
              }}
            >
              {t("close")}
            </button>
            {!trash && (
              <button
                className="primary"
                onClick={() => void download(preview.item)}
              >
                <Download size={17} />
                {t("files.download")}
              </button>
            )}
          </footer>
        </Dialog>
      )}
    </WorkspacePage>
  );
}
function PlusIcon() {
  return <FolderPlus size={17} />;
}
