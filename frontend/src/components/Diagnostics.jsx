import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Activity,
  Download,
  RefreshCw,
  LoaderCircle,
  CheckCircle2,
  AlertCircle,
  Clock3,
} from "lucide-react";
import { api } from "../api";
import { useStore } from "../store";
export default function Diagnostics() {
  const { t, i18n } = useTranslation();
  const demo = useStore((state) => state.user?.demo);
  const [data, setData] = useState(null),
    [filter, setFilter] = useState("all"),
    [revision, setRevision] = useState(0),
    [loading, setLoading] = useState(true),
    [exporting, setExporting] = useState(false),
    [error, setError] = useState("");
  const duration = (value) =>
    new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 2 }).format(
      value / 1000,
    ) + " s";
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      setError("");
      try {
        const result = demo
          ? {
              entries: [],
              total: 0,
              limit: 200,
              maxEntries: 1000,
              retentionDays: 7,
            }
          : await api(`/diagnostics?filter=${filter}`, {
              signal: controller.signal,
              timeoutMs: 15000,
            });
        if (!controller.signal.aborted) setData(result);
      } catch (cause) {
        if (!controller.signal.aborted) setError(t(cause.message || "error"));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 0);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [demo, filter, revision, t]);
  async function download() {
    setExporting(true);
    setError("");
    try {
      const result = await api("/diagnostics/export", { timeoutMs: 15000 });
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(result, null, 2)], {
          type: "application/json",
        }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = "post-diagnostics.json";
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) {
      setError(t(cause.message || "error"));
    } finally {
      setExporting(false);
    }
  }
  return (
    <section className="diagnostics-panel" aria-label={t("diagnostics.title")}>
      <div className="diagnostics-intro">
        <Activity size={25} />
        <div>
          <strong>{t("diagnostics.subtitle")}</strong>
          <p>{t("diagnostics.description")}</p>
        </div>
      </div>
      <div className="diagnostics-controls">
        <label>
          {t("diagnostics.filter")}
          <select
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          >
            {["all", "errors", "slow"].map((value) => (
              <option key={value} value={value}>
                {t("diagnostics.filters." + value)}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="secondary"
          disabled={loading}
          onClick={() => setRevision((value) => value + 1)}
        >
          <RefreshCw size={16} className={loading ? "spinner" : ""} />
          {t("refresh")}
        </button>
        <button
          type="button"
          className="primary"
          disabled={demo || exporting}
          onClick={download}
        >
          {exporting ? (
            <LoaderCircle size={16} className="spinner" />
          ) : (
            <Download size={16} />
          )}
          {t("diagnostics.download")}
        </button>
      </div>
      <p className="muted diagnostics-retention">
        {t(demo ? "diagnostics.demo" : "diagnostics.retention", {
          days: data?.retentionDays || 7,
          max: data?.maxEntries || 1000,
        })}
      </p>
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      <div aria-busy={loading} className="diagnostics-entries">
        {loading && (
          <p className="diagnostics-empty" role="status">
            <LoaderCircle className="spinner" size={20} />
            {t("loading")}
          </p>
        )}
        {!loading && !data?.entries.length && (
          <p className="diagnostics-empty">{t("diagnostics.empty")}</p>
        )}
        {!loading &&
          data?.entries.map((entry) => (
            <details
              className={`diagnostic-entry diagnostic-${entry.level}`}
              key={entry.id}
            >
              <summary>
                <span className="diagnostic-status">
                  {entry.level === "error" ? (
                    <AlertCircle size={18} />
                  ) : entry.level === "warning" ? (
                    <Clock3 size={18} />
                  ) : (
                    <CheckCircle2 size={18} />
                  )}
                  {t("diagnostics.levels." + entry.level)}
                </span>
                <span className="diagnostic-route">
                  {entry.route}
                  <small>
                    {new Date(entry.at).toLocaleString(i18n.language)} ·{" "}
                    {t("diagnostics.sources." + entry.source)}
                  </small>
                </span>
                <strong>{duration(entry.durationMs)}</strong>
                <span className="diagnostic-http">
                  {entry.status
                    ? `HTTP ${entry.status}`
                    : t("diagnostics.noResponse")}
                </span>
              </summary>
              <div className="diagnostic-details">
                <dl>
                  <div>
                    <dt>{t("diagnostics.requestId")}</dt>
                    <dd>{entry.requestId || "–"}</dd>
                  </div>
                  <div>
                    <dt>{t("diagnostics.code")}</dt>
                    <dd>{entry.errorCode || "–"}</dd>
                  </div>
                  <div>
                    <dt>{t("diagnostics.version")}</dt>
                    <dd>{entry.version}</dd>
                  </div>
                </dl>
                {entry.stages.length > 0 ? (
                  <>
                    <p className="muted">{t("diagnostics.stagesHint")}</p>
                    <ul className="diagnostic-stages">
                      {entry.stages.map((stage) => (
                        <li key={stage.phase}>
                          <span>
                            {t("diagnostics.phases." + stage.phase)}
                            {stage.active && (
                              <small>{t("diagnostics.active")}</small>
                            )}
                          </span>
                          <strong>{duration(stage.durationMs)}</strong>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <p className="muted">{t("diagnostics.noStages")}</p>
                )}
              </div>
            </details>
          ))}
      </div>
      {data?.total > 0 && (
        <p className="muted">
          {t("diagnostics.count", {
            shown: data.entries.length,
            total: data.total,
          })}
        </p>
      )}
    </section>
  );
}
