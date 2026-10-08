import { useStore } from "./store.js";
export async function api(path, options = {}) {
  const token = useStore.getState().user?.token;
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
  if (response.status === 401) {
    useStore.getState().logout();
    throw new Error("sessionExpired");
  }
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.error || "error");
    error.code = data.code;
    throw error;
  }
  return data;
}
export const post = (path, body, method = "POST") =>
  api(path, { method, body: JSON.stringify(body) });
export const messageKey = (message) =>
  JSON.stringify([message.folder, message.uid]);
export function selectRange(rows, selected, anchor, target, additive = false) {
  const first = rows.findIndex((row) => messageKey(row) === anchor);
  const last = rows.findIndex((row) => messageKey(row) === target);
  if (first < 0 || last < 0) return new Set([target]);
  return new Set([
    ...(additive ? selected : []),
    ...rows
      .slice(Math.min(first, last), Math.max(first, last) + 1)
      .map(messageKey),
  ]);
}
