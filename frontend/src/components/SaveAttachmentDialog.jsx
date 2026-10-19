import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Folder, ChevronRight, LoaderCircle } from "lucide-react";
import Dialog from "./Dialog";
import { api, post } from "../api";
import { uploadPath } from "../lib/files";

export default function SaveAttachmentDialog({
  attachment,
  onClose,
  onSaved,
  popup,
}) {
  const { t } = useTranslation();
  const [sources, setSources] = useState([]);
  const [sourceId, setSourceId] = useState("local");
  const [parent, setParent] = useState("root");
  const [folders, setFolders] = useState([]);
  const [crumbs, setCrumbs] = useState([]);
  const [cursor, setCursor] = useState("");
  const [next, setNext] = useState(null);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState(attachment.filename);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(null);
  const label = (source) =>
    source?.kind === "local" ? t("files.private") : source?.name || "";
  useEffect(() => {
    const controller = new AbortController();
    api("/files/sources", { signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted)
          setSources(data.sources.filter((source) => source.kind !== "shared"));
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [revision]);
  useEffect(() => {
    if (!sources.length) return;
    const controller = new AbortController();
    setLoading(true);
    setLoaded(false);
    setError("");
    api(
      `/files/sources/${encodeURIComponent(sourceId)}/items?${new URLSearchParams({ parent, folders: "1", cursor })}`,
      { signal: controller.signal },
    )
      .then((data) => {
        if (controller.signal.aborted) return;
        setFolders((rows) => (cursor ? [...rows, ...data.items] : data.items));
        setCrumbs(data.breadcrumbs);
        setNext(data.next);
        setLoaded(true);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [sources, sourceId, parent, cursor]);
  const open = (id) => {
    setParent(id);
    setCursor("");
    setConflict(null);
  };
  async function save(mode = "ask") {
    if (busy || !loaded || loading) return;
    try {
      if (uploadPath(name).length !== 1) throw new Error("files.errors.name");
      setBusy(true);
      setError("");
      const result = await post("/attachment/save", {
        folder: attachment.folder,
        uid: attachment.uid,
        index: attachment.index,
        source: sourceId,
        parentId: parent,
        name,
        mode,
        ...(mode === "replace" ? { conflictToken: conflict.token } : {}),
      });
      onSaved(
        result,
        [
          label(sources.find((source) => source.id === sourceId)),
          ...crumbs.map((crumb) => crumb.name),
        ]
          .filter(Boolean)
          .join(" / "),
      );
    } catch (e) {
      if (e.code === "ATTACHMENT_NAME_CONFLICT" && e.conflict) {
        setConflict(e.conflict);
        if (e.message === "attachmentSave.changed") setError(e.message);
      } else setError(e.message || "files.errors.upload");
    } finally {
      setBusy(false);
    }
  }
  const dialog = (
    <Dialog
      title={t("attachmentSave.title")}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form
        className="simple-form attachment-save-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!conflict) void save();
        }}
      >
        <p className="muted">{t("attachmentSave.hint")}</p>
        <label>
          {t("files.storage")}
          <select
            value={sourceId}
            disabled={busy || !sources.length}
            onChange={(event) => {
              setSourceId(event.target.value);
              open("root");
            }}
          >
            {sources.map((source) => (
              <option value={source.id} key={source.id}>
                {label(source)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("attachmentSave.filename")}
          <input
            value={name}
            required
            disabled={busy}
            onChange={(event) => {
              setName(event.target.value);
              setConflict(null);
            }}
          />
        </label>
        <div className="attachment-save-picker">
          <nav
            aria-label={t("attachmentSave.destination")}
            className="attachment-save-crumbs"
          >
            <button
              type="button"
              disabled={busy || loading}
              onClick={() => open("root")}
            >
              {t("files.root")}
            </button>
            {crumbs.map((crumb) => (
              <span key={crumb.id}>
                <ChevronRight size={14} />
                <button
                  type="button"
                  disabled={busy || loading}
                  onClick={() => open(crumb.id)}
                >
                  {crumb.name}
                </button>
              </span>
            ))}
          </nav>
          {loading && (
            <p role="status">
              <LoaderCircle size={16} className="spinner" /> {t("loading")}
            </p>
          )}
          {!loading && loaded && !folders.length && (
            <p className="muted">{t("attachmentSave.noFolders")}</p>
          )}
          <div className="attachment-save-folders">
            {!loading &&
              folders.map((folder) => (
                <button
                  type="button"
                  className="secondary"
                  key={folder.id}
                  disabled={busy}
                  onClick={() => open(folder.id)}
                >
                  <Folder size={18} />
                  {folder.name}
                  <ChevronRight size={16} />
                </button>
              ))}
          </div>
          {next && !loading && (
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => setCursor(next)}
            >
              {t("files.loadMore")}
            </button>
          )}
        </div>
        {error && (
          <div className="notice error" role="alert">
            {t(error)}
            {!busy && !loaded && (
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  setCursor("");
                  setRevision((value) => value + 1);
                }}
              >
                {t("retry")}
              </button>
            )}
          </div>
        )}
        {conflict && (
          <div className="attachment-save-conflict" role="alert">
            <p>{t("attachmentSave.conflict", { name: conflict.name })}</p>
            {!conflict.canReplace && (
              <p className="muted">{t("attachmentSave.copyOnly")}</p>
            )}
            <div className="attachment-save-choices">
              <button
                type="button"
                className="primary"
                disabled={busy}
                onClick={() => void save("copy")}
              >
                {t("attachmentSave.copy")}
              </button>
              {conflict.canReplace && (
                <button
                  type="button"
                  className="secondary danger-text"
                  disabled={busy}
                  onClick={() => void save("replace")}
                >
                  {t("attachmentSave.replace")}
                </button>
              )}
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => setConflict(null)}
              >
                {t("cancel")}
              </button>
            </div>
          </div>
        )}
        <footer className="dialog-footer">
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={onClose}
          >
            {t("cancel")}
          </button>
          <button
            className="primary"
            disabled={busy || loading || !loaded || !!conflict || !name.trim()}
          >
            {busy ? (
              <>
                <LoaderCircle size={16} className="spinner" />
                {t("attachmentSave.saving")}
              </>
            ) : (
              t("save")
            )}
          </button>
        </footer>
      </form>
    </Dialog>
  );
  return popup && !popup.closed
    ? createPortal(dialog, popup.document.body)
    : dialog;
}
