export function buildFolderTree(folders, hidden = []) {
  const nodes = new Map();
  for (const folder of folders) {
    const delimiter = folder.delimiter || "/";
    const parts = folder.path.split(delimiter);
    for (let i = 1; i <= parts.length; i++) {
      const path = parts.slice(0, i).join(delimiter);
      if (!nodes.has(path))
        nodes.set(path, {
          path,
          name: parts[i - 1],
          delimiter,
          selectable: false,
          synthetic: true,
          children: [],
        });
      if (i === parts.length)
        Object.assign(nodes.get(path), folder, {
          name: parts[i - 1],
          synthetic: false,
          selectable: folder.selectable !== false,
        });
    }
  }
  const roots = [];
  for (const node of nodes.values()) {
    if (
      hidden.some(
        (path) =>
          node.path === path || node.path.startsWith(path + node.delimiter),
      )
    )
      continue;
    const index = node.path.lastIndexOf(node.delimiter);
    const parent = index < 0 ? null : nodes.get(node.path.slice(0, index));
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const rank = {
    "\\Inbox": 0,
    "\\Sent": 1,
    "\\Drafts": 2,
    "\\Archive": 3,
    "\\Junk": 4,
    "\\Trash": 5,
  };
  function sort(branch) {
    branch.sort(
      (a, b) =>
        (rank[a.specialUse] ?? 10) - (rank[b.specialUse] ?? 10) ||
        a.name.localeCompare(b.name, undefined, { numeric: true }),
    );
    branch.forEach((node) => sort(node.children));
  }
  sort(roots);
  return roots;
}
export function canDeleteFolder(folder) {
  return (
    !folder.synthetic &&
    !folder.specialUse &&
    folder.path.toUpperCase() !== "INBOX"
  );
}
