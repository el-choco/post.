/** Short-lived metadata only; no message bodies or passwords. */
function createCache(maxEntries = 100) {
  const entries = new Map();
  async function cached(accountId, key, ttl, read) {
    const cacheKey = JSON.stringify([accountId, key]);
    const existing = entries.get(cacheKey);
    if (existing && (existing.pending || existing.until > Date.now()))
      return existing.value;
    if (entries.size >= maxEntries) entries.delete(entries.keys().next().value);
    const entry = { accountId, pending: true, until: 0 };
    entry.value = Promise.resolve()
      .then(read)
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
    return entry.value;
  }
  function invalidate(accountId) {
    for (const [key, entry] of entries)
      if (entry.accountId === accountId) entries.delete(key);
  }
  return { cached, invalidate };
}
module.exports = createCache();
module.exports.createCache = createCache;
