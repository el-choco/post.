const oauth = require("./filesOAuth");
const net = require("./filesNetwork");
const storage = require("./filesStorage");
const { fail } = require("./calendarNetwork");
const GOOGLE = "https://www.googleapis.com/drive/v3";
const GRAPH = "https://graph.microsoft.com/v1.0/me/drive";
const fields =
  "id,name,mimeType,size,modifiedTime,parents,trashed,capabilities(canDownload,canEdit,canDelete,canTrash),webViewLink";
const escapeQuery = (s) =>
  String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
function id(value) {
  const result = String(value || "");
  if (!result || result.length > 512 || /[\x00-\x20]/.test(result))
    throw fail("files.errors.input");
  return encodeURIComponent(result);
}
function mapItem(kind, row) {
  return kind === "google"
    ? {
        id: row.id,
        parentId: row.parents?.[0] || "root",
        name: row.name,
        folder: row.mimeType === "application/vnd.google-apps.folder",
        size: Number(row.size || 0),
        mime: row.mimeType,
        modifiedAt: Date.parse(row.modifiedTime) || 0,
        trashed: !!row.trashed,
        readOnly: row.capabilities?.canEdit === false,
        downloadable: row.capabilities?.canDownload !== false,
        native: row.mimeType?.startsWith("application/vnd.google-apps."),
        webUrl: safeWebUrl(row.webViewLink),
      }
    : {
        id: row.id,
        parentId: row.parentReference?.id || "root",
        name: row.name,
        folder: !!row.folder,
        size: row.size || 0,
        mime: row.file?.mimeType || "",
        modifiedAt: Date.parse(row.lastModifiedDateTime) || 0,
        webUrl: safeWebUrl(row.webUrl),
      };
}
function safeWebUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password
      ? url.href
      : "";
  } catch {
    return "";
  }
}
function base(c) {
  return c.kind === "google" ? GOOGLE : GRAPH;
}
async function request(c, url, options = {}) {
  // Authorization headers may only be sent to the actual provider API.
  if (new URL(url).origin !== new URL(base(c)).origin)
    throw fail("files.errors.remote", 502);
  const token = await oauth.credentials(c);
  return net.request(url, {
    ...options,
    headers: {
      ...options.headers,
      Authorization: "Bearer " + token.access_token,
    },
  });
}
async function json(c, url, options = {}) {
  const res = await request(c, url, options),
    text = await net.collect(res);
  net.check(res.statusCode);
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw fail("files.errors.remote", 502);
  }
}
const jsonBody = (method, body) => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
async function root(c) {
  const credentials = await oauth.credentials(c);
  return credentials.rootId;
}
async function rawItem(c, item) {
  const itemId = item === "root" || !item ? await root(c) : item;
  return json(
    c,
    c.kind === "google"
      ? `${GOOGLE}/files/${id(itemId)}?fields=${encodeURIComponent(fields)}`
      : `${GRAPH}/items/${id(itemId)}`,
  );
}
async function item(c, itemId, allowTrash = false) {
  const value = await rawItem(c, itemId);
  if (value.trashed && !allowTrash) throw fail("files.errors.notFound", 404);
  const data = await oauth.credentials(c);
  if (c.kind === "google" && data.oauth.access !== "all") {
    let p = value,
      depth = 0;
    while (p.id !== data.rootId && depth++ < 100) {
      if (!p.parents?.[0]) throw fail("files.errors.notFound", 404);
      p = await rawItem(c, p.parents[0]);
    }
    if (p.id !== data.rootId) throw fail("files.errors.depth");
  }
  return value;
}
async function folder(c, value) {
  const row = await item(c, value || "root");
  if (
    !(c.kind === "google"
      ? row.mimeType === "application/vnd.google-apps.folder"
      : row.folder)
  )
    throw fail("files.errors.notFolder");
  return row.id;
}
async function discover(provider, tokens) {
  const c = { kind: provider };
  const fetchJson = (url, options = {}) =>
    net.json(url, {
      ...options,
      headers: {
        ...options.headers,
        Authorization: "Bearer " + tokens.access_token,
      },
    });
  if (provider === "microsoft") {
    const drive = await fetchJson(GRAPH),
      entry = await fetchJson(GRAPH + "/root");
    return {
      rootId: entry.id,
      driveId: drive.id,
      label: drive.owner?.user?.displayName || "OneDrive",
    };
  }
  if (tokens.oauth.access === "all") {
    const entry = await fetchJson(`${GOOGLE}/files/root?fields=id,name`);
    return { rootId: entry.id, label: "Google Drive" };
  }
  const q =
    "trashed=false and mimeType='application/vnd.google-apps.folder' and appProperties has { key='postFileRoot' and value='1' }";
  const found = await fetchJson(
    `${GOOGLE}/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=100`,
  );
  const entry =
    found.files?.[0] ||
    (await fetchJson(
      GOOGLE + "/files?fields=id,name",
      jsonBody("POST", {
        name: "post. Dateien",
        mimeType: "application/vnd.google-apps.folder",
        appProperties: { postFileRoot: "1" },
      }),
    ));
  return { rootId: entry.id, label: "Google Drive · post." };
}
async function list(
  c,
  {
    parent = "root",
    trash = false,
    query = "",
    cursor = "",
    folders = false,
  } = {},
) {
  if (query.length > 200 || String(cursor).length > 15000)
    throw fail("files.errors.input");
  if (trash && c.kind === "microsoft") throw fail("files.errors.providerTrash");
  const parentId = await folder(c, parent);
  if (c.kind === "google") {
    let q = `trashed=${trash ? "true" : "false"}`;
    // In limited mode, only the dedicated post. tree is exposed, even if Google
    // issued a token with broader grants from a previous authorization.
    if (!trash) q += ` and '${escapeQuery(parentId)}' in parents`;
    if (query) q += ` and name contains '${escapeQuery(query)}'`;
    if (folders) q += " and mimeType='application/vnd.google-apps.folder'";
    const params = new URLSearchParams({
      q,
      fields: `nextPageToken,files(${fields})`,
      pageSize: "200",
      orderBy: "folder,name",
      ...(cursor ? { pageToken: cursor } : {}),
    });
    const result = await json(c, GOOGLE + "/files?" + params);
    let entries = result.files || [];
    if (trash && (await oauth.credentials(c)).oauth.access !== "all") {
      const allowed = [];
      for (const entry of entries) {
        try {
          await item(c, entry.id, true);
          allowed.push(entry);
        } catch (e) {
          if (e.status !== 404) throw e;
        }
      }
      entries = allowed;
    }
    return {
      items: entries.map((r) => mapItem(c.kind, r)),
      next: result.nextPageToken || null,
    };
  }
  const initial = `${GRAPH}/items/${id(parentId)}/children?$top=200`;
  let url = initial;
  if (cursor) {
    const parsed = new URL(cursor);
    if (
      parsed.origin !== "https://graph.microsoft.com" ||
      parsed.pathname !== new URL(initial).pathname
    )
      throw fail("files.errors.input");
    url = parsed.href;
  }
  const result = await json(c, url);
  return {
    items: (result.value || [])
      .filter(
        (r) =>
          (!folders || r.folder) &&
          (!query || r.name.toLowerCase().includes(query.toLowerCase())),
      )
      .map((r) => mapItem(c.kind, r)),
    next: result["@odata.nextLink"] || null,
  };
}
async function findChild(c, parentId, filename) {
  if (c.kind === "google") {
    const q = `trashed=false and '${escapeQuery(parentId)}' in parents and name='${escapeQuery(filename)}'`;
    const result = await json(
      c,
      `${GOOGLE}/files?q=${encodeURIComponent(q)}&fields=files(${fields})&pageSize=100`,
    );
    return result.files?.[0];
  }
  const res = await request(
      c,
      `${GRAPH}/items/${id(parentId)}:/${encodeURIComponent(filename)}`,
    ),
    text = await net.collect(res);
  if (res.statusCode === 404) return null;
  net.check(res.statusCode);
  return JSON.parse(text);
}
async function mkdir(c, parent, relative) {
  let p = await folder(c, parent),
    result;
  for (const filename of storage.parts(relative)) {
    result = await findChild(c, p, filename);
    if (result) {
      if (!mapItem(c.kind, result).folder)
        throw fail("files.errors.conflict", 409);
    } else
      result = await json(
        c,
        c.kind === "google"
          ? GOOGLE + "/files?fields=" + encodeURIComponent(fields)
          : `${GRAPH}/items/${id(p)}/children`,
        jsonBody(
          "POST",
          c.kind === "google"
            ? {
                name: filename,
                mimeType: "application/vnd.google-apps.folder",
                parents: [p],
              }
            : {
                name: filename,
                folder: {},
                "@microsoft.graph.conflictBehavior": "fail",
              },
        ),
      );
    p = result.id;
  }
  return mapItem(c.kind, result);
}
async function breadcrumbs(c, value) {
  const rootId = await root(c);
  let p = value || "root",
    result = [];
  for (
    let depth = 0;
    p && p !== "root" && p !== rootId && depth < 100;
    depth++
  ) {
    const row = await item(c, p);
    result.unshift(mapItem(c.kind, row));
    p = c.kind === "google" ? row.parents?.[0] : row.parentReference?.id;
  }
  return result;
}
async function change(c, itemId, input) {
  const row = await item(c, itemId),
    rootId = await root(c);
  if (row.id === rootId) throw fail("files.errors.input");
  const body = {},
    params = new URLSearchParams({ fields });
  if (input.name !== undefined) body.name = storage.name(input.name);
  const target =
    input.parentId === undefined ? null : await folder(c, input.parentId);
  if (target) {
    if (
      target === row.id ||
      (await breadcrumbs(c, target)).some((p) => p.id === row.id)
    )
      throw fail("files.errors.cycle");
    if (c.kind === "google") {
      params.set("addParents", target);
      if (row.parents?.length)
        params.set("removeParents", row.parents.join(","));
    } else body.parentReference = { id: target };
  }
  const oldParent =
    c.kind === "google" ? row.parents?.[0] : row.parentReference?.id;
  const found = await findChild(c, target || oldParent, body.name || row.name);
  if (found && found.id !== row.id) throw fail("files.errors.conflict", 409);
  const result = await json(
    c,
    c.kind === "google"
      ? `${GOOGLE}/files/${id(row.id)}?${params}`
      : `${GRAPH}/items/${id(row.id)}`,
    jsonBody("PATCH", body),
  );
  return mapItem(c.kind, result);
}
async function remove(c, itemId, restore = false) {
  const row = await item(c, itemId, true);
  if (row.id === (await root(c))) throw fail("files.errors.input");
  if (c.kind === "google")
    return json(
      c,
      `${GOOGLE}/files/${id(row.id)}`,
      jsonBody("PATCH", { trashed: !restore }),
    );
  if (restore) throw fail("files.errors.providerTrash");
  return json(c, `${GRAPH}/items/${id(row.id)}`, { method: "DELETE" });
}
async function download(c, itemId) {
  const row = await item(c, itemId),
    mapped = mapItem(c.kind, row);
  if (mapped.folder) throw fail("files.errors.notFile");
  let url,
    filename = row.name;
  if (c.kind === "google") {
    if (mapped.native) {
      if (
        ![
          "application/vnd.google-apps.document",
          "application/vnd.google-apps.spreadsheet",
          "application/vnd.google-apps.presentation",
          "application/vnd.google-apps.drawing",
        ].includes(row.mimeType)
      )
        throw fail("files.errors.preview");
      url = `${GOOGLE}/files/${id(row.id)}/export?mimeType=application%2Fpdf`;
      filename += ".pdf";
    } else url = `${GOOGLE}/files/${id(row.id)}?alt=media`;
  } else url = `${GRAPH}/items/${id(row.id)}/content`;
  let res = await request(c, url);
  for (
    let redirects = 0;
    [301, 302, 303, 307, 308].includes(res.statusCode) && redirects < 4;
    redirects++
  ) {
    const target = new URL(res.headers.location, url).href;
    res.destroy();
    // Signed download links receive no bearer token, including cross-origin links.
    url = target;
    res = await net.request(target);
  }
  try {
    net.check(res.statusCode);
  } catch (e) {
    res.destroy();
    throw e;
  }
  return {
    stream: res,
    name: filename,
    size: Number(res.headers["content-length"]) || undefined,
  };
}
async function upload(c, row, progress) {
  const parentId = await folder(c, row.parent_id || "root");
  if (await findChild(c, parentId, row.name))
    throw fail("files.errors.conflict", 409);
  let session,
    uploadUrl,
    result,
    offset = 0;
  if (c.kind === "google") {
    session = await request(
      c,
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=" +
        encodeURIComponent(fields),
      {
        ...jsonBody("POST", { name: row.name, parents: [parentId] }),
        headers: {
          "Content-Type": "application/json",
          "X-Upload-Content-Type": row.mime,
          "X-Upload-Content-Length": String(row.size),
        },
      },
    );
    await net.collect(session);
    net.check(session.statusCode);
    uploadUrl = session.headers.location;
    if (
      !uploadUrl ||
      new URL(uploadUrl).origin !== "https://www.googleapis.com"
    )
      throw fail("files.errors.remote", 502);
  } else {
    if (!row.size) {
      result = await json(
        c,
        `${GRAPH}/items/${id(parentId)}:/${encodeURIComponent(row.name)}:/content?@microsoft.graph.conflictBehavior=fail`,
        {
          method: "PUT",
          headers: { "Content-Type": row.mime },
          body: Buffer.alloc(0),
        },
      );
      return result.id;
    }
    session = await json(
      c,
      `${GRAPH}/items/${id(parentId)}:/${encodeURIComponent(row.name)}:/createUploadSession`,
      jsonBody("POST", {
        item: { name: row.name, "@microsoft.graph.conflictBehavior": "fail" },
      }),
    );
    uploadUrl = session.uploadUrl;
  }
  const send = async (bytes) => {
    const opts = {
      method: "PUT",
      headers: {
        "Content-Type": row.mime,
        "Content-Length": String(bytes.length),
        "Content-Range": row.size
          ? `bytes ${offset}-${offset + bytes.length - 1}/${row.size}`
          : "bytes */0",
      },
      body: bytes,
    };
    const res =
      c.kind === "google"
        ? await request(c, uploadUrl, opts)
        : await net.request(uploadUrl, opts);
    const text = await net.collect(res);
    offset += bytes.length;
    if (c.kind === "google" && offset < row.size && res.statusCode === 308) {
      await progress(offset);
      return;
    }
    net.check(res.statusCode);
    if (text) {
      try {
        result = JSON.parse(text);
      } catch {
        throw fail("files.errors.remote", 502);
      }
    }
    await progress(offset);
  };
  try {
    if (!row.size) await send(Buffer.alloc(0));
    else
      for await (const bytes of storage.readBlob(row.id, row.key_enc))
        await send(bytes);
    if (!result?.id) throw fail("files.errors.remote", 502);
    return result.id;
  } catch (e) {
    if (c.kind === "microsoft" && uploadUrl) {
      try {
        const res = await net.request(uploadUrl, { method: "DELETE" });
        res.destroy();
      } catch {}
    }
    throw e;
  }
}
async function officeDescriptor(c, itemId) {
  // item() also enforces ownership of the app-scoped Google subtree.
  const row = await item(c, itemId);
  if (c.kind === "google") {
    const res = await request(
      c,
      `${GOOGLE}/files/${id(row.id)}?fields=${encodeURIComponent(fields + ",version,md5Checksum")}`,
    );
    const text = await net.collect(res);
    net.check(res.statusCode);
    let current;
    try {
      current = JSON.parse(text);
    } catch {
      throw fail("files.errors.remote", 502);
    }
    return {
      item: mapItem(c.kind, current),
      revision: {
        version: String(current.version || ""),
        modified: current.modifiedTime,
        size: String(current.size || "0"),
        etag: res.headers.etag || "",
      },
    };
  }
  return {
    item: mapItem(c.kind, row),
    revision: {
      etag: row.eTag || "",
      modified: row.lastModifiedDateTime,
      size: row.size || 0,
    },
  };
}
async function officeReplace(c, itemId, bytes, ext, expected) {
  const current = await officeDescriptor(c, itemId);
  if (
    current.item.folder ||
    current.item.native ||
    current.item.readOnly ||
    JSON.stringify(current.revision) !== JSON.stringify(expected)
  )
    throw fail("office.errors.conflict", 409);
  const mime =
    {
      pdf: "application/pdf",
      docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      odt: "application/vnd.oasis.opendocument.text",
      ods: "application/vnd.oasis.opendocument.spreadsheet",
      odp: "application/vnd.oasis.opendocument.presentation",
      rtf: "application/rtf",
    }[ext] || "application/octet-stream";
  const res = await request(
    c,
    c.kind === "google"
      ? `https://www.googleapis.com/upload/drive/v3/files/${id(itemId)}?uploadType=media&fields=${encodeURIComponent(fields + ",version,md5Checksum")}`
      : `${GRAPH}/items/${id(itemId)}/content`,
    {
      method: c.kind === "google" ? "PATCH" : "PUT",
      headers: {
        "Content-Type": mime,
        "Content-Length": String(bytes.length),
        ...(expected.etag ? { "If-Match": expected.etag } : {}),
      },
      body: bytes,
    },
  );
  const text = await net.collect(res);
  net.check(res.statusCode);
  let row;
  try {
    row = JSON.parse(text);
  } catch {
    throw fail("files.errors.remote", 502);
  }
  return c.kind === "google"
    ? {
        version: String(row.version || ""),
        modified: row.modifiedTime,
        size: String(row.size || "0"),
        etag: res.headers.etag || "",
      }
    : {
        etag: row.eTag || "",
        modified: row.lastModifiedDateTime,
        size: row.size || 0,
      };
}
module.exports = {
  officeDescriptor,
  officeReplace,
  discover,
  list,
  item,
  folder,
  mkdir,
  breadcrumbs,
  change,
  remove,
  download,
  upload,
  mapItem,
  escapeQuery,
};
