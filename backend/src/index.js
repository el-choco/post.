const express = require("express");
const crypto = require("crypto");
const nodemailer = require("nodemailer");
const MailComposer = require("nodemailer/lib/mail-composer");
const { simpleParser } = require("mailparser");
const sanitizeHtml = require("sanitize-html");

const { run, get, all, init } = require("./db");
const { withImap, listFolders, findSpecial, groupItems } = require("./imap");
const { cached, invalidate } = require("./cache");
const { fetchRows, messagePage, folderState } = require("./mailList");
const mailState = require("./mailState");
const diagnostics = require("./diagnostics");
const { createTrace, runTrace, measure } = require("./diagnosticsTrace");
const { saveAttachment } = require("./attachmentFiles");
const {
  readSettings,
  normalizeSettings,
  specialFolder,
  archiveParts,
} = require("./settings");

const app = express();
app.get("/api/health", (req, res) =>
  res.json({ status: "ok", version: require("../package.json").version }),
);
app.set("trust proxy", true);
app.use(express.json({ limit: "40mb" }));
app.use("/api", (req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  const started = Date.now();
  const route = req.originalUrl.split("?")[0];
  req.diagnosticTrace = createTrace();
  req.requestId = crypto.randomUUID();
  res.setHeader("X-Request-ID", req.requestId);
  const controller = new AbortController();
  req.imapSignal = controller.signal;
  let recorded = false;
  const record = (status, code) => {
    if (
      recorded ||
      !req.account ||
      req.method !== "GET" ||
      !diagnostics.routes.has(route)
    )
      return;
    recorded = true;
    void diagnostics.record(req.account.id, {
      route,
      status,
      source: "backend",
      requestId: req.requestId,
      durationMs: Date.now() - started,
      errorCode: code || req.diagnosticTrace.errorCode,
      stages: req.diagnosticTrace.snapshot(),
    });
  };
  res.once("close", () => {
    if (!res.writableEnded) {
      record(499, "CLIENT_ABORT");
      controller.abort();
    }
  });
  res.on("finish", () => {
    record(
      res.statusCode,
      req.diagnosticTrace.errorCode ||
        (res.statusCode >= 400 ? "HTTP_ERROR" : ""),
    );
    const durationMs = Date.now() - started;
    if (
      durationMs >= 3000 &&
      /^\/api\/(messages|message|folders|poll|search|attachment|source)(\/|$)/.test(
        route,
      )
    ) {
      console.info(
        JSON.stringify({
          event: "slow_mail_api",
          requestId: req.requestId,
          method: req.method,
          route,
          status: res.statusCode,
          durationMs,
        }),
      );
    }
    if (
      req.account &&
      req.method !== "GET" &&
      res.statusCode < 400 &&
      /^\/api\/(folders|messages|send)/.test(req.originalUrl.split("?")[0])
    )
      invalidate(req.account.id);
  });
  runTrace(req.diagnosticTrace, next);
});

const PORT = process.env.PORT || 3000;
const SELF_SIGNED = process.env.ALLOW_SELF_SIGNED === "true";

const wrap = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

const identity = require("./identity");
const auth = identity.auth;
app.use("/api", identity.router(wrap));
app.use("/api/mail", require("./mailOAuth").router(auth, wrap));

app.post(
  "/api/logout",
  auth,
  wrap(async (req, res) => {
    const settings = readSettings(req.account);
    if (
      req.account.imap_host &&
      req.user.permissions.mail &&
      (settings.emptyTrashOnLogout !== "never" ||
        settings.expungeInboxOnLogout) &&
      req.body.confirmMaintenance !== true
    )
      return res.status(409).json({ error: "maintenanceConfirm" });
    if (
      req.account.imap_host &&
      req.user.permissions.mail &&
      (settings.emptyTrashOnLogout !== "never" || settings.expungeInboxOnLogout)
    )
      await withImap(req.account, async (c) => {
        const folders = await listFolders(c),
          trash = specialFolder(folders, settings, "trashFolder", "\\Trash");
        if (trash && settings.emptyTrashOnLogout !== "never") {
          const lock = await c.getMailboxLock(trash.path);
          try {
            const query =
              settings.emptyTrashOnLogout === "all"
                ? { all: true }
                : {
                    before: new Date(
                      Date.now() -
                        Number(settings.emptyTrashOnLogout) * 86400000,
                    ),
                  };
            const ids = await c.search(query, { uid: true });
            if (ids?.length) await c.messageDelete(ids, { uid: true });
          } finally {
            lock.release();
          }
        }
        if (settings.expungeInboxOnLogout) {
          const lock = await c.getMailboxLock("INBOX");
          try {
            const ids = await c.search({ deleted: true }, { uid: true });
            if (ids?.length) await c.messageDelete(ids, { uid: true });
          } finally {
            lock.release();
          }
        }
      });
    invalidate(req.account.id);
    await run("DELETE FROM sessions WHERE token_hash = ?", [req.tokenHash]);
    res.json({ success: true });
  }),
);

app.get("/api/settings", auth, (req, res) =>
  res.json(readSettings(req.account)),
);

app.put(
  "/api/settings",
  auth,
  wrap(async (req, res) => {
    const merged = normalizeSettings(req.body, readSettings(req.account));
    if (merged.replyTo && !isMail(merged.replyTo))
      return res.status(400).json({ error: "Invalid reply-to address" });
    await run("UPDATE mail_accounts SET settings = ? WHERE id = ?", [
      JSON.stringify(merged),
      req.account.id,
    ]);
    invalidate(req.account.id);
    res.json(merged);
  }),
);

app.post("/api/refresh", auth, (req, res) => {
  invalidate(req.account.id);
  res.json({ success: true });
});

app.get(
  "/api/poll",
  auth,
  wrap(async (req, res) => {
    const settings = readSettings(req.account);
    const data = await withImap(
      req.account,
      async (c) => {
        const folders = settings.checkAllFolders
            ? await listFolders(c)
            : [{ path: "INBOX", selectable: true }],
          states = [],
          skippedFolders = [];
        for (const folder of folders.filter(
          (f) =>
            f.selectable !== false &&
            !["\\All", "\\Flagged"].includes(f.specialUse) &&
            (settings.checkAllFolders || f.path === "INBOX"),
        )) {
          try {
            const status = await measure("status", () =>
              c.status(folder.path, {
                messages: true,
                unseen: true,
                uidNext: true,
                uidValidity: true,
                highestModseq: true,
              }),
            );
            states.push(folderState(folder.path, status));
          } catch {
            skippedFolders.push(folder.path);
          }
        }
        return { states, skippedFolders };
      },
      { background: true, signal: req.imapSignal },
    );
    const changed = mailState.update(req.account.id, data.states);
    if (changed) invalidate(req.account.id);
    res.json({ ...data, changed });
  }),
);

app.get(
  "/api/draft",
  auth,
  wrap(async (req, res) => {
    const row = await get(
      "SELECT content FROM local_drafts WHERE account_id=?",
      [req.account.id],
    );
    res.json(row ? JSON.parse(row.content) : null);
  }),
);
app.put(
  "/api/draft",
  auth,
  wrap(async (req, res) => {
    const keys = [
      "to",
      "cc",
      "bcc",
      "subject",
      "text",
      "html",
      "format",
      "inReplyTo",
      "references",
      "sourceFolder",
      "kind",
    ];
    const draft = {};
    for (const key of keys)
      if (req.body[key] !== undefined) draft[key] = req.body[key];
    const content = JSON.stringify(draft);
    if (content.length > 1000000)
      return res.status(413).json({ error: "draftTooLarge" });
    await run(
      "INSERT INTO local_drafts(account_id,content,updated_at) VALUES(?,?,?) ON CONFLICT(account_id) DO UPDATE SET content=excluded.content,updated_at=excluded.updated_at",
      [req.account.id, content, Date.now()],
    );
    let mailboxSaved = false;
    try {
      mailboxSaved = await syncMailboxDraft(req.account, draft);
    } catch {}
    res.json({ success: true, mailboxSaved });
  }),
);
app.delete(
  "/api/draft",
  auth,
  wrap(async (req, res) => {
    await removeMailboxDraft(req.account).catch(() => {});
    await run("DELETE FROM local_drafts WHERE account_id=?", [req.account.id]);
    res.json({ success: true });
  }),
);

app.get(
  "/api/folders",
  auth,
  wrap(async (req, res) => {
    const folders = await cached(req.account.id, "folders", 120000, () =>
      withImap(req.account, (c) => listFolders(c), { background: true }),
    );
    res.json(mailState.folders(req.account.id, folders));
  }),
);

app.post(
  "/api/folders",
  auth,
  wrap(async (req, res) => {
    const name = String(req.body.name || req.body.path || "").trim();
    const parent = String(req.body.parent || "");
    if (!name || /[\r\n\0]/.test(name) || name.length > 200)
      return res.status(400).json({ error: "folderNameInvalid" });
    const result = await withImap(req.account, async (c) => {
      const folders = await listFolders(c);
      const parentFolder = parent && folders.find((f) => f.path === parent);
      if (parent && !parentFolder) {
        const error = new Error("folderNotFound");
        error.status = 404;
        throw error;
      }
      const delimiter =
        parentFolder?.delimiter ||
        folders.find((f) => f.path === "INBOX")?.delimiter ||
        "/";
      if (name.includes(delimiter)) {
        const error = new Error("folderNameInvalid");
        error.status = 400;
        throw error;
      }
      const path = parent ? `${parent}${delimiter}${name}` : name;
      if (folders.some((f) => f.path === path)) {
        const error = new Error("folderExists");
        error.status = 409;
        throw error;
      }
      await c.mailboxCreate(path);
      try {
        await c.mailboxSubscribe(path);
      } catch {}
      return { path, name, delimiter, selectable: true, unseen: 0, total: 0 };
    });
    res.json(result);
  }),
);

app.delete(
  "/api/folders",
  auth,
  wrap(async (req, res) => {
    const path = String(req.body.path || "");
    if (!path || req.body.confirm !== true)
      return res.status(400).json({ error: "folderDeleteConfirm" });
    const deleted = await withImap(req.account, async (c) => {
      const folders = await listFolders(c);
      const target = folders.find((f) => f.path === path);
      if (!target) {
        const error = new Error("folderNotFound");
        error.status = 404;
        throw error;
      }
      const descendants = folders.filter(
        (f) => f.path === path || f.path.startsWith(path + target.delimiter),
      );
      if (
        descendants.some(
          (f) =>
            f.specialUse ||
            f.path.toUpperCase() === "INBOX" ||
            [
              "draftsFolder",
              "sentFolder",
              "spamFolder",
              "trashFolder",
              "archiveFolder",
            ].some((key) => readSettings(req.account)[key] === f.path),
        )
      ) {
        const error = new Error("systemFolderProtected");
        error.status = 403;
        throw error;
      }
      if (c.mailbox && descendants.some((f) => f.path === c.mailbox.path))
        await c.mailboxClose();
      const removed = [];
      try {
        for (const folder of descendants.sort(
          (a, b) => b.path.length - a.path.length,
        )) {
          await c.mailboxDelete(folder.path);
          removed.push(folder.path);
        }
      } catch (error) {
        invalidate(req.account.id);
        error.message = "folderDeletePartial";
        error.status = 409;
        throw error;
      }
      return removed;
    });
    const settings = readSettings(req.account);
    settings.hiddenFolders = settings.hiddenFolders.filter(
      (path) => !deleted.includes(path),
    );
    if (deleted.includes(settings.archiveFolder)) settings.archiveFolder = "";
    for (const key of [
      "draftsFolder",
      "sentFolder",
      "spamFolder",
      "trashFolder",
    ])
      if (deleted.includes(settings[key])) settings[key] = "";
    await run("UPDATE mail_accounts SET settings=? WHERE id=?", [
      JSON.stringify(settings),
      req.account.id,
    ]);
    res.json({ deleted, settings });
  }),
);

app.get(
  "/api/messages",
  auth,
  wrap(async (req, res) => {
    const folder = String(req.query.folder || "INBOX");
    const pageSize = Math.min(
      200,
      Math.max(5, parseInt(req.query.pageSize, 10) || 25),
    );
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const filter = req.query.filter;
    const hideDeleted = readSettings(req.account).hideDeleted;

    const data = await cached(
      req.account.id,
      JSON.stringify(["messages", folder, page, pageSize, filter, hideDeleted]),
      45000,
      (signal) =>
        withImap(
          req.account,
          async (c) => {
            const result = await messagePage(c, folder, {
              page,
              pageSize,
              filter,
              hideDeleted,
            });
            mailState.update(req.account.id, [result.folderStatus]);
            return result;
          },
          { read: true, signal },
        ),
      { signal: req.imapSignal },
    );
    res.json(data);
  }),
);

function sanitizeMailHtml(html, allowRemote, cidMap) {
  let blocked = false;
  const clean = sanitizeHtml(html, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat([
      "img",
      "center",
      "font",
      "span",
      "div",
      "h1",
      "h2",
      "h3",
      "table",
      "thead",
      "tbody",
      "tfoot",
      "tr",
      "td",
      "th",
      "hr",
    ]),
    allowedAttributes: {
      "*": [
        "style",
        "class",
        "align",
        "valign",
        "width",
        "height",
        "bgcolor",
        "color",
        "dir",
      ],
      a: ["href", "name", "target", "rel"],
      img: ["src", "alt", "width", "height", "style", "data-blocked-src"],
      table: [
        "border",
        "cellpadding",
        "cellspacing",
        "width",
        "style",
        "bgcolor",
        "align",
      ],
      font: ["face", "size", "color"],
    },
    allowedSchemes: ["http", "https", "mailto", "tel"],
    allowedSchemesByTag: { img: ["http", "https", "data"] },
    transformTags: {
      "*": (tagName, attribs) => {
        if (attribs.style && !allowRemote && /url\s*\(/i.test(attribs.style)) {
          blocked = true;
          attribs.style = attribs.style.replace(/url\s*\([^)]*\)/gi, "none");
        }
        if (tagName === "a") {
          attribs.target = "_blank";
          attribs.rel = "noopener noreferrer";
        }
        if (tagName === "img") {
          const src = /^\/\//.test(attribs.src || "")
            ? "https:" + attribs.src
            : attribs.src || "";
          attribs.src = src;
          if (/^cid:/i.test(src)) {
            attribs.src = cidMap[src.slice(4)] || "";
          } else if (/^https?:/i.test(src) && !allowRemote) {
            blocked = true;
            attribs["data-blocked-src"] = src;
            attribs.src = "";
          }
        }
        return { tagName, attribs };
      },
    },
  });
  return { html: clean, blocked };
}

const escapeHtml = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const flatAddr = (x) =>
  []
    .concat(x || [])
    .flatMap((o) => o.value || [])
    .map((a) => ({ name: a.name || "", address: a.address || "" }));
const receiptTarget = (parsed) => {
  const header = parsed.headers.get("disposition-notification-to");
  return (
    flatAddr(header)[0]?.address ||
    (typeof header === "string" ? header.trim() : "")
  );
};

async function readSource(c, folder, uid) {
  const lock = await measure("mailbox_lock", () => c.getMailboxLock(folder));
  try {
    const msg = await measure("source_fetch", () =>
      c.fetchOne(String(uid), { source: true, flags: true }, { uid: true }),
    );
    if (!msg) return null;
    return { source: msg.source, flags: msg.flags };
  } finally {
    lock.release();
  }
}

app.get(
  "/api/message",
  auth,
  wrap(async (req, res) => {
    const folder = String(req.query.folder);
    const uid = parseInt(req.query.uid, 10);
    const settings = readSettings(req.account);
    const allowRemote =
      settings.externalImages === "always" ||
      (settings.externalImages !== "never" && req.query.images === "1");

    const raw = await withImap(
      req.account,
      async (c) => {
        const r = await readSource(c, folder, uid);
        if (
          r &&
          settings.markReadDelay === 0 &&
          req.query.peek !== "1" &&
          !r.flags.has("\\Seen")
        ) {
          const lock = await c.getMailboxLock(folder);
          try {
            await c.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true });
            invalidate(req.account.id);
          } finally {
            lock.release();
          }
        }
        return r;
      },
      { read: true, signal: req.imapSignal },
    );
    if (!raw) {
      invalidate(req.account.id);
      req.diagnosticTrace.errorCode = "MESSAGE_NOT_FOUND";
      return res.status(404).json({
        error: "messageUnavailable",
        code: "MESSAGE_NOT_FOUND",
        requestId: req.requestId,
      });
    }

    const parsed = await measure("parse", () => simpleParser(raw.source));
    const cidMap = {};
    for (const a of parsed.attachments) {
      if (a.cid && /^image\//i.test(a.contentType)) {
        cidMap[a.cid] =
          `data:${a.contentType};base64,${a.content.toString("base64")}`;
      }
    }

    let html;
    let blocked = false;
    if (parsed.html) {
      ({ html, blocked } = sanitizeMailHtml(parsed.html, allowRemote, cidMap));
    } else {
      html = `<pre style="white-space:pre-wrap;font-family:inherit">${escapeHtml(parsed.text || "")}</pre>`;
    }

    res.json({
      folder,
      uid,
      subject: parsed.subject || "",
      from: flatAddr(parsed.from)[0] || { name: "", address: "" },
      to: flatAddr(parsed.to),
      cc: flatAddr(parsed.cc),
      replyTo: flatAddr(parsed.replyTo)[0] || null,
      date: parsed.date || null,
      messageId: parsed.messageId || "",
      references: [].concat(parsed.references || []),
      text: parsed.text || "",
      html,
      remoteImagesBlocked: blocked,
      hasHtml: !!parsed.html,
      seen: raw.flags.has("\\Seen"),
      receiptRequested:
        settings.sendReceipts !== "never" && isMail(receiptTarget(parsed)),
      receiptTo: settings.sendReceipts !== "never" ? receiptTarget(parsed) : "",
      attachments: parsed.attachments.map((a, index) => ({
        index,
        filename: a.filename || "attachment",
        size: a.size,
        contentType: a.contentType,
        inline: !!a.related,
      })),
    });
  }),
);

app.get(
  "/api/attachment",
  auth,
  wrap(async (req, res) => {
    const folder = String(req.query.folder);
    const uid = parseInt(req.query.uid, 10);
    const index = parseInt(req.query.index, 10);
    const raw = await withImap(req.account, (c) => readSource(c, folder, uid));
    if (!raw) return res.status(404).json({ error: "Message not found" });
    const parsed = await simpleParser(raw.source);
    const att = parsed.attachments[index];
    if (!att) return res.status(404).json({ error: "Attachment not found" });
    res.setHeader(
      "Content-Type",
      att.contentType || "application/octet-stream",
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename*=UTF-8''${encodeURIComponent(att.filename || "attachment")}`,
    );
    res.send(att.content);
  }),
);

app.post(
  "/api/attachment/save",
  auth,
  wrap(async (req, res) => {
    const folder = req.body.folder;
    const uid = req.body.uid;
    const index = req.body.index;
    if (
      typeof folder !== "string" ||
      !folder ||
      folder.length > 4096 ||
      !Number.isSafeInteger(uid) ||
      uid <= 0 ||
      !Number.isSafeInteger(index) ||
      index < 0
    )
      return res.status(400).json({ error: "files.errors.input" });
    const raw = await withImap(req.account, (c) => readSource(c, folder, uid), {
      read: true,
      signal: req.imapSignal,
    });
    if (!raw)
      return res
        .status(404)
        .json({ error: "messageUnavailable", code: "MESSAGE_NOT_FOUND" });
    const parsed = await simpleParser(raw.source);
    const attachment = parsed.attachments[index];
    if (!attachment)
      return res.status(404).json({ error: "attachmentSave.notFound" });
    try {
      res.json(
        await saveAttachment(req.account.id, attachment, req.body, [
          folder,
          uid,
          index,
        ]),
      );
    } catch (error) {
      if (error.code !== "ATTACHMENT_NAME_CONFLICT") throw error;
      res.status(409).json({
        error: error.message,
        code: error.code,
        conflict: error.conflict,
      });
    }
  }),
);

app.get(
  "/api/source",
  auth,
  wrap(async (req, res) => {
    const folder = String(req.query.folder);
    const uid = parseInt(req.query.uid, 10);
    const raw = await withImap(req.account, (c) => readSource(c, folder, uid));
    if (!raw) return res.status(404).json({ error: "Message not found" });
    if (req.query.download === "1") {
      res.setHeader("Content-Type", "message/rfc822");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="message-${uid}.eml"`,
      );
    } else {
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
    }
    res.send(raw.source);
  }),
);

async function forEachFolder(req, fn) {
  const groups = groupItems(req.body.items);
  if (!groups.size) {
    const error = new Error("No valid messages selected");
    error.status = 400;
    throw error;
  }
  await withImap(req.account, async (c) => {
    for (const [folder, uids] of groups) {
      const lock = await c.getMailboxLock(folder);
      try {
        await fn(c, folder, uids);
      } finally {
        lock.release();
      }
    }
  });
}

app.post(
  "/api/messages/flags",
  auth,
  wrap(async (req, res) => {
    const add = (req.body.add || []).filter((f) => typeof f === "string");
    const remove = (req.body.remove || []).filter((f) => typeof f === "string");
    await forEachFolder(req, async (c, folder, uids) => {
      if (add.length) await c.messageFlagsAdd(uids, add, { uid: true });
      if (remove.length)
        await c.messageFlagsRemove(uids, remove, { uid: true });
    });
    res.json({ success: true });
  }),
);

app.post(
  "/api/messages/move",
  auth,
  wrap(async (req, res) => {
    const dest = String(req.body.dest || "");
    if (!dest) return res.status(400).json({ error: "Missing destination" });
    await forEachFolder(req, async (c, folder, uids) => {
      if (folder !== dest) await c.messageMove(uids, dest, { uid: true });
    });
    res.json({ success: true });
  }),
);

app.post(
  "/api/messages/delete",
  auth,
  wrap(async (req, res) => {
    const folders = await withImap(req.account, (c) => listFolders(c));
    const settings = readSettings(req.account);
    const trash = specialFolder(folders, settings, "trashFolder", "\\Trash");
    const spam = specialFolder(folders, settings, "spamFolder", "\\Junk");
    await forEachFolder(req, async (c, folder, uids) => {
      if (settings.readOnDelete)
        await c.messageFlagsAdd(uids, ["\\Seen"], { uid: true });
      if (settings.flagDeleted)
        await c.messageFlagsAdd(uids, ["\\Deleted"], { uid: true });
      else if (
        !trash ||
        folder === trash.path ||
        (settings.deleteSpamDirectly && folder === spam?.path)
      ) {
        if (req.body.confirmPermanent !== true) {
          const error = new Error("permanentDelete");
          error.status = 409;
          throw error;
        }
        await c.messageDelete(uids, { uid: true });
      } else await c.messageMove(uids, trash.path, { uid: true });
    });
    res.json({ success: true });
  }),
);

app.post(
  "/api/messages/archive",
  auth,
  wrap(async (req, res) => {
    const settings = readSettings(req.account);
    const dest = settings.archiveFolder;
    if (!dest)
      return res
        .status(400)
        .json({ error: "No archive folder configured", code: "no_archive" });
    await forEachFolder(req, async (c, folder, uids) => {
      if (settings.readOnArchive)
        await c.messageFlagsAdd(uids, ["\\Seen"], { uid: true });
      if (settings.archiveStructure === "none") {
        if (folder !== dest) await c.messageMove(uids, dest, { uid: true });
        return;
      }
      const folders = await listFolders(c),
        delimiter = folders.find((f) => f.path === dest)?.delimiter || "/";
      const known = new Set(folders.map((f) => f.path)),
        groups = new Map(),
        fetched = [];
      for await (const message of c.fetch(
        uids,
        { uid: true, envelope: true, internalDate: true },
        { uid: true },
      ))
        fetched.push(message);
      for (const message of fetched) {
        let path = dest;
        for (const part of archiveParts(settings, message, folder, delimiter)) {
          path += delimiter + part;
          if (!known.has(path)) {
            await c.mailboxCreate(path);
            known.add(path);
          }
        }
        if (!groups.has(path)) groups.set(path, []);
        groups.get(path).push(message.uid);
      }
      for (const [path, ids] of groups)
        if (path !== folder) await c.messageMove(ids, path, { uid: true });
    });
    res.json({ success: true });
  }),
);

app.post(
  "/api/messages/spam",
  auth,
  wrap(async (req, res) => {
    const folders = await withImap(req.account, (c) => listFolders(c));
    const junk = specialFolder(
      folders,
      readSettings(req.account),
      "spamFolder",
      "\\Junk",
    );
    if (!junk)
      return res
        .status(400)
        .json({ error: "No spam folder found", code: "no_junk" });
    await forEachFolder(req, async (c, folder, uids) => {
      const dest = folder === junk.path ? "INBOX" : junk.path;
      await c.messageMove(uids, dest, { uid: true });
    });
    res.json({ success: true });
  }),
);

app.get(
  "/api/search",
  auth,
  wrap(async (req, res) => {
    const q = String(req.query.q || "").trim();
    if (!q) return res.json({ total: 0, messages: [], skippedFolders: [] });
    const field = String(req.query.field || "all");
    const query =
      field === "subject"
        ? { subject: q }
        : field === "from"
          ? { from: q }
          : field === "to"
            ? { to: q }
            : { text: q };
    const hideDeleted = readSettings(req.account).hideDeleted;
    if (hideDeleted) query.deleted = false;
    const pageSize = Math.min(
      200,
      Math.max(5, parseInt(req.query.pageSize, 10) || 25),
    );
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const index = await cached(
      req.account.id,
      JSON.stringify(["search-index", field, q, hideDeleted]),
      45000,
      () =>
        withImap(
          req.account,
          async (c) => {
            const folders = (await listFolders(c)).filter(
              (f) =>
                f.selectable !== false &&
                !["\\All", "\\Flagged"].includes(f.specialUse),
            );
            const hits = [],
              skippedFolders = [];
            for (const folder of folders) {
              try {
                const lock = await c.getMailboxLock(folder.path, {
                  readOnly: true,
                });
                try {
                  const uids = (await c.search(query, { uid: true })) || [];
                  if (uids.length)
                    for await (const message of c.fetch(
                      uids,
                      { uid: true, envelope: true, internalDate: true },
                      { uid: true },
                    )) {
                      hits.push({
                        folder: folder.path,
                        uid: message.uid,
                        date:
                          message.envelope?.date ||
                          message.internalDate ||
                          null,
                      });
                    }
                } finally {
                  lock.release();
                }
              } catch {
                skippedFolders.push(folder.path);
              }
            }
            hits.sort(
              (a, b) =>
                new Date(b.date || 0) - new Date(a.date || 0) ||
                a.folder.localeCompare(b.folder) ||
                b.uid - a.uid,
            );
            return { hits, skippedFolders };
          },
          { background: true },
        ),
    );
    const slice = index.hits.slice((page - 1) * pageSize, page * pageSize);
    const messages = await cached(
      req.account.id,
      JSON.stringify(["search-page", field, q, page, pageSize, hideDeleted]),
      10000,
      () =>
        withImap(
          req.account,
          async (c) => {
            const rows = [];
            for (const [folder, uids] of groupItems(slice)) {
              const lock = await c.getMailboxLock(folder, { readOnly: true });
              try {
                rows.push(...(await fetchRows(c, folder, uids)));
              } finally {
                lock.release();
              }
            }
            const positions = new Map(
              slice.map((hit, i) => [JSON.stringify([hit.folder, hit.uid]), i]),
            );
            return rows.sort(
              (a, b) =>
                positions.get(JSON.stringify([a.folder, a.uid])) -
                positions.get(JSON.stringify([b.folder, b.uid])),
            );
          },
          { read: true },
        ),
    );
    res.json({
      total: index.hits.length,
      messages,
      skippedFolders: index.skippedFolders,
    });
  }),
);

const isMail = (s) => /^[^@\s,;<>]+@[^@\s,;<>]+\.[^@\s,;<>]+$/.test(s);
const cleanList = (v) =>
  (Array.isArray(v) ? v : []).map((s) => String(s).trim()).filter(Boolean);

async function deleteDraftReference(c, reference) {
  if (!reference?.uid) return;
  const status = await c.status(reference.folder, { uidValidity: true });
  if (String(status.uidValidity) !== reference.uid_validity) return;
  const lock = await c.getMailboxLock(reference.folder);
  try {
    const old = await c.fetchOne(
      String(reference.uid),
      { headers: ["x-post-draft-id"] },
      { uid: true },
    );
    if (old?.headers?.toString().includes(reference.marker))
      await c.messageDelete(String(reference.uid), { uid: true });
  } finally {
    lock.release();
  }
}
async function syncMailboxDraft(account, draft) {
  const settings = readSettings(account);
  return withImap(account, async (c) => {
    const previous = await get("SELECT * FROM draft_refs WHERE account_id=?", [
      account.id,
    ]);
    const folders = await listFolders(c),
      folder = specialFolder(folders, settings, "draftsFolder", "\\Drafts");
    if (!folder) return false;
    if (!c.capabilities?.has("UIDPLUS") && !c.capabilities?.has("IMAP4rev2"))
      return false;
    const marker = previous?.marker || crypto.randomUUID();
    const addresses = (key) =>
      String(draft[key] || "")
        .split(/[;,]/)
        .map((v) => v.trim())
        .filter(isMail);
    const raw = await new MailComposer({
      from: { name: settings.name, address: account.email },
      to: addresses("to"),
      cc: addresses("cc"),
      bcc: addresses("bcc"),
      subject: String(draft.subject || ""),
      text: String(draft.text || ""),
      html:
        draft.format === "html" && draft.html
          ? sanitizeMailHtml(String(draft.html), true, {}).html
          : undefined,
      headers: { "X-Post-Draft-ID": marker },
    })
      .compile()
      .build();
    const saved = await c.append(folder.path, raw, ["\\Draft"]);
    if (!saved?.uid) return false;
    const validity = String(
      saved.uidValidity ||
        (await c.status(folder.path, { uidValidity: true })).uidValidity,
    );

    if (previous) await deleteDraftReference(c, previous);
    await run(
      "INSERT INTO draft_refs(account_id,folder,uid,uid_validity,marker) VALUES(?,?,?,?,?) ON CONFLICT(account_id) DO UPDATE SET folder=excluded.folder,uid=excluded.uid,uid_validity=excluded.uid_validity,marker=excluded.marker",
      [account.id, folder.path, saved.uid, validity, marker],
    );
    invalidate(account.id);
    return true;
  });
}
async function removeMailboxDraft(account) {
  const previous = await get("SELECT * FROM draft_refs WHERE account_id=?", [
    account.id,
  ]);
  if (previous)
    await withImap(account, (c) => deleteDraftReference(c, previous));
  await run("DELETE FROM draft_refs WHERE account_id=?", [account.id]);
  invalidate(account.id);
}

app.post(
  "/api/messages/receipt",
  auth,
  wrap(async (req, res) => {
    const settings = readSettings(req.account);
    if (settings.sendReceipts === "never" || req.body.confirm !== true)
      return res.status(400).json({ error: "receiptConfirm" });
    const folder = String(req.body.folder || ""),
      uid = Number(req.body.uid);
    const raw = await withImap(req.account, (c) => readSource(c, folder, uid));
    if (!raw) return res.status(404).json({ error: "Message not found" });
    const parsed = await simpleParser(raw.source),
      target = receiptTarget(parsed);
    if (!isMail(target))
      return res.status(400).json({ error: "receiptUnavailable" });
    const key = JSON.stringify([folder, uid, parsed.messageId || ""]);
    const claimed = await run(
      "INSERT OR IGNORE INTO receipt_log(account_id,message_key,sent_at) VALUES(?,?,?)",
      [req.account.id, key, Date.now()],
    );
    if (!claimed.changes) return res.json({ success: true, alreadySent: true });
    const boundary = "post-" + crypto.randomBytes(16).toString("hex");
    const safe = (s) => String(s || "").replace(/[\r\n]/g, "");
    const message = Buffer.from(
      `From: ${safe(req.account.email)}\r\nTo: ${target}\r\nSubject: Read receipt\r\nMessage-ID: <${crypto.randomUUID()}@${req.account.email.split("@")[1]}>\r\nDate: ${new Date().toUTCString()}\r\nMIME-Version: 1.0\r\nContent-Type: multipart/report; report-type=disposition-notification; boundary="${boundary}"\r\nAuto-Submitted: auto-replied\r\n\r\n--${boundary}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nYour message has been displayed.\r\n--${boundary}\r\nContent-Type: message/disposition-notification\r\n\r\nReporting-UA: post. Webmail\r\nFinal-Recipient: rfc822; ${safe(req.account.email)}\r\nOriginal-Message-ID: ${safe(parsed.messageId)}\r\nDisposition: manual-action/MDN-sent-manually; displayed\r\n\r\n--${boundary}--\r\n`,
    );
    const transport = nodemailer.createTransport({
      host: req.account.smtp_host,
      port: req.account.smtp_port,
      secure: !!req.account.smtp_secure,
      requireTLS: !req.account.smtp_secure,
      auth: req.account.accessToken
        ? {
            type: "OAuth2",
            user: req.account.smtp_user,
            accessToken: req.account.accessToken,
          }
        : { user: req.account.smtp_user, pass: req.account.password },
      tls: { rejectUnauthorized: !SELF_SIGNED },
    });
    try {
      await transport.sendMail({
        envelope: { from: req.account.email, to: [target] },
        raw: message,
      });
    } catch (error) {
      await run(
        "DELETE FROM receipt_log WHERE account_id=? AND message_key=?",
        [req.account.id, key],
      );
      throw error;
    } finally {
      transport.close();
    }
    res.json({ success: true });
  }),
);

app.post(
  "/api/send",
  auth,
  wrap(async (req, res) => {
    const acc = req.account;
    const settings = readSettings(acc);
    const to = cleanList(req.body.to);
    const cc = cleanList(req.body.cc);
    const bcc = cleanList(req.body.bcc);
    const recipients = [...to, ...cc, ...bcc];
    if (!recipients.length || !recipients.every(isMail)) {
      return res
        .status(400)
        .json({ error: "Invalid recipient", code: "recipient" });
    }

    const text = String(req.body.text || "");
    const mail = {
      from: { name: settings.name || "", address: acc.email },
      to,
      cc,
      bcc,
      replyTo: settings.replyTo || undefined,
      subject: String(req.body.subject || ""),
      text,
      html: req.body.html
        ? sanitizeMailHtml(String(req.body.html), true, {}).html
        : undefined,
      headers: req.body.requestMdn
        ? { "Disposition-Notification-To": acc.email }
        : undefined,
      inReplyTo: req.body.inReplyTo || undefined,
      references:
        req.body.references && req.body.references.length
          ? req.body.references
          : undefined,
      attachments: (req.body.attachments || []).map((a) => ({
        filename: a.filename,
        content: Buffer.from(a.content, "base64"),
        contentType: a.contentType || undefined,
      })),
    };
    const raw = await new MailComposer(mail).compile().build();

    const transport = nodemailer.createTransport({
      host: acc.smtp_host,
      port: acc.smtp_port,
      secure: !!acc.smtp_secure,
      requireTLS: !acc.smtp_secure,
      auth: acc.accessToken
        ? { type: "OAuth2", user: acc.smtp_user, accessToken: acc.accessToken }
        : { user: acc.smtp_user, pass: acc.password },
      tls: { rejectUnauthorized: !SELF_SIGNED },
    });
    try {
      await transport.sendMail({
        envelope: { from: acc.email, to: recipients },
        raw,
        dsn: req.body.requestDsn
          ? {
              id: crypto.randomUUID(),
              return: "headers",
              notify: ["success", "failure", "delay"],
            }
          : undefined,
      });
    } finally {
      transport.close();
    }

    if (
      !/gmail|googlemail/i.test(acc.imap_host) ||
      settings.sentFolder ||
      (settings.replySameFolder && req.body.inReplyTo)
    ) {
      try {
        await withImap(acc, async (c) => {
          const folders = await listFolders(c);
          const sent = specialFolder(folders, settings, "sentFolder", "\\Sent");
          const replyFolder =
            settings.replySameFolder &&
            req.body.inReplyTo &&
            folders.find((f) => f.path === req.body.sourceFolder);
          const target = replyFolder || sent;
          if (target) await c.append(target.path, raw, ["\\Seen"]);
        });
      } catch {}
    }
    try {
      if (settings.collectRecipientsBook)
        await require("./contacts").collectAddresses(
          acc.id,
          settings.collectRecipientsBook,
          recipients.map((address) => ({ address })),
        );
    } catch {}
    await removeMailboxDraft(acc).catch(() => {});
    await run("DELETE FROM local_drafts WHERE account_id=?", [acc.id]).catch(
      () => {},
    );
    res.json({ success: true });
  }),
);

app.use("/api", require("./contacts").createContactsRouter(auth, wrap));
app.use(
  "/api/calendar",
  require("./calendar").createCalendarRouter(auth, wrap),
);
app.use("/api/files", require("./fileAcl").router(auth, wrap));
app.use("/api/files", require("./files").createFilesRouter(auth, wrap));
app.use("/api/office", require("./office").createOfficeRouter(auth, wrap));
app.use("/api/diagnostics", diagnostics.createDiagnosticsRouter(auth, wrap));

app.use("/api", (req, res) => res.status(404).json({ error: "Not found" }));

app.use((err, req, res, next) => {
  if (req.diagnosticTrace)
    req.diagnosticTrace.errorCode = diagnostics.errorCode(err);
  if (err.code === "IMAP_CANCELLED" && res.destroyed) return;
  if (!err.status || err.status >= 500) console.error(err);
  if (res.headersSent) return next(err);
  const mailRoute =
    /^\/api\/(messages|message|folders|poll|search|attachment|source)(\/|$)/.test(
      req.originalUrl.split("?")[0],
    );
  const timedOut =
    err.code === "IMAP_TIMEOUT" ||
    (mailRoute && ["ETIMEDOUT", "ETIMEOUT"].includes(err.code));
  const disconnected =
    mailRoute &&
    [
      "ECONNRESET",
      "ECONNREFUSED",
      "ENOTFOUND",
      "EAI_AGAIN",
      "ENETUNREACH",
      "ConnectionClosed",
      "NoConnection",
    ].includes(err.code);
  res.status(timedOut ? 504 : disconnected ? 502 : err.status || 500).json({
    error: timedOut
      ? "mailTimeout"
      : disconnected
        ? "mailConnection"
        : err.responseText || err.message || "Server error",
    requestId: req.requestId,
  });
});

if (require.main === module) {
  init()
    .then(() => {
      setInterval(() => diagnostics.cleanup().catch(() => {}), 3600000).unref();
      setInterval(
        () =>
          require("./filesStorage")
            .cleanup()
            .catch(() => {}),
        15 * 60000,
      ).unref();
      setInterval(
        () =>
          require("./office")
            .cleanup()
            .catch(() => {}),
        15 * 60000,
      ).unref();
      return app.listen(PORT, process.env.HOST || "0.0.0.0", () =>
        console.log(`Backend server running on port ${PORT}`),
      );
    })
    .catch((e) => {
      console.error("Database initialisation failed", e);
      process.exit(1);
    });
}
module.exports = { app, sanitizeMailHtml };
