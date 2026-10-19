import { useEffect, useState } from "react";
import { useNavigate, Navigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Mail, ArrowRight, ShieldCheck, Moon, Sun } from "lucide-react";
import { useStore } from "../store";
export default function Login() {
  const { user, setUser, darkMode, toggleDarkMode } = useStore();
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [name, setName] = useState("");
  const [setupToken, setSetupToken] = useState("");
  const [register, setRegister] = useState(false);
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState({ setup: false, registration: true });
  useEffect(() => {
    let stopped = false;
    fetch("/api/auth/status")
      .then((r) => r.json())
      .then((value) => {
        if (!stopped) {
          setStatus(value);
          if (value.setup) setRegister(true);
        }
      })
      .catch(() => {});
    return () => {
      stopped = true;
    };
  }, []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  if (user) return <Navigate to="/" />;
  async function login(event) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      if (register && password !== repeat)
        throw new Error("multiuser.passwordMismatch");
      const response = await fetch(register ? "/api/register" : "/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, name, setupToken }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "error");
      if (data.pending) {
        setPending(true);
        setPassword("");
        setRepeat("");
        return;
      }
      setUser({ ...data.account, token: data.token });
      navigate("/");
    } catch (e) {
      setError(
        t(e.message === "Failed to fetch" ? "connectionError" : e.message),
      );
    } finally {
      setLoading(false);
    }
  }
  return (
    <div className="login-page">
      <header className="login-header">
        <div className="brand">
          <span className="brand-icon">
            <Mail size={22} />
          </span>
          post<span className="brand-dot">.</span>
        </div>
        <div className="header-actions">
          <select
            aria-label={t("language")}
            value={i18n.language}
            onChange={(e) => i18n.changeLanguage(e.target.value)}
          >
            <option value="de">DE</option>
            <option value="en">EN</option>
          </select>
          <button
            className="icon-button"
            aria-label={t(darkMode ? "light" : "dark")}
            onClick={toggleDarkMode}
          >
            {darkMode ? <Sun size={20} /> : <Moon size={20} />}
          </button>
        </div>
      </header>
      <main className="login-main">
        <div className="login-art">
          <span className="eyebrow">YOUR EVERYDAY, SIMPLIFIED</span>
          <h1>{t("loginTitle")}</h1>
          <p>{t("loginSub")}</p>
          <div className="mail-illustration">
            <div className="orbit orbit-one" />
            <div className="orbit orbit-two" />
            <div className="floating-letter">
              <Mail size={86} strokeWidth={1} />
            </div>
            <div className="illustration-note">
              <span className="status-dot" />
              {t("welcome")}
            </div>
          </div>
        </div>
        <form className="login-card" onSubmit={login}>
          <span className="eyebrow">post. 2.0</span>
          <h2>
            {t(
              status.setup
                ? "multiuser.setupTitle"
                : register
                  ? "multiuser.register"
                  : "login",
            )}
          </h2>
          <p>{t("multiuser.loginHint")}</p>
          {pending && (
            <p className="notice" role="status">
              {t("multiuser.pending")}
            </p>
          )}
          {register && (
            <label>
              {t("displayName")}
              <input
                required
                maxLength={100}
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
          )}
          <label>
            {t("email")}
            <input
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="du@beispiel.de"
              required
            />
          </label>
          <label>
            {t("multiuser.postPassword")}
            <input
              type="password"
              autoComplete={register ? "new-password" : "current-password"}
              minLength={register ? 12 : undefined}
              maxLength={256}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
          {register && (
            <label>
              {t("multiuser.repeatPassword")}
              <input
                type="password"
                required
                minLength={12}
                maxLength={256}
                autoComplete="new-password"
                value={repeat}
                onChange={(e) => setRepeat(e.target.value)}
              />
            </label>
          )}
          {register && status.setup && (
            <label>
              {t("multiuser.setupToken")}
              <input
                required
                autoComplete="off"
                value={setupToken}
                onChange={(e) => setSetupToken(e.target.value)}
              />
              <small>{t("multiuser.setupHint")}</small>
            </label>
          )}
          {error && (
            <div className="notice error" role="alert">
              {error}
            </div>
          )}
          <button className="primary login-submit" disabled={loading}>
            {t(loading ? "loading" : register ? "multiuser.register" : "login")}
            <ArrowRight size={18} />
          </button>
          <div className="secure-hint">
            <ShieldCheck size={16} />
            {t("multiuser.passwordHint")}
          </div>
          {status.registration && !status.setup && (
            <button
              type="button"
              className="text-button"
              onClick={() => {
                setRegister((v) => !v);
                setError("");
                setPending(false);
              }}
            >
              {t(
                register ? "multiuser.backToLogin" : "multiuser.createAccount",
              )}
            </button>
          )}
          <button
            className="text-button demo-button"
            type="button"
            onClick={() => {
              setUser({ email: "alex@post.demo", demo: true });
              navigate("/");
            }}
          >
            {t("demo")} <ArrowRight size={15} />
          </button>
        </form>
      </main>
      <footer className="login-footer">
        post. — a calmer inbox · v{__APP_VERSION__}
      </footer>
    </div>
  );
}
