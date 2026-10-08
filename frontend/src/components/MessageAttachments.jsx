import { Download, FileText, LoaderCircle, Paperclip } from "lucide-react";
import { useTranslation } from "react-i18next";

export default function MessageAttachments({
  attachments,
  downloading,
  onDownload,
}) {
  const { t } = useTranslation();
  if (!attachments?.length) return null;
  return (
    <section className="message-attachments" aria-label={t("attachments")}>
      <h3>
        <Paperclip size={17} /> {t("attachments")}{" "}
        <span>{attachments.length}</span>
      </h3>
      <div className="message-attachment-grid">
        {attachments.map((attachment) => {
          const busy = downloading.has(attachment.index);
          return (
            <div className="message-attachment-card" key={attachment.index}>
              <FileText size={24} className="attachment-file-icon" />
              <div className="attachment-description">
                <strong title={attachment.filename}>
                  {attachment.filename}
                </strong>
                <small>
                  {Math.max(1, Math.ceil(attachment.size / 1024))} KB
                </small>
              </div>
              <button
                className="attachment-download"
                disabled={busy}
                aria-label={t("downloadAttachment", {
                  filename: attachment.filename,
                })}
                title={t(busy ? "downloading" : "download")}
                onClick={() => onDownload(attachment.index)}
              >
                {busy ? (
                  <LoaderCircle className="spinner" size={18} />
                ) : (
                  <Download size={18} />
                )}
                <span>{t(busy ? "downloading" : "download")}</span>
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
