import { useState } from "react";
import { useTranslation } from "react-i18next";
import { FolderPlus, Trash2, LoaderCircle } from "lucide-react";
import Dialog from "./Dialog";
import { post } from "../api";
export default function FolderManager({
  mode,
  target,
  folders,
  selected,
  demo,
  onClose,
  onCreated,
  onDeleted,
}) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [parent, setParent] = useState(
    folders.some((f) => f.path === selected) ? selected : "",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const children = target
    ? folders.filter(
        (f) =>
          f.path === target.path ||
          f.path.startsWith(target.path + target.delimiter),
      )
    : [];
  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (mode === "create") {
        const delimiter =
          folders.find((f) => f.path === parent)?.delimiter || "/";
        if (!name.trim() || name.includes(delimiter))
          throw new Error("folderNameInvalid");
        const path = parent
          ? `${parent}${delimiter}${name.trim()}`
          : name.trim();
        if (folders.some((f) => f.path === path))
          throw new Error("folderExists");
        const created = demo
          ? {
              path,
              name: name.trim(),
              delimiter,
              selectable: true,
              unseen: 0,
              total: 0,
            }
          : await post("/folders", { name: name.trim(), parent });
        onCreated(created);
      } else {
        const result = demo
          ? { deleted: children.map((f) => f.path) }
          : await post(
              "/folders",
              { path: target.path, confirm: true },
              "DELETE",
            );
        onDeleted(result);
      }
      onClose();
    } catch (e) {
      setError(t(e.message));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      title={t(mode === "create" ? "newFolder" : "deleteFolder")}
      onClose={onClose}
    >
      <form className="simple-form" onSubmit={submit}>
        {mode === "create" ? (
          <>
            <label>
              {t("parentFolder")}
              <select
                value={parent}
                onChange={(e) => setParent(e.target.value)}
              >
                <option value="">{t("topLevel")}</option>
                {folders.map((f) => (
                  <option key={f.path} value={f.path}>
                    {f.path}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t("folderName")}
              <input
                required
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="z. B. 10"
              />
            </label>
          </>
        ) : (
          <>
            <div className="delete-warning">
              <Trash2 size={28} />
              <strong>{target.path}</strong>
            </div>
            <p>{t("folderDeleteWarning", { count: children.length })}</p>
          </>
        )}
        {error && (
          <div className="notice error" role="alert">
            {error}
          </div>
        )}
        <footer className="dialog-footer">
          <button
            className="secondary"
            type="button"
            onClick={onClose}
            disabled={busy}
          >
            {t("cancel")}
          </button>
          <button
            className={`primary ${mode === "delete" ? "danger" : ""}`}
            disabled={busy}
          >
            {busy ? (
              <LoaderCircle className="spinner" size={17} />
            ) : mode === "create" ? (
              <FolderPlus size={17} />
            ) : (
              <Trash2 size={17} />
            )}
            {t(mode === "create" ? "create" : "delete")}
          </button>
        </footer>
      </form>
    </Dialog>
  );
}
