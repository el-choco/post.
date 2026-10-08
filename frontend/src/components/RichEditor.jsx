import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Bold, Italic, Underline, Link } from "lucide-react";
import { escapeHtml } from "../lib/mailFormatting";
import { cleanEditorHtml } from "../lib/editorHtml";
export default function RichEditor({ html, onChange, settings }) {
  const { t } = useTranslation();
  const ref = useRef(null),
    [initial] = useState(() => cleanEditorHtml(html));
  const change = () =>
    onChange(ref.current.innerText, cleanEditorHtml(ref.current.innerHTML));
  function command(name) {
    ref.current.focus();
    const doc = ref.current.ownerDocument;
    let value = null;
    if (name === "createLink") {
      value = ref.current.ownerDocument.defaultView.prompt(
        t("linkUrl"),
        "https://",
      );
      if (!value || !/^https?:\/\//i.test(value)) return;
    }
    doc.execCommand(name, false, value);
    change();
  }
  return (
    <>
      <div className="rich-toolbar">
        {[
          ["bold", Bold],
          ["italic", Italic],
          ["underline", Underline],
          ["createLink", Link],
        ].map(([key, Icon]) => (
          <button
            key={key}
            type="button"
            className="icon-button"
            title={t(key === "createLink" ? "insertLink" : key)}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => command(key)}
          >
            <Icon size={17} />
          </button>
        ))}
        <span>
          {settings.htmlFont} · {settings.htmlFontSize} px
        </span>
      </div>
      <div
        ref={ref}
        className="compose-body rich-editor"
        role="textbox"
        aria-label={t("body")}
        aria-multiline="true"
        contentEditable
        suppressContentEditableWarning
        spellCheck
        lang={settings.language}
        style={{
          fontFamily: settings.htmlFont,
          fontSize: settings.htmlFontSize,
        }}
        dangerouslySetInnerHTML={{ __html: initial }}
        onInput={change}
        onPaste={(e) => {
          e.preventDefault();
          const data = e.clipboardData;
          const html =
            settings.keepFormatting && data.getData("text/html")
              ? cleanEditorHtml(data.getData("text/html"))
              : escapeHtml(data.getData("text/plain")).replace(/\n/g, "<br>");
          ref.current.ownerDocument.execCommand("insertHTML", false, html);
          change();
        }}
      />
    </>
  );
}
