const formats = new Set([
  "pdf",
  "docx",
  "doc",
  "odt",
  "rtf",
  "dotx",
  "xlsx",
  "xls",
  "ods",
  "xltx",
  "pptx",
  "ppt",
  "odp",
  "potx",
]);
export function officeFile(item) {
  if (item.folder || item.native || /^image\/|^text\//.test(item.mime || ""))
    return false;
  return formats.has(
    /\.([a-z0-9]+)$/i.exec(item.name || "")?.[1].toLowerCase(),
  );
}
const scripts = new Map();
export function loadOffice(url) {
  const origin = new URL(url).origin;
  if (!scripts.has(origin))
    scripts.set(
      origin,
      new Promise((resolve, reject) => {
        const script = document.createElement("script");
        const timer = setTimeout(() => {
          scripts.delete(origin);
          script.remove();
          reject(new Error("office.errors.connect"));
        }, 20000);
        script.src = origin + "/web-apps/apps/api/documents/api.js";
        script.onload = () => {
          clearTimeout(timer);
          if (window.DocsAPI?.DocEditor) resolve(window.DocsAPI);
          else reject(new Error("office.errors.connect"));
        };
        script.onerror = () => {
          clearTimeout(timer);
          scripts.delete(origin);
          script.remove();
          reject(new Error("office.errors.connect"));
        };
        document.head.appendChild(script);
      }),
    );
  return scripts.get(origin);
}
