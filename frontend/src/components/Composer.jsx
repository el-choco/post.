import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Send, Paperclip, X, Trash2 } from "lucide-react";
import { api, post } from "../api";
import { useStore } from "../store";
import Dialog from "./Dialog";
import WindowFrame from "./WindowFrame";
import RichEditor from "./RichEditor";
import SpellingReview from "./SpellingReview";
import { signatureText, textHtml } from "../lib/mailFormatting";
import { linkifyHtml, cleanEditorHtml } from "../lib/editorHtml";
export default function Composer({
  initial,
  settings,
  onClose,
  onSent,
  popup,
}) {
  const { user } = useStore();
  const { t } = useTranslation();
  const storageKey = `draft:${user.email}`;
  const [draft, setDraft] = useState(() => {
    if (initial) {
      const rich =
        settings.composeHtml === "always" ||
        (settings.composeHtml === "reply" &&
          ["reply", "replyAll"].includes(initial.kind) &&
          initial.hasHtml);
      let html = initial.html;
      if (rich && settings.keepFormatting && initial.originalHtml) {
        const doc = new DOMParser().parseFromString(
          initial.originalHtml,
          "text/html",
        );
        if (settings.stripOriginalSignature)
          doc
            .querySelectorAll(".gmail_signature,.moz-signature")
            .forEach((node) => node.remove());
        const quote = "<blockquote>" + doc.body.innerHTML + "</blockquote>",
          signature = textHtml(signatureText(settings, initial.kind), settings);
        html = cleanEditorHtml(
          settings.replyPosition === "below" || settings.signatureBelowQuote
            ? quote + signature
            : signature + quote,
        );
      }
      return {
        ...initial,
        html,
        format:
          settings.composeHtml === "always" ||
          (settings.composeHtml === "reply" &&
            ["reply", "replyAll"].includes(initial.kind) &&
            initial.hasHtml)
            ? "html"
            : "plain",
      };
    }
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey));
      if (saved) return saved;
    } catch {}
    return {
      to: "",
      cc: "",
      bcc: "",
      subject: "",
      text: signatureText(settings),
      format: settings.composeHtml === "always" ? "html" : "plain",
    };
  });
  const [attachments, setAttachments] = useState([]);
  const [hadLocalDraft] = useState(() => !!localStorage.getItem(storageKey));
  const [editorRevision, setEditorRevision] = useState(0);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("draftLocal"),
    [contacts, setContacts] = useState([]),
    [review, setReview] = useState(false);
  const draftRef = useRef(draft),
    draftDirty = useRef(false),
    sendingRef = useRef(false),
    discarded = useRef(false);
  const autosaveRef = useRef(Promise.resolve()),
    savingDraftRef = useRef(false);
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);
  useEffect(() => {
    if (!discarded.current)
      localStorage.setItem(storageKey, JSON.stringify(draft));
  }, [draft, storageKey]);
  useEffect(() => {
    if (user.demo) {
      try {
        setTimeout(
          () =>
            setContacts(
              JSON.parse(localStorage.getItem("demoAddressBooks"))?.contacts ||
                [],
            ),
          0,
        );
      } catch {}
      return;
    }
    let cancelled = false;
    api("/contacts")
      .then((data) => {
        if (!cancelled) setContacts(data);
      })
      .catch(() => {});
    if (!initial && !hadLocalDraft)
      api("/draft")
        .then((data) => {
          if (data && !cancelled && !draftDirty.current) {
            setDraft(data);
            setEditorRevision((value) => value + 1);
          }
        })
        .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [user.demo, initial, storageKey, hadLocalDraft]);
  useEffect(() => {
    if (!settings.draftInterval) return;
    const timer = setInterval(async () => {
      if (
        sendingRef.current ||
        discarded.current ||
        user.demo ||
        savingDraftRef.current
      )
        return;
      savingDraftRef.current = true;
      try {
        setStatus("draftSaving");
        autosaveRef.current = post("/draft", draftRef.current, "PUT");
        const saved = await autosaveRef.current;
        setStatus(saved.mailboxSaved ? "draftMailbox" : "draftServer");
      } catch (e) {
        setError(e.message);
      } finally {
        savingDraftRef.current = false;
      }
    }, settings.draftInterval * 1000);
    return () => clearInterval(timer);
  }, [user.demo, settings.draftInterval]);
  useEffect(() => {
    if (
      !initial?.original ||
      initial.kind !== "forward" ||
      settings.forwardMode !== "attachment" ||
      user.demo
    )
      return;
    const controller = new AbortController();
    fetch(`/api/source?${new URLSearchParams(initial.original)}`, {
      headers: { Authorization: `Bearer ${user.token}` },
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) throw new Error("error");
        return response.blob();
      })
      .then(
        (blob) =>
          new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () =>
              resolve({
                filename: "original-message.eml",
                size: blob.size,
                contentType: "message/rfc822",
                content: reader.result.split(",")[1],
              });
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          }),
      )
      .then((file) => {
        if (!controller.signal.aborted)
          setAttachments((current) => [...current, file]);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [initial, settings.forwardMode, user]);
  const update = (key, value) => {
    draftDirty.current = true;
    setDraft((current) => ({
      ...current,
      [key]: value,
      ...(key === "text" ? { html: undefined } : {}),
    }));
  };
  const recipients = (value) =>
    (value || "")
      .split(/[;,]/)
      .map((address) => address.trim())
      .filter(Boolean);
  async function attach(event) {
    const files = Array.from(event.target.files);
    event.target.value = "";
    if (
      files.reduce((size, file) => size + file.size, 0) +
        attachments.reduce((size, file) => size + file.size, 0) >
      20 * 1024 * 1024
    ) {
      setError(t("attachmentLimit"));
      return;
    }
    try {
      const added = await Promise.all(
        files.map(
          (file) =>
            new Promise((resolve, reject) => {
              const reader = new FileReader();
              reader.onerror = reject;
              reader.onload = () =>
                resolve({
                  filename: file.name,
                  size: file.size,
                  contentType: file.type,
                  content: reader.result.split(",")[1],
                });
              reader.readAsDataURL(file);
            }),
        ),
      );
      setAttachments((current) => [...current, ...added]);
    } catch {
      setError(t("error"));
    }
  }
  async function send(event, reviewed = false) {
    event.preventDefault();
    if (settings.spellcheckBeforeSend && !reviewed) {
      setReview(true);
      return;
    }
    sendingRef.current = true;
    setSending(true);
    setError("");
    try {
      if (user.demo) throw new Error(t("demoAction"));
      await autosaveRef.current.catch(() => {});
      await post("/send", {
        ...draft,
        html:
          draft.format === "html"
            ? settings.autoLinks
              ? linkifyHtml(draft.html || textHtml(draft.text, settings))
              : draft.html || textHtml(draft.text, settings)
            : undefined,
        requestMdn: settings.requestMdn,
        requestDsn: settings.requestDsn,
        to: recipients(draft.to),
        cc: recipients(draft.cc),
        bcc: recipients(draft.bcc),
        attachments,
      });
      localStorage.removeItem(storageKey);
      discarded.current = true;
      onSent();
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setSending(false);
      sendingRef.current = false;
    }
  }
  const content = (
    <form onSubmit={send} className="compose-form">
      <div className="compose-addresses">
        {["to", "cc", "bcc"].map((key) => (
          <label key={key}>
            <span>{t(key)}</span>
            <input
              value={draft[key] || ""}
              onChange={(e) => update(key, e.target.value)}
              required={key === "to"}
              placeholder={key === "to" ? "name@example.com" : ""}
              list="contact-suggestions"
            />
          </label>
        ))}
        <label>
          <span>{t("subject")}</span>
          <input
            value={draft.subject}
            onChange={(e) => update("subject", e.target.value)}
          />
        </label>
      </div>
      <datalist id="contact-suggestions">
        {contacts
          .flatMap((contact) =>
            settings.autocompletePrimaryOnly
              ? [{ value: contact.email }]
              : contact.profile?.emails?.length
                ? contact.profile.emails
                : [{ value: contact.email }],
          )
          .filter((e) => e.value)
          .map((email, index) => (
            <option key={index} value={email.value} />
          ))}
      </datalist>
      <div className="compose-mode">
        <button
          type="button"
          className={
            draft.format === "html" ? "active text-button" : "text-button"
          }
          onClick={() =>
            update("format", draft.format === "html" ? "plain" : "html")
          }
        >
          {t(draft.format === "html" ? "htmlMode" : "plainMode")}
        </button>
      </div>
      {draft.format === "html" ? (
        <RichEditor
          key={editorRevision}
          settings={settings}
          html={
            draft.html ||
            (settings.keepFormatting && initial?.originalHtml
              ? textHtml(signatureText(settings, initial.kind), settings) +
                "<blockquote>" +
                initial.originalHtml +
                "</blockquote>"
              : textHtml(draft.text, settings))
          }
          onChange={(text, html) => {
            draftDirty.current = true;
            setDraft((current) => ({ ...current, text, html }));
          }}
        />
      ) : (
        <textarea
          className="compose-body"
          value={draft.text}
          onChange={(e) => update("text", e.target.value)}
          placeholder={t("body")}
          aria-label={t("body")}
          spellCheck
          lang={settings.language}
        />
      )}
      {review && (
        <SpellingReview
          text={draft.text}
          settings={settings}
          sending={sending}
          onChange={(text) =>
            setDraft((current) => ({
              ...current,
              text,
              html:
                current.format === "html"
                  ? textHtml(text, settings)
                  : undefined,
            }))
          }
          onSend={(e) => send(e, true)}
          onCancel={() => setReview(false)}
        />
      )}
      {attachments.length > 0 && (
        <div className="attachment-list">
          {attachments.map((file, index) => (
            <span className="attachment" key={index}>
              <Paperclip size={14} />
              {file.filename}
              <button
                type="button"
                onClick={() =>
                  setAttachments((current) =>
                    current.filter((_, i) => i !== index),
                  )
                }
                aria-label={t("delete")}
              >
                <X size={14} />
              </button>
            </span>
          ))}
        </div>
      )}
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      <footer className="dialog-footer">
        <span className="muted draft-hint">{t(status)}</span>
        <label className="icon-button file-button" title={t("addAttachment")}>
          <Paperclip size={20} />
          <input type="file" multiple onChange={attach} />
        </label>
        <button
          type="button"
          className="icon-button"
          title={t("discard")}
          onClick={async () => {
            discarded.current = true;
            localStorage.removeItem(storageKey);
            await autosaveRef.current.catch(() => {});
            if (!user.demo)
              await api("/draft", { method: "DELETE" }).catch(() => {});
            onClose();
          }}
        >
          <Trash2 size={18} />
        </button>
        <button className="primary" disabled={sending}>
          <Send size={17} />
          {t(sending ? "sending" : "send")}
        </button>
      </footer>
    </form>
  );
  return popup ? (
    <WindowFrame popup={popup} onClose={onClose}>
      <header className="dialog-header">
        <h2>{t("newMessage")}</h2>
        <button
          className="icon-button"
          onClick={onClose}
          aria-label={t("close")}
        >
          <X size={20} />
        </button>
      </header>
      {content}
    </WindowFrame>
  ) : (
    <Dialog title={t("newMessage")} onClose={onClose} wide>
      {content}
    </Dialog>
  );
}
