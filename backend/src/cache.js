const { measure } = require("./diagnosticsTrace");
function createCache(maxEntries = 100) {
  const entries = new Map();
  function cancelled() {
    const error = new Error("Request cancelled");
    error.name = "AbortError";
    error.code = "IMAP_CANCELLED";
    error.status = 499;
    return error;
  }
  function consume(cacheKey, entry, signal) {
    entry.consumers++;
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error, value, aborted = false) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener("abort", abort);
        entry.consumers--;
        if (aborted && entry.pending && !entry.consumers) {
          if (entries.get(cacheKey) === entry) entries.delete(cacheKey);
          entry.controller.abort();
        }
        if (error) reject(error);
        else resolve(value);
      };
      const abort = () => finish(cancelled(), undefined, true);
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
      entry.value.then(
        (value) => finish(null, value),
        (error) => finish(error),
      );
    });
  }
  async function cached(accountId, key, ttl, read, options = {}) {
    if (options.signal?.aborted) throw cancelled();
    const cacheKey = JSON.stringify([accountId, key]);
    const existing = entries.get(cacheKey);
    if (existing && (existing.pending || existing.until > Date.now()))
      return existing.pending
        ? measure("cache_wait", () =>
            consume(cacheKey, existing, options.signal),
          )
        : consume(cacheKey, existing, options.signal);
    if (entries.size >= maxEntries) entries.delete(entries.keys().next().value);
    const entry = {
      accountId,
      pending: true,
      until: 0,
      consumers: 0,
      controller: new AbortController(),
    };
    entry.value = Promise.resolve()
      .then(() => {
        if (entry.controller.signal.aborted) throw cancelled();
        return read(entry.controller.signal);
      })
      .then((value) => {
        entry.pending = false;
        entry.until = Date.now() + ttl;
        return value;
      })
      .catch((error) => {
        if (entries.get(cacheKey) === entry) entries.delete(cacheKey);
        throw error;
      });
    entries.set(cacheKey, entry);
    return consume(cacheKey, entry, options.signal);
  }
  function invalidate(accountId) {
    for (const [key, entry] of entries)
      if (entry.accountId === accountId) entries.delete(key);
  }
  return { cached, invalidate };
}
module.exports = createCache();
module.exports.createCache = createCache;
