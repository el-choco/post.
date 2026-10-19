import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, LockKeyhole, Mail, Unplug } from "lucide-react";
import { api, post } from "../api";
import { useStore } from "../store";
import CalendarOAuthSetup from "./CalendarOAuthSetup";

export default function AccountSettings() {
  const { t } = useTranslation(),
    { user, setUser } = useStore();
  const [config, setConfig] = useState(null),
    [provider, setProvider] = useState("google");
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState("");
  const [setup, setSetup] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [notice, setNotice] = useState(""),
    [currentPassword, setCurrentPassword] = useState(""),
    [newPassword, setNewPassword] = useState("");
  async function reload() {
    const value = await api("/mail/config");
    setConfig(value);
    setEmail(value.email || "");
  }
  useEffect(() => {
    if (user.demo || user.permissions?.mail === false) return;
    let stop = false;
    api("/mail/config")
      .then((value) => {
        if (!stop) {
          setConfig(value);
          setEmail(value.email || "");
        }
      })
      .catch((e) => {
        if (!stop) setError(e.message);
      });
    return () => {
      stop = true;
    };
  }, [user.demo, user.permissions?.mail]);
  async function updateUser() {
    const me = await api("/me");
    setUser({ ...me, token: user.token });
  }
  async function connect(event) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (provider === "password") {
        await post("/mail/connect", { email, password });
        setPassword("");
        await reload();
        await updateUser();
        setNotice("multiuser.connected");
      } else if (!config?.[provider]) setSetup(true);
      else {
        const result = await post("/mail/oauth/" + provider + "/start", {
          email,
        });
        window.location.assign(result.url);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const result = new URLSearchParams(location.search).get("mailResult");
  return (
    <div className="identity-settings">
      <div className="identity-card">
        <LockKeyhole size={23} />
        <div>
          <strong>{user.name || user.email}</strong>
          <p>
            {user.email} · {t("multiuser.role_" + (user.role || "user"))}
          </p>
          <p className="muted">{t("multiuser.separatePassword")}</p>
        </div>
      </div>
      {result && (
        <p
          className={"notice " + (result === "connected" ? "" : "error")}
          role="status"
        >
          {t(
            result === "connected"
              ? "multiuser.connected"
              : "multiuser.oauthFailed",
          )}
        </p>
      )}
      {user.permissions?.mail !== false && (
        <section className="identity-card identity-column">
          <h4>
            <Mail size={20} /> {t("multiuser.mailConnection")}
          </h4>
          <p className="muted">{t("multiuser.mailOptional")}</p>
          {config?.connected ? (
            <>
              <strong>{config.email}</strong>
              <span>
                {t("multiuser.method")}:{" "}
                {config.kind === "password"
                  ? t("multiuser.appPassword")
                  : config.kind}
              </span>
              <button
                type="button"
                className="secondary"
                disabled={busy || user.demo}
                onClick={async () => {
                  if (!confirm(t("multiuser.disconnectConfirm"))) return;
                  setBusy(true);
                  setError("");
                  try {
                    await post("/mail/connection", {}, "DELETE");
                    localStorage.removeItem(`draft:${user.email}`);
                    await reload();
                    await updateUser();
                  } catch (e) {
                    setError(e.message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <Unplug size={17} />
                {t("multiuser.disconnect")}
              </button>
            </>
          ) : setup ? (
            <CalendarOAuthSetup
              purpose="mail"
              provider={provider}
              setup={config?.oauthSetup?.[provider]}
              startBody={{ email }}
              onSaved={setConfig}
              onBack={() => setSetup(false)}
            />
          ) : (
            <form onSubmit={connect} className="identity-form">
              <p className="muted">{t("multiuser.migrationHint")}</p>
              <label>
                {t("multiuser.provider")}
                <select
                  value={provider}
                  onChange={(e) => setProvider(e.target.value)}
                >
                  <option value="google">Google OAuth2</option>
                  <option value="microsoft">Microsoft OAuth2</option>
                  <option value="password">
                    {t("multiuser.otherProvider")}
                  </option>
                </select>
              </label>
              <label>
                {t("email")}
                <input
                  type="email"
                  autoComplete="off"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </label>
              {provider === "password" && (
                <label>
                  {t("multiuser.appPassword")}
                  <input
                    type="password"
                    autoComplete="new-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </label>
              )}
              <button
                className="primary"
                disabled={busy || user.demo || !config}
              >
                <Link size={17} />
                {t(busy ? "loading" : "multiuser.connect")}
              </button>
              {provider !== "password" && config?.[provider] && (
                <button
                  type="button"
                  className="text-button"
                  onClick={() => setSetup(true)}
                >
                  {t("multiuser.oauthSettings")}
                </button>
              )}
            </form>
          )}
        </section>
      )}
      <section className="identity-card identity-column">
        <h4>{t("multiuser.changePassword")}</h4>
        <form
          className="identity-form"
          onSubmit={async (e) => {
            e.preventDefault();
            setError("");
            setNotice("");
            setBusy(true);
            try {
              await post("/account/password", {
                currentPassword,
                password: newPassword,
              });
              setCurrentPassword("");
              setNewPassword("");
              setNotice("multiuser.passwordChanged");
            } catch (err) {
              setError(err.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            {t("multiuser.currentPassword")}
            <input
              type="password"
              autoComplete="current-password"
              required
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
          </label>
          <label>
            {t("multiuser.newPassword")}
            <input
              type="password"
              minLength={12}
              maxLength={256}
              autoComplete="new-password"
              required
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </label>
          <button className="secondary" disabled={busy || user.demo}>
            {t("multiuser.changePassword")}
          </button>
        </form>
      </section>
      {notice && (
        <p className="notice" role="status">
          {t(notice)}
        </p>
      )}
      {error && (
        <p className="notice error" role="alert">
          {t(error)}
        </p>
      )}
    </div>
  );
}
