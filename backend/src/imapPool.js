const crypto = require("node:crypto");
const { currentTrace, measure } = require("./diagnosticsTrace");

function createImapPool(makeClient, idleMs = 90000, limits = {}) {
  const slots = new Map();
  const foregroundMs = limits.foregroundMs ?? 30000;
  const backgroundMs = limits.backgroundMs ?? 60000;
  const closeMs = limits.closeMs ?? 750;
  function failure(code) {
    const error = new Error(
      code === "IMAP_TIMEOUT" ? "mailTimeout" : "Request cancelled",
    );
    error.code = code;
    error.status = code === "IMAP_TIMEOUT" ? 504 : 499;
    return error;
  }
  function forceClose(client) {
    try {
      client?.close();
    } catch {}
  }
  async function close(client) {
    if (!client) return;
    if (!client.usable) return forceClose(client);
    let timer;
    try {
      await Promise.race([
        Promise.resolve().then(() => client.logout()),
        new Promise((resolve) => {
          timer = setTimeout(resolve, closeMs);
        }),
      ]);
    } catch {
    } finally {
      clearTimeout(timer);
      forceClose(client);
    }
  }
  async function withImap(account, fn, options = {}) {
    const trace = currentTrace();
    const finishQueue = trace?.start("queue");
    const key = `${account.id}:${options.background ? "background" : "foreground"}`;
    let slot = slots.get(key);
    if (!slot) {
      slot = { queue: Promise.resolve(), pending: 0 };
      slots.set(key, slot);
    }
    clearTimeout(slot.timer);
    slot.pending++;
    const budget = options.background
      ? backgroundMs
      : options.read
        ? foregroundMs
        : 0;
    const deadline = budget ? Date.now() + budget : Infinity;
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
    let client,
      active = false,
      cancelled = false,
      rejectCancelled;
    const cancelledPromise = new Promise((resolve, reject) => {
      rejectCancelled = reject;
    });
    const cancel = (code) => {
      if (cancelled) return;
      finishQueue?.();
      cancelled = failure(code);
      if (active) {
        if (slot.client === client) slot.client = null;
        forceClose(client);
      }
      rejectCancelled(cancelled);
    };
    const abort = () => cancel("IMAP_CANCELLED");
    const timeout = budget
      ? setTimeout(
          () => cancel("IMAP_TIMEOUT"),
          Math.max(1, deadline - Date.now()),
        )
      : null;
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) abort();
    const work = slot.queue.then(async () => {
      try {
        if (cancelled) throw cancelled;
        finishQueue?.();
        active = true;
        const operation = (async () => {
          client = slot.client;
          if (!client?.usable || slot.fingerprint !== fingerprint) {
            slot.client = null;
            await measure("disconnect", () => close(client), trace);
            if (cancelled) throw cancelled;
            client = makeClient(account);
            slot.client = client;
            slot.fingerprint = fingerprint;
            await measure("connect", () => client.connect(), trace);
          }
          if (cancelled) {
            forceClose(client);
            throw cancelled;
          }
          return measure("operation", () => fn(client), trace);
        })();
        return await Promise.race([operation, cancelledPromise]);
      } catch (error) {
        if (active && slot.client === client) {
          slot.client = null;
          forceClose(client);
        }
        throw error;
      } finally {
        finishQueue?.();
        active = false;
        clearTimeout(timeout);
        options.signal?.removeEventListener("abort", abort);
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
    return Promise.race([work, cancelledPromise]);
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
