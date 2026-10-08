import { useState } from "react";
import { useTranslation } from "react-i18next";
import { escapeHtml } from "../lib/mailFormatting";
export default function SpellingReview({
  text,
  settings,
  onChange,
  onSend,
  onCancel,
  sending,
}) {
  const { t } = useTranslation();
  const [html] = useState(() =>
    text
      .split(/(\s+)/)
      .map((word) => {
        const skip =
          (settings.spellcheckSkipDigits && /\d/.test(word)) ||
          (settings.spellcheckSkipSymbols &&
            /[^\p{L}\p{N}\s.,!?;:'"-]/u.test(word));
        return `<span spellcheck="${!skip}">${escapeHtml(word)}</span>`;
      })
      .join(""),
  );
  return (
    <div className="spelling-review">
      <h3>{t("spellReview")}</h3>
      <p className="muted">{t("spellHint")}</p>
      <div
        contentEditable
        suppressContentEditableWarning
        spellCheck
        lang={settings.language}
        role="textbox"
        aria-label={t("spellReview")}
        className="spell-editor"
        onInput={(e) => onChange(e.currentTarget.innerText)}
        dangerouslySetInnerHTML={{ __html: html }}
      />
      <button
        type="button"
        className="primary"
        disabled={sending}
        onClick={onSend}
      >
        {t("reviewSend")}
      </button>
      <button type="button" className="text-button" onClick={onCancel}>
        {t("cancel")}
      </button>
    </div>
  );
}
