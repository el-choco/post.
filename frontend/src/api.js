import { useStore } from "./store.js";
import { readApiResponse } from "./lib/apiResponse.js";
export async function api(path, options = {}) {
  const token = useStore.getState().user?.token;
  const mail =
    (!options.method || options.method.toUpperCase() === "GET") &&
    /^\/(messages|message|folders|poll|search)([/?]|$)/.test(path);
  const limit =
    options.timeoutMs ??
    (mail ? (/^\/(poll|search)([/?]|$)/.test(path) ? 70000 : 45000) : 0);
  const controller = new AbortController();
  const forwardAbort = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener("abort", forwardAbort, { once: true });
  if (options.signal?.aborted) forwardAbort();
  let timedOut = false;
  const timer = limit
    ? setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, limit)
    : null;
  try {
    const response = await fetch(`/api${path}`, {
      ...options,
      signal: controller.signal,
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
    return await readApiResponse(response);
  } catch (cause) {
    const error =
      timedOut && !options.signal?.aborted
        ? new Error("apiTimeout")
        : cause instanceof TypeError && /fetch|network/i.test(cause.message)
          ? new Error("apiUnavailable")
          : cause;
    error.endpoint = path.split("?")[0];
    throw error;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", forwardAbort);
  }
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
