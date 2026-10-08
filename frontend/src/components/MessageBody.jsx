import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useStore } from "../store";
import { emoticons } from "../lib/mailFormatting";
function mailDocument(html, remote, dark, quoteLines, label) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  if (quoteLines > 0)
    doc.querySelectorAll("blockquote").forEach((quote) => {
      if (
        Math.max(
          (quote.textContent || "").split("\n").length,
          quote.querySelectorAll("br,p,div,tr").length,
        ) >= quoteLines
      ) {
        const details = doc.createElement("details"),
          summary = doc.createElement("summary");
        summary.textContent = label;
        quote.before(details);
        details.append(summary, quote);
      }
    });
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: ${remote ? "https: http:" : ""}; style-src 'unsafe-inline';"><style>body{font:15px/1.7 Arial,sans-serif;margin:20px;color:${dark ? "#e4ebf7" : "#283c57"};background:${dark ? "#182438" : "#fff"};overflow-wrap:anywhere}img,table{max-width:100%}a{color:#3477d4}summary{cursor:pointer;color:#3477d4}blockquote{margin-left:14px;border-left:3px solid #8090a7;padding-left:15px}</style></head><body>${doc.body.innerHTML}</body></html>`;
}
function AttachedImage({ detail, attachment }) {
  const { user } = useStore();
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (user.demo) return;
    const controller = new AbortController();
    let objectUrl;
    fetch(
      `/api/attachment?${new URLSearchParams({ folder: detail.folder, uid: detail.uid, index: attachment.index })}`,
      {
        headers: { Authorization: `Bearer ${user.token}` },
        signal: controller.signal,
      },
    )
      .then((r) => {
        if (!r.ok) throw new Error("attachment");
        return r.blob();
      })
      .then((blob) => {
        if (!controller.signal.aborted) {
          objectUrl = URL.createObjectURL(blob);
          setUrl(objectUrl);
        }
      })
      .catch(() => {});
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [user, detail.folder, detail.uid, attachment.index]);
  return url ? (
    <figure className="attached-image">
      <img src={url} alt={attachment.filename} />
      <figcaption>{attachment.filename}</figcaption>
    </figure>
  ) : null;
}
export default function MessageBody({ detail, settings, images, darkMode }) {
  const { t } = useTranslation();
  const text = settings.displayEmoticons
    ? emoticons(detail.text || "")
    : detail.text || "";
  const lines = text.split("\n"),
    firstQuote = lines.findIndex((line) => /^>/.test(line));
  const collapse =
    settings.collapseQuotes > 0 &&
    firstQuote >= 0 &&
    lines.slice(firstQuote).filter((line) => /^>/.test(line)).length >=
      settings.collapseQuotes;
  const remote =
    (images && settings.externalImages !== "never") ||
    settings.externalImages === "always";
  return (
    <>
      {settings.showHtml && detail.html ? (
        <iframe
          title={detail.subject || t("mail")}
          className="mail-frame"
          sandbox="allow-popups allow-popups-to-escape-sandbox"
          referrerPolicy="no-referrer"
          srcDoc={mailDocument(
            detail.html,
            remote,
            darkMode,
            settings.collapseQuotes,
            t("quote"),
          )}
        />
      ) : (
        <div className="plain-mail">
          {collapse ? (
            <>
              {lines.slice(0, firstQuote).join("\n")}
              <details className="quoted-text">
                <summary>{t("quote")}</summary>
                {lines.slice(firstQuote).join("\n")}
              </details>
            </>
          ) : (
            text
          )}
        </div>
      )}
      {settings.inlineAttachments &&
        detail.attachments
          ?.filter(
            (a) =>
              !a.inline && /^image\/(png|jpeg|gif|webp)$/i.test(a.contentType),
          )
          .map((a) => (
            <AttachedImage key={a.index} detail={detail} attachment={a} />
          ))}
    </>
  );
}
