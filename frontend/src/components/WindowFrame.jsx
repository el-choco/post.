import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
export default function WindowFrame({ popup, onClose, children }) {
  const [root] = useState(() => popup.document.createElement("div"));
  useEffect(() => {
    const popupDocument = root.ownerDocument;
    const title = popupDocument.createElement("title");
    title.appendChild(popupDocument.createTextNode("post. · Webmail"));
    popupDocument.head.appendChild(title);
    document
      .querySelectorAll('link[rel="stylesheet"],style')
      .forEach((style) =>
        popup.document.head.appendChild(style.cloneNode(true)),
      );
    popupDocument.documentElement.setAttribute(
      "class",
      document.documentElement.className,
    );
    popupDocument.body.setAttribute("class", "popup-body");
    popupDocument.body.appendChild(root);
    popup.addEventListener("beforeunload", onClose);
    return () => {
      popup.removeEventListener("beforeunload", onClose);
      root.remove();
      // StrictMode reattaches the portal immediately after its development cleanup.
      queueMicrotask(() => {
        if (!root.isConnected && !popup.closed) popup.close();
      });
    };
  }, [popup, root, onClose]);
  return createPortal(children, root);
}
