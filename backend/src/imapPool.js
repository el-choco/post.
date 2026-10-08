const crypto = require("node:crypto");

/** One serialized, reusable connection per account. Never overlap mailbox commands. */
function createImapPool(makeClient, idleMs = 90000) {
  const slots = new Map();
  async function close(client) {
    if (!client) return;
    try {
      await client.logout();
    } catch {
      client.close();
    }
  }
  async function withImap(account, fn) {
    const key = account.id;
    let slot = slots.get(key);
    if (!slot) {
      slot = { queue: Promise.resolve(), pending: 0 };
      slots.set(key, slot);
    }
    clearTimeout(slot.timer);
    slot.pending++;
    const fingerprint = crypto
      .createHash("sha256")
      .update(
        JSON.stringify([
          account.imap_host,
          account.imap_port,
          account.imap_user,
          account.password,
          account.imap_secure,
        ]),
      )
      .digest("hex");
    const work = slot.queue.then(async () => {
      try {
        if (!slot.client?.usable || slot.fingerprint !== fingerprint) {
          await close(slot.client);
          slot.client = makeClient(account);
          slot.fingerprint = fingerprint;
          await slot.client.connect();
        }
        return await fn(slot.client);
      } finally {
        slot.pending--;
        if (!slot.pending) {
          slot.timer = setTimeout(() => {
            if (slot.pending) return;
            slots.delete(key);
            void close(slot.client);
          }, idleMs);
          slot.timer.unref?.();
        }
      }
    });
    slot.queue = work.catch(() => {});
    return work;
  }
  async function closeAll() {
    const active = [...slots.values()];
    slots.clear();
    for (const slot of active) clearTimeout(slot.timer);
    await Promise.all(
      active.map(async (slot) => {
        await slot.queue;
        await close(slot.client);
      }),
    );
  }
  return { withImap, closeAll };
}
module.exports = { createImapPool };
