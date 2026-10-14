import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Pencil,
  Download,
  LoaderCircle,
  Check,
  AlertCircle,
} from "lucide-react";
import Dialog from "./Dialog";
import { api, post } from "../api";
import { loadOffice } from "../lib/office";
import { saveBlob } from "../lib/files";
import { useStore } from "../store";

export default function OfficePreview({
  item,
  source,
  onClose,
  onChanged,
  onDownload,
}) {
  const { t, i18n } = useTranslation();
  const { user } = useStore();
  const id = "office-" + useId().replace(/[^a-z0-9]/gi, "");
  const [session, setSession] = useState(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const [status, setStatus] = useState(null),
    [closing, setClosing] = useState(false),
    [closeFailed, setCloseFailed] = useState(false);
  const editor = useRef(null),
    sequence = useRef(0),
    mounted = useRef(true),
    closeRequest = useRef(false),
    lastSaved = useRef(0);
  const changed = useRef(onChanged),
    close = useRef(onClose);
  useEffect(() => {
    changed.current = onChanged;
    close.current = onClose;
  });
  function destroy() {
    editor.current?.destroyEditor();
    editor.current = null;
  }
  async function open(mode = "view") {
    const attempt = ++sequence.current;
    setLoading(true);
    setError("");
    setStatus(null);
    let created;
    try {
      if (user.demo) throw new Error("office.errors.demo");
      created = await post("/office/sessions", {
        source,
        itemId: item.id,
        mode,
        language: i18n.language,
      });
      if (!mounted.current || attempt !== sequence.current) {
        await post("/office/sessions/" + created.id + "/close", {
          detach: true,
        }).catch(() => {});
        return;
      }
      setSession(created);
      const docs = await loadOffice(created.url);
      if (!mounted.current || attempt !== sequence.current) return;
      editor.current = new docs.DocEditor(id, {
        ...created.config,
        events: {
          onAppReady: () => {
            if (mounted.current) setLoading(false);
          },
          onError: () => {
            if (mounted.current) {
              setLoading(false);
              setError("office.errors.connect");
            }
          },
          onRequestClose: () => {
            if (mounted.current) void requestClose(created);
          },
        },
      });
    } catch (e) {
      if (created)
        await post("/office/sessions/" + created.id + "/close", {
          detach: true,
        }).catch(() => {});
      if (mounted.current && attempt === sequence.current) {
        setLoading(false);
        setError(e.message || "office.errors.connect");
      }
    }
  }
  useEffect(() => {
    mounted.current = true;
    void open();
    return () => {
      mounted.current = false;
      sequence.current++;
      destroy();
    };
                                                                                 
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!session || session.mode !== "edit") return;
    let cancelled = false;
    const poll = async () => {
      try {
        const result = await api("/office/sessions/" + session.id);
        if (cancelled) return;
        setStatus(result);
        if (result.savedAt && result.savedAt !== lastSaved.current) {
          lastSaved.current = result.savedAt;
          changed.current();
        }
      } catch (e) {
        if (!cancelled) setError(e.message);
      }
    };
    void poll();
    const timer = setInterval(poll, 3000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [session]);
  async function requestClose(current = session) {
    if (closeRequest.current) return;
    closeRequest.current = true;
    if (!current || current.mode === "view" || (error && !editor.current)) {
      sequence.current++;
      destroy();
      if (current)
        await post("/office/sessions/" + current.id + "/close", {
          detach: true,
        }).catch(() => {});
      close.current();
      return;
    }
    setClosing(true);
    setCloseFailed(false);
    destroy();
    const deadline = Date.now() + 90000;
    while (mounted.current && Date.now() < deadline) {
      try {
        const result = await api("/office/sessions/" + current.id);
        if (!mounted.current) return;
        setStatus(result);
        if (result.state === "closed" && !result.error) {
          changed.current();
          close.current();
          return;
        }
        if (result.error && result.recovery) break;
      } catch (e) {
        if (mounted.current) setError(e.message);
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    if (mounted.current) {
      setCloseFailed(true);
      setError("office.errors.savePending");
      closeRequest.current = false;
    }
  }
  async function edit() {
    if (!session || loading) return;
    setLoading(true);
    destroy();
    await post("/office/sessions/" + session.id + "/close", {}).catch(() => {});
    setSession(null);
    await open("edit");
  }
  async function recovery() {
    try {
      const response = await fetch(
        "/api/office/sessions/" + session.id + "/recovery",
        { headers: { Authorization: "Bearer " + user.token } },
      );
      if (!response.ok) throw new Error("office.errors.save");
      saveBlob(await response.blob(), status?.recoveryName || item.name);
    } catch (e) {
      setError(e.message);
    }
  }
  const problem = status?.error || error;
  return (
    <Dialog wide full title={item.name} onClose={() => void requestClose()}>
      <div className="office-preview">
        <div className="office-preview-toolbar">
          <span>
            {t(session?.mode === "edit" ? "office.editing" : "office.viewing")}
          </span>
          {status?.savedAt && !problem && (
            <span className="office-save-status">
              <Check size={15} />
              {t("office.saved", {
                time: new Date(status.savedAt).toLocaleTimeString(
                  i18n.language,
                  { hour: "2-digit", minute: "2-digit", second: "2-digit" },
                ),
              })}
            </span>
          )}
          {status?.recovery && (
            <button className="secondary" onClick={() => void recovery()}>
              <Download size={16} />
              {t("office.recovery")}
            </button>
          )}
          {session?.mode === "view" && session.canEdit && !problem && (
            <button
              className="primary"
              disabled={loading}
              onClick={() => void edit()}
            >
              <Pencil size={16} />
              {t("office.edit")}
            </button>
          )}
        </div>
        {problem && (
          <div className="notice error" role="alert">
            <AlertCircle size={17} />
            {t(problem)}
          </div>
        )}
        <div className="office-editor-wrap">
          <div className="office-editor" id={id} />
          {(loading || closing || (!session && problem)) && (
            <div className="office-editor-overlay">
              {(loading || (closing && !closeFailed)) && (
                <LoaderCircle className="spinner" size={28} />
              )}
              <p>
                {t(
                  closing
                    ? "office.saving"
                    : loading
                      ? "office.loading"
                      : problem,
                )}
              </p>
              {status?.recovery && (
                <>
                  <p>{t("office.recoveryHint")}</p>
                  <button className="primary" onClick={() => void recovery()}>
                    <Download size={17} />
                    {t("office.recovery")}
                  </button>
                </>
              )}
              {closeFailed && (
                <button
                  className="secondary"
                  onClick={() => {
                    void post("/office/sessions/" + session.id + "/close", {
                      detach: true,
                    }).catch(() => {});
                    changed.current();
                    close.current();
                  }}
                >
                  {t("office.closeAnyway")}
                </button>
              )}
            </div>
          )}
        </div>
        <footer className="dialog-footer">
          <small>{t("office.saveHint")}</small>
          <button
            className="primary"
            disabled={closing || item.downloadable === false}
            onClick={() => void onDownload().catch((e) => setError(e.message))}
          >
            <Download size={17} />
            {t("office.downloadSaved")}
          </button>
          <button
            className="secondary"
            disabled={closing && !closeFailed}
            onClick={() => void requestClose()}
          >
            {t(closing && !closeFailed ? "office.saving" : "close")}
          </button>
        </footer>
      </div>
    </Dialog>
  );
}
