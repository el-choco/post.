export function fileSize(bytes, locale = "de-DE") {
  if (!Number.isFinite(Number(bytes))) return "–";
  const value = Math.max(0, Number(bytes));
  const unit = Math.min(
    4,
    Math.floor(Math.log(Math.max(1, value)) / Math.log(1024)),
  );
  return (
    new Intl.NumberFormat(locale, {
      maximumFractionDigits: unit ? 1 : 0,
    }).format(value / 1024 ** unit) +
    " " +
    ["B", "KB", "MB", "GB", "TB"][unit]
  );
}
export function uploadPath(value) {
  const result = value.split("/");
  if (
    result.length > 40 ||
    result.some(
      (s) =>
        !s.trim() ||
        s === "." ||
        s === ".." ||
        /[\\/:*?"<>|]/.test(s) ||
        [...s].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127) ||
        /[. ]$/.test(s),
    )
  )
    throw new Error("files.errors.name");
  return result;
}
export function fileSelection(rows, selected, anchor, target, additive) {
  const first = rows.findIndex((r) => r.id === anchor),
    last = rows.findIndex((r) => r.id === target);
  if (first < 0 || last < 0) return new Set([target]);
  return new Set([
    ...(additive ? selected : []),
    ...rows
      .slice(Math.min(first, last), Math.max(first, last) + 1)
      .map((r) => r.id),
  ]);
}
export async function droppedFiles(transfer) {
  const files = [],
    directories = [];
  async function walk(entry, parent = "", depth = 0) {
    if (depth >= 40 || files.length + directories.length >= 10000)
      throw new Error("files.errors.depth");
    const relative = parent + entry.name;
    uploadPath(relative);
    if (entry.isFile)
      files.push({
        file: await new Promise((resolve, reject) =>
          entry.file(resolve, reject),
        ),
        path: relative,
      });
    else if (entry.isDirectory) {
      directories.push(relative);
      const reader = entry.createReader();
      while (true) {
        const entries = await new Promise((resolve, reject) =>
          reader.readEntries(resolve, reject),
        );
        if (!entries.length) break;
        for (const child of entries)
          await walk(child, relative + "/", depth + 1);
      }
    }
  }
  const entries = [...(transfer.items || [])]
    .filter((i) => i.kind === "file")
    .map((i) => i.webkitGetAsEntry?.())
    .filter(Boolean);
  if (entries.length) for (const entry of entries) await walk(entry);
  else for (const file of transfer.files) files.push({ file, path: file.name });
  return { files, directories };
}
export function uploadChunk(path, blob, token, signal, onProgress) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    const abort = () => request.abort();
    if (signal.aborted)
      return reject(new DOMException("Aborted", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    request.open("PUT", "/api" + path);
    request.timeout = 180000;
    request.setRequestHeader("Authorization", "Bearer " + token);
    request.setRequestHeader("Content-Type", "application/octet-stream");
    request.upload.onprogress = (event) => onProgress(event.loaded);
    const done = (fn, value) => {
      signal.removeEventListener("abort", abort);
      fn(value);
    };
    request.onload = () => {
      let data;
      try {
        data = JSON.parse(request.responseText);
      } catch {
        data = {};
      }
      if (request.status >= 200 && request.status < 300) done(resolve, data);
      else done(reject, new Error(data.error || "files.errors.upload"));
    };
    request.onerror = () => done(reject, new Error("files.errors.upload"));
    request.ontimeout = () => done(reject, new Error("files.errors.timeout"));
    request.onabort = () =>
      done(reject, new DOMException("Aborted", "AbortError"));
    request.send(blob);
  });
}
export function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob),
    link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.rel = "noreferrer";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
