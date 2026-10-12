const now = Date.now();
const nodes = [
  {
    id: "demo-docs",
    name: "Dokumente",
    folder: true,
    parentId: "root",
    size: 0,
    modifiedAt: now,
  },
  {
    id: "demo-images",
    name: "Bilder",
    folder: true,
    parentId: "root",
    size: 0,
    modifiedAt: now,
  },
  {
    id: "demo-notes",
    name: "Willkommen.txt",
    folder: false,
    parentId: "root",
    size: 116,
    mime: "text/plain",
    modifiedAt: now,
  },
];
const blobs = new Map([
  [
    "demo-notes",
    new Blob(
      [
        "Willkommen bei post. Dateien!\n\nErstelle Ordner, lade Dateien hoch und halte deine Unterlagen an einem Ort.",
      ],
      { type: "text/plain" },
    ),
  ],
]);
export const demoFiles = {
  nodes,
  blobs,
  list(parent, trash, query = "") {
    return nodes.filter(
      (n) =>
        (trash
          ? n.trashed && n.trashRoot === n.id
          : !n.trashed && n.parentId === parent) &&
        n.name.toLowerCase().includes(query.toLowerCase()),
    );
  },
  ancestors(parent) {
    const result = [];
    let p = nodes.find((n) => n.id === parent);
    for (let i = 0; p && i < 100; i++) {
      result.unshift(p);
      p = nodes.find((n) => n.id === p.parentId);
    }
    return result;
  },
  subtree(id) {
    const found = new Set([id]);
    for (let i = 0; i < nodes.length; i++)
      for (const n of nodes) if (found.has(n.parentId)) found.add(n.id);
    return found;
  },
  mkdir(parent, path) {
    let p = parent,
      node;
    for (const name of path.split("/")) {
      node = nodes.find(
        (n) => !n.trashed && n.parentId === p && n.name === name,
      );
      if (node && !node.folder) throw new Error("files.errors.conflict");
      if (!node) {
        node = {
          id: crypto.randomUUID(),
          name,
          folder: true,
          parentId: p,
          size: 0,
          modifiedAt: Date.now(),
        };
        nodes.push(node);
      }
      p = node.id;
    }
    return node;
  },
  upload(parent, file) {
    if (
      nodes.some(
        (n) => !n.trashed && n.parentId === parent && n.name === file.name,
      )
    )
      throw new Error("files.errors.conflict");
    const node = {
      id: crypto.randomUUID(),
      name: file.name,
      parentId: parent,
      folder: false,
      size: file.size,
      mime: file.type,
      modifiedAt: Date.now(),
    };
    nodes.push(node);
    blobs.set(node.id, file);
    return node;
  },
  change(id, values) {
    const node = nodes.find((n) => n.id === id),
      name = values.name || node.name,
      parentId = values.parentId || node.parentId;
    if (node.folder && this.subtree(id).has(parentId))
      throw new Error("files.errors.cycle");
    if (
      nodes.some(
        (n) =>
          !n.trashed &&
          n.id !== id &&
          n.parentId === parentId &&
          n.name === name,
      )
    )
      throw new Error("files.errors.conflict");
    Object.assign(node, values, { modifiedAt: Date.now() });
  },
  trash(id) {
    const ids = this.subtree(id);
    for (const node of nodes)
      if (ids.has(node.id) && !node.trashed)
        Object.assign(node, { trashed: true, trashRoot: id });
  },
  restore(id) {
    const node = nodes.find((n) => n.id === id);
    if (nodes.find((n) => n.id === node.parentId)?.trashed)
      node.parentId = "root";
    if (
      nodes.some(
        (n) =>
          !n.trashed && n.parentId === node.parentId && n.name === node.name,
      )
    )
      node.name += " (1)";
    for (const n of nodes)
      if (n.trashRoot === id)
        Object.assign(n, { trashed: false, trashRoot: null });
  },
  purge(id) {
    const ids = this.subtree(id);
    for (let i = nodes.length - 1; i >= 0; i--)
      if (ids.has(nodes[i].id)) {
        blobs.delete(nodes[i].id);
        nodes.splice(i, 1);
      }
  },
};
