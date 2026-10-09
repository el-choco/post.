import { useState } from "react";
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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  if (user) return <Navigate to="/" />;
  async function login(event) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(
          {
            auth: "loginAuth",
            connect: "loginConnect",
            smtp: "loginConnect",
            rate: "loginRate",
          }[data.code] || "error",
        );
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
          <span className="eyebrow">WEBMAIL</span>
          <h2>{t("login")}</h2>
          <p>{t("loginHint")}</p>
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
            {t("password")}
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
          {error && (
            <div className="notice error" role="alert">
              {error}
            </div>
          )}
          <button className="primary login-submit" disabled={loading}>
            {t(loading ? "loading" : "login")}
            <ArrowRight size={18} />
          </button>
          <div className="secure-hint">
            <ShieldCheck size={16} />
            {t("secureHint")}
          </div>
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
