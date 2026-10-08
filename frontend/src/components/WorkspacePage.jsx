import { useEffect, useRef } from "react";
import { ArrowLeft } from "lucide-react";
import { useTranslation } from "react-i18next";

export default function WorkspacePage({ title, onBack, children }) {
  const { t } = useTranslation();
  const heading = useRef(null);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, []);
  return (
    <main className="workspace-page">
      <header className="workspace-page-header">
        <button className="secondary" onClick={onBack}>
          <ArrowLeft size={18} />
          {t("backToMail")}
        </button>
        <h1 tabIndex={-1} ref={heading}>
          {title}
        </h1>
      </header>
      {children}
    </main>
  );
}
