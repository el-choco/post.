const { measure } = require("./diagnosticsTrace");
function hasAttachment(node) {
  if (!node) return false;
  if (node.disposition && node.disposition.toLowerCase() === "attachment")
    return true;
  return (node.childNodes || []).some(hasAttachment);
}
function toRow(m, folder) {
  const from = m.envelope?.from?.[0] || {},
    to = m.envelope?.to?.[0] || {};
  return {
    folder,
    uid: m.uid,
    from: { name: from.name || "", address: from.address || "" },
    to: { name: to.name || "", address: to.address || "" },
    subject: m.envelope?.subject || "",
    date: m.envelope?.date || m.internalDate || null,
    size: m.size || 0,
    seen: m.flags?.has("\\Seen") || false,
    flagged: m.flags?.has("\\Flagged") || false,
    attachment: hasAttachment(m.bodyStructure),
  };
}
const fields = {
  uid: true,
  envelope: true,
  flags: true,
  size: true,
  bodyStructure: true,
  internalDate: true,
};
async function fetchRows(client, folder, range, uid = true) {
  if (Array.isArray(range) && !range.length) return [];
  return measure("fetch", async () => {
    const rows = [];
    for await (const message of client.fetch(range, fields, { uid }))
      rows.push(toRow(message, folder));
    return rows.sort(
      (a, b) => new Date(b.date || 0) - new Date(a.date || 0) || b.uid - a.uid,
    );
  });
}
async function messagePage(
  client,
  folder,
  { page, pageSize, filter, hideDeleted },
) {
  const lock = await measure("mailbox_lock", () =>
    client.getMailboxLock(folder, { readOnly: true }),
  );
  try {
    const readStatus = () =>
      measure("status", () =>
        client.status(folder, {
          messages: true,
          unseen: true,
          uidNext: true,
          uidValidity: true,
          highestModseq: true,
        }),
      );
    let status = await readStatus();
    let total, messages;
    if (!hideDeleted && !["read", "unread"].includes(filter)) {
      total = status.messages;
      for (let attempt = 0; attempt < 2; attempt++) {
        const end = total - (page - 1) * pageSize;
        try {
          messages =
            end > 0
              ? await fetchRows(
                  client,
                  folder,
                  `${Math.max(1, end - pageSize + 1)}:${end}`,
                  false,
                )
              : [];
          break;
        } catch (error) {
          if (
            attempt ||
            client.usable === false ||
            client.mailbox.exists === total
          )
            throw error;
          status = await readStatus();
          total = status.messages;
        }
      }
    } else {
      const query =
        filter === "unread"
          ? { seen: false }
          : filter === "read"
            ? { seen: true }
            : { all: true };
      if (hideDeleted) query.deleted = false;
      const uids = (
        (await measure("search", () => client.search(query, { uid: true }))) ||
        []
      ).sort((a, b) => b - a);
      total = uids.length;
      messages = await fetchRows(
        client,
        folder,
        uids.slice((page - 1) * pageSize, page * pageSize),
      );
    }
    return { total, messages, folderStatus: folderState(folder, status) };
  } finally {
    lock.release();
  }
}
function folderState(folder, status) {
  return {
    folder,
    total: status.messages,
    unseen: status.unseen,
    uidNext: status.uidNext,
    uidValidity: String(status.uidValidity ?? ""),
    highestModseq: String(status.highestModseq ?? ""),
  };
}
module.exports = { fetchRows, messagePage, folderState };
