import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, post } from "../api";
import { useStore } from "../store";

export default function AdminSettings() {
  const { t } = useTranslation(),
    { user } = useStore();
  const [data, setData] = useState(null),
    [name, setName] = useState("");
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function load() {
    setData(await api("/admin"));
  }
  useEffect(() => {
    let stop = false;
    api("/admin")
      .then((value) => {
        if (!stop) setData(value);
      })
      .catch((e) => {
        if (!stop) setError(e.message);
      });
    return () => {
      stop = true;
    };
  }, []);
  async function action(fn) {
    setBusy(true);
    setError("");
    try {
      await fn?.();
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  function edit(id, values) {
    setData((current) => ({
      ...current,
      users: current.users.map((u) => (u.id === id ? { ...u, ...values } : u)),
    }));
  }
  return (
    <div className="identity-settings">
      <p className="muted">{t("multiuser.adminHint")}</p>
      <div>
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={() => void action()}
        >
          {t("refresh")}
        </button>
      </div>
      {error && (
        <p className="notice error" role="alert">
          {t(error)}
        </p>
      )}
      {!data ? (
        <p>{t("loading")}</p>
      ) : (
        <>
          <label className="identity-inline">
            <input
              type="checkbox"
              checked={data.registration}
              disabled={busy}
              onChange={(e) =>
                void action(() =>
                  post(
                    "/admin/registration",
                    { enabled: e.target.checked },
                    "PUT",
                  ),
                )
              }
            />
            {t("multiuser.allowRegistration")}
          </label>
          <h4>{t("multiuser.users")}</h4>
          <div className="identity-users">
            {data.users.map((u) => (
              <div key={u.id} className="identity-card identity-column">
                <strong>
                  {u.name} · {u.email}
                </strong>
                <div className="identity-inline">
                  <label>
                    {t("multiuser.role")}
                    <select
                      value={u.role}
                      disabled={busy || u.id === user.id}
                      onChange={(e) => edit(u.id, { role: e.target.value })}
                    >
                      <option value="user">{t("multiuser.role_user")}</option>
                      <option value="admin">{t("multiuser.role_admin")}</option>
                    </select>
                  </label>
                  <label>
                    {t("multiuser.status")}
                    <select
                      value={u.status}
                      disabled={busy || u.id === user.id}
                      onChange={(e) => edit(u.id, { status: e.target.value })}
                    >
                      {["pending", "active", "disabled"].map((s) => (
                        <option key={s} value={s}>
                          {t("multiuser.status_" + s)}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="identity-inline">
                  {["mail", "calendar", "files"].map((feature) => (
                    <label key={feature}>
                      <input
                        type="checkbox"
                        checked={u.permissions[feature]}
                        disabled={busy || u.id === user.id}
                        onChange={(e) =>
                          edit(u.id, {
                            permissions: {
                              ...u.permissions,
                              [feature]: e.target.checked,
                            },
                          })
                        }
                      />
                      {t(
                        feature === "calendar"
                          ? "calendar.title"
                          : feature === "files"
                            ? "files.title"
                            : "mail",
                      )}
                    </label>
                  ))}
                </div>
                <button
                  className="secondary"
                  type="button"
                  disabled={busy || u.id === user.id}
                  onClick={() =>
                    void action(() => post("/admin/users/" + u.id, u, "PATCH"))
                  }
                >
                  {t("save")}
                </button>
                <button
                  className="text-button danger"
                  type="button"
                  disabled={busy || u.id === user.id}
                  onClick={() => {
                    if (
                      confirm(
                        t("multiuser.deleteUserConfirm", { name: u.name }),
                      )
                    )
                      void action(() =>
                        post(
                          "/admin/users/" + u.id,
                          { confirm: true },
                          "DELETE",
                        ),
                      );
                  }}
                >
                  {t("delete")}
                </button>
              </div>
            ))}
          </div>
          <h4>{t("multiuser.groups")}</h4>
          <form
            className="identity-inline"
            onSubmit={(e) => {
              e.preventDefault();
              void action(async () => {
                await post("/admin/groups", { name });
                setName("");
              });
            }}
          >
            <input
              aria-label={t("multiuser.groupName")}
              placeholder={t("multiuser.groupName")}
              required
              maxLength={100}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <button className="primary" disabled={busy}>
              {t("multiuser.createGroup")}
            </button>
          </form>
          {data.groups.map((group) => (
            <Group
              key={group.id + ":" + group.members}
              group={group}
              users={data.users}
              busy={busy}
              action={action}
            />
          ))}
        </>
      )}
    </div>
  );
}
function Group({ group, users, busy, action }) {
  const { t } = useTranslation();
  const [members, setMembers] = useState(() => JSON.parse(group.members));
  return (
    <div className="identity-card identity-column">
      <strong>{group.name}</strong>
      <div className="identity-group-members">
        {users.map((u) => (
          <label key={u.id}>
            <input
              type="checkbox"
              checked={members.includes(u.id)}
              disabled={busy}
              onChange={(e) =>
                setMembers((current) =>
                  e.target.checked
                    ? [...current, u.id]
                    : current.filter((id) => id !== u.id),
                )
              }
            />
            {u.name} ({u.email})
          </label>
        ))}
      </div>
      <div className="identity-inline">
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={() =>
            void action(() =>
              post("/admin/groups/" + group.id, { members }, "PUT"),
            )
          }
        >
          {t("save")}
        </button>
        <button
          type="button"
          className="text-button danger"
          disabled={busy}
          onClick={() => {
            if (confirm(t("multiuser.deleteGroupConfirm")))
              void action(() =>
                post("/admin/groups/" + group.id, {}, "DELETE"),
              );
          }}
        >
          {t("delete")}
        </button>
      </div>
    </div>
  );
}
