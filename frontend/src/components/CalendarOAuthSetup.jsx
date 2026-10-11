import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Lock, Link } from "lucide-react";
import { post } from "../api";
import { oauthBaseUrl, oauthCallbackUrl } from "../lib/calendarOAuth";

export default function CalendarOAuthSetup({
  provider,
  setup = {},
  demo,
  onSaved,
  onBack,
}) {
  const { t } = useTranslation();
  const [baseUrl, setBaseUrl] = useState(
    setup.baseUrl || window.location.origin,
  );
  const [clientId, setClientId] = useState(setup.clientId || "");
  const [clientSecret, setClientSecret] = useState("");
  const [tenant, setTenant] = useState(setup.tenant || "common");
  const [secretSaved, setSecretSaved] = useState(!!setup.secretSaved);
  const [savedClient, setSavedClient] = useState(setup.clientId || "");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const validBase = oauthBaseUrl(provider, baseUrl);
  const sameOrigin = validBase === window.location.origin;
  const callback = oauthCallbackUrl(provider, baseUrl);
  const retainSecret = secretSaved && clientId.trim() === savedClient;
  async function submit(e) {
    e.preventDefault();
    if (demo || !validBase) return;
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      const result = await post("/calendar/oauth/" + provider + "/config", {
        baseUrl,
        clientId,
        clientSecret,
        tenant,
      });
      onSaved(result);
      setSavedClient(clientId.trim());
      setSecretSaved(true);
      setClientSecret("");
      setSaved(true);
      if (sameOrigin) {
        const authorization = await post(
          "/calendar/oauth/" + provider + "/start",
          {},
        );
        window.location.assign(authorization.url);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="calendar-oauth-setup" onSubmit={submit}>
      <button
        type="button"
        className="text-button"
        disabled={busy}
        onClick={onBack}
      >
        <ArrowLeft size={16} />
        {t("calendar.oauthBack")}
      </button>
      <p className="calendar-hint">{t("calendar.oauthFormHint")}</p>
      <a
        href={
          provider === "google"
            ? "https://console.cloud.google.com/apis/credentials"
            : "https://entra.microsoft.com/"
        }
        target="_blank"
        rel="noopener noreferrer"
        className="text-button"
      >
        {t("calendar.oauthConsole", {
          provider: provider === "google" ? "Google" : "Microsoft",
        })}
      </a>
      <label>
        {t("calendar.oauthBaseUrl")}
        <input
          required
          type="url"
          maxLength={2000}
          value={baseUrl}
          placeholder="https://mail.example.org"
          onChange={(e) => {
            setBaseUrl(e.target.value);
            setSaved(false);
          }}
        />
      </label>
      {!validBase && (
        <p className="calendar-oauth-notice" role="status">
          {t("calendar.errors.oauthAddress")}
        </p>
      )}
      <label>
        {t("calendar.oauthClientId")}
        <input
          required
          maxLength={1000}
          autoComplete="off"
          value={clientId}
          onChange={(e) => {
            setClientId(e.target.value);
            setSaved(false);
          }}
        />
      </label>
      <label>
        {t("calendar.oauthClientSecret")}
        <input
          type="password"
          required={!retainSecret}
          maxLength={4000}
          autoComplete="new-password"
          placeholder={retainSecret ? t("calendar.oauthSecretSaved") : ""}
          value={clientSecret}
          onChange={(e) => {
            setClientSecret(e.target.value);
            setSaved(false);
          }}
        />
      </label>
      {provider === "microsoft" && (
        <label>
          {t("calendar.oauthTenant")}
          <input
            required
            maxLength={150}
            value={tenant}
            onChange={(e) => setTenant(e.target.value)}
          />
        </label>
      )}
      {callback && (
        <label>
          {t("calendar.oauthCallback")}
          <input readOnly value={callback} onFocus={(e) => e.target.select()} />
          <span className="calendar-hint">
            {t("calendar.oauthCallbackHint")}
          </span>
        </label>
      )}
      {validBase && !sameOrigin && (
        <p className="calendar-oauth-notice">
          {t("calendar.oauthOtherAddress")}
          <a
            href={validBase + "/?view=calendar"}
            target="_blank"
            rel="noopener noreferrer"
          >
            {validBase}
          </a>
        </p>
      )}
      <p className="calendar-hint">
        <Lock size={14} />
        {t("calendar.oauthPrivacy")}
      </p>
      {error && (
        <p role="alert" className="calendar-oauth-notice">
          {t(error)}
        </p>
      )}
      {saved && (
        <p role="status" className="calendar-hint">
          {t("calendar.saved")}
        </p>
      )}
      {demo && <p className="calendar-hint">{t("calendar.errors.demo")}</p>}
      <button className="primary" disabled={busy || !validBase || demo}>
        <Link size={16} />
        {t(
          busy
            ? "calendar.oauthSaving"
            : sameOrigin
              ? "calendar.oauthSaveConnect"
              : "calendar.oauthSave",
        )}
      </button>
    </form>
  );
}
