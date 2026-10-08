import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
export default function Dialog({
  title,
  onClose,
  children,
  wide = false,
  full = false,
}) {
  const ref = useRef();
  const closeRef = useRef(onClose);
  const { t } = useTranslation();
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);
  useEffect(() => {
    const element = ref.current;
    element.showModal();
    const cancel = (event) => {
      event.preventDefault();
      closeRef.current();
    };
    element.addEventListener("cancel", cancel);
    return () => {
      element.removeEventListener("cancel", cancel);
      element.close();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`dialog ${wide ? "wide" : ""} ${full ? "full" : ""}`}
    >
      <header className="dialog-header">
        <h2>{title}</h2>
        <button
          className="icon-button"
          onClick={onClose}
          aria-label={t("close")}
        >
          <X size={20} />
        </button>
      </header>
      {children}
    </dialog>
  );
}
