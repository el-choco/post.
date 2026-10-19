const fs = require("node:fs/promises");
const db = require("./db");
const storage = require("./filesStorage");
const cloud = require("./filesCloud");
const { source } = require("./files");
const { encrypt, decrypt, sha256 } = require("./crypto");
const { fail } = require("./calendarNetwork");

function copyName(filename, number) {
  const dot = filename.lastIndexOf(".");
  const ext =
    dot > 0 && Buffer.byteLength(filename.slice(dot)) <= 50
      ? filename.slice(dot)
      : "";
  const suffix = ` (${number})`;
  const base = [...(ext ? filename.slice(0, dot) : filename)];
  while (Buffer.byteLength(base.join("") + suffix + ext) > 240) base.pop();
  return storage.name(base.join("").trimEnd() + suffix + ext);
}
async function saveAttachment(accountId, attachment, input, mailRef) {
  if (!Buffer.isBuffer(attachment.content)) throw fail("files.errors.input");
  const sourceId = String(input.source || "local");
  const conn = await source(accountId, sourceId);
  const parent = conn
    ? await cloud.folder(conn, input.parentId || "root")
    : await storage.folder(accountId, input.parentId);
  let name = storage.name(input.name ?? attachment.filename ?? "attachment");
  const mode = input.mode || "ask";
  if (!["ask", "copy", "replace"].includes(mode))
    throw fail("files.errors.input");
  if (attachment.content.length > storage.limits().maxFileSize)
    throw fail("files.errors.size", 413);
  return storage.locked(
    `attachment-save:${accountId}:${sourceId}:${parent}`,
    async () => {
      const find = async (filename) =>
        conn
          ? cloud.findChild(conn, parent, filename)
          : db.get(
              "SELECT * FROM file_nodes WHERE account_id=? AND parent_id IS ? AND name=? AND deleted_at IS NULL",
              [accountId, parent, filename],
            );
      const found = await find(name);
      let current;
      if (found) {
        if (conn) current = await cloud.officeDescriptor(conn, found.id);
        else
          current = {
            item: storage.publicNode(found),
            revision: { blob: found.blob_id, modified: found.modified_at },
          };
      }
      const binding = {
        accountId,
        sourceId,
        parent,
        name,
        mailRef,
        hash: sha256(attachment.content),
      };
      const conflict = (changed = false) => {
        const canReplace =
          !!current &&
          !current.item.folder &&
          !current.item.native &&
          !current.item.readOnly &&
          (!conn || !!current.revision.etag);
        const error = fail(
          changed ? "attachmentSave.changed" : "attachmentSave.conflict",
          409,
        );
        error.code = "ATTACHMENT_NAME_CONFLICT";
        error.conflict = {
          name,
          canReplace,
          token: canReplace
            ? encrypt(
                JSON.stringify({
                  ...binding,
                  id: current.item.id,
                  revision: current.revision,
                  expires: Date.now() + 600000,
                }),
              )
            : "",
        };
        return error;
      };
      if (mode === "replace") {
        let confirmed;
        try {
          if (
            typeof input.conflictToken !== "string" ||
            input.conflictToken.length > 10000
          )
            throw Error();
          confirmed = JSON.parse(decrypt(input.conflictToken));
        } catch {
          throw fail("attachmentSave.confirmAgain", 409);
        }
        if (
          confirmed.expires <= Date.now() ||
          !Number.isFinite(confirmed.expires) ||
          Object.entries(binding).some(
            ([key, value]) =>
              JSON.stringify(confirmed[key]) !== JSON.stringify(value),
          )
        )
          throw fail("attachmentSave.confirmAgain", 409);
        if (
          !current ||
          confirmed.id !== current.item.id ||
          JSON.stringify(confirmed.revision) !==
            JSON.stringify(current.revision) ||
          current.item.folder ||
          current.item.native ||
          current.item.readOnly ||
          (conn && !current.revision.etag)
        )
          throw conflict(true);
      } else if (found && mode === "ask") throw conflict();
      else if (found) {
        let number = 1;
        while (number <= 1000 && (await find(copyName(name, number)))) number++;
        if (number > 1000) throw fail("files.errors.conflict", 409);
        name = copyName(name, number);
      }
      const mime = String(
        attachment.contentType || "application/octet-stream",
      ).slice(0, 150);
      let staged;
      try {
        const started = await storage.begin(
          accountId,
          mode === "replace" && !conn ? "attachment-stage" : sourceId,
          { name, parentId: parent, size: attachment.content.length, mime },
        );
        staged = { id: started.id };
        for (
          let offset = 0, index = 0;
          offset < attachment.content.length;
          offset += storage.CHUNK_SIZE, index++
        )
          await storage.chunk(
            accountId,
            started.id,
            index,
            attachment.content.subarray(offset, offset + storage.CHUNK_SIZE),
          );
        staged = await storage.upload(accountId, started.id);
        let resultId;
        if (mode === "replace") {
          if (conn)
            await cloud.replaceFile(
              conn,
              current.item.id,
              attachment.content,
              mime,
              current.revision,
            );
          else
            await storage.replaceContent(
              accountId,
              current.item.id,
              current.revision,
              staged,
              { mime, name, parentId: parent },
            );
          resultId = current.item.id;
        } else if (conn)
          resultId = await cloud.upload(conn, staged, async () => {});
        else resultId = await storage.finishLocal(staged);
        return {
          source: sourceId,
          parentId: parent || "root",
          id: resultId,
          name,
        };
      } finally {
        if (staged) {
          const referenced = await db
            .get("SELECT id FROM file_nodes WHERE blob_id=?", [staged.id])
            .then((row) => !!row)
            .catch(() => null);
          if (referenced !== null) {
            if (!referenced)
              await fs
                .rm(storage.blobPath(staged.id), { force: true })
                .catch(() => {});
            await db
              .run("DELETE FROM file_uploads WHERE id=? AND account_id=?", [
                staged.id,
                accountId,
              ])
              .catch(() => {});
          }
        }
      }
    },
  );
}
module.exports = { saveAttachment, copyName };
