import { useTranslation } from "react-i18next";
import { X, RefreshCw, AlertCircle } from "lucide-react";
export default function MailError({
  message,
  info,
  onRetry,
  onClose,
  onDiagnostics,
}) {
  const { t } = useTranslation();
  return (
    <aside className="mail-error-banner notice error" role="alert">
      <AlertCircle size={19} />
      <div className="mail-error-content">
        <strong>{message}</strong>
        {info && (
          <details>
            <summary>{t("errorDetails")}</summary>
            <pre>
              {[
                new Date(info.at).toLocaleString(),
                info.endpoint && `API: ${info.endpoint}`,
                info.status && `HTTP: ${info.status}`,
                info.requestId && `ID: ${info.requestId}`,
              ]
                .filter(Boolean)
                .join("\n")}
            </pre>
          </details>
        )}
      </div>
      {onDiagnostics && (
        <button type="button" className="text-button" onClick={onDiagnostics}>
          {t("diagnostics.open")}
        </button>
      )}
      <button type="button" className="text-button" onClick={onRetry}>
        <RefreshCw size={16} />
        {t("retry")}
      </button>
      <button
        type="button"
        className="icon-button"
        aria-label={t("close")}
        onClick={onClose}
      >
        <X size={17} />
      </button>
    </aside>
  );
}
