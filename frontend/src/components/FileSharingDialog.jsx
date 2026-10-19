import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, post } from "../api";
import Dialog from "./Dialog";

export default function FileSharingDialog({ item, onClose }) {
  const { t } = useTranslation();
  const [directory, setDirectory] = useState(null),
    [grants, setGrants] = useState([]);
  const [target, setTarget] = useState(""),
    [rights, setRights] = useState(1),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    let stopped = false;
    Promise.all([api("/directory"), api("/files/acl/" + item.id)])
      .then(([d, a]) => {
        if (stopped) return;
        setDirectory(d);
        setGrants(
          a.grants.map((g) => ({
            type: g.user_id ? "user" : "group",
            id: g.user_id || g.group_id,
            rights: g.rights,
          })),
        );
      })
      .catch((e) => {
        if (!stopped) setError(e.message);
      });
    return () => {
      stopped = true;
    };
  }, [item.id]);
  const label = (grant) =>
    (grant.type === "user" ? directory.users : directory.groups).find(
      (v) => v.id === grant.id,
    )?.name || String(grant.id);
  return (
    <Dialog
      title={t("multiuser.share") + " · " + item.name}
      onClose={() => {
        if (!busy) onClose();
      }}
      wide
    >
      <form
        className="dialog-body identity-settings"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            await post("/files/acl/" + item.id, { grants }, "PUT");
            onClose();
          } catch (err) {
            setError(err.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <p className="muted">{t("multiuser.sharingHint")}</p>
        {directory && (
          <>
            <div className="identity-inline">
              <select
                aria-label={t("multiuser.shareWith")}
                value={target}
                onChange={(e) => setTarget(e.target.value)}
              >
                <option value="">{t("multiuser.shareWith")}</option>
                <optgroup label={t("multiuser.users")}>
                  {directory.users.map((u) => (
                    <option key={u.id} value={"user:" + u.id}>
                      {u.name} ({u.email})
                    </option>
                  ))}
                </optgroup>
                <optgroup label={t("multiuser.groups")}>
                  {directory.groups.map((g) => (
                    <option key={g.id} value={"group:" + g.id}>
                      {g.name}
                    </option>
                  ))}
                </optgroup>
              </select>
              <select
                aria-label={t("multiuser.rights")}
                value={rights}
                onChange={(e) => setRights(Number(e.target.value))}
              >
                {[1, 3, 5, 7].map((r) => (
                  <option key={r} value={r}>
                    {t("multiuser.rights_" + r)}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="secondary"
                disabled={!target || busy}
                onClick={() => {
                  const [type, id] = target.split(":");
                  setGrants((current) => [
                    ...current.filter(
                      (g) => g.type !== type || g.id !== Number(id),
                    ),
                    { type, id: Number(id), rights },
                  ]);
                  setTarget("");
                }}
              >
                {t("multiuser.add")}
              </button>
            </div>
            {grants.map((g) => (
              <div
                className="identity-card identity-inline"
                key={g.type + g.id}
              >
                <span>
                  {label(g)} · {t("multiuser.rights_" + g.rights)}
                </span>
                <button
                  type="button"
                  className="text-button danger"
                  disabled={busy}
                  onClick={() =>
                    setGrants((current) => current.filter((v) => v !== g))
                  }
                >
                  {t("multiuser.remove")}
                </button>
              </div>
            ))}
          </>
        )}
        {error && (
          <p className="notice error" role="alert">
            {t(error)}
          </p>
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
          <button className="primary" disabled={busy || !directory}>
            {t("save")}
          </button>
        </footer>
      </form>
    </Dialog>
  );
}
