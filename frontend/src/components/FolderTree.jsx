import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronRight,
  Folder,
  FolderOpen,
  Inbox,
  Send,
  FileText,
  Archive,
  Trash2,
  ShieldAlert,
} from "lucide-react";
import { buildFolderTree, canDeleteFolder } from "../lib/folders";
const icons = {
  "\\Inbox": Inbox,
  "\\Sent": Send,
  "\\Drafts": FileText,
  "\\Archive": Archive,
  "\\Trash": Trash2,
  "\\Junk": ShieldAlert,
};
export default function FolderTree({
  folders,
  hidden,
  selected,
  search,
  onSelect,
  onDelete,
  realNames = false,
}) {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return new Set(
        JSON.parse(
          localStorage.getItem("collapsedFolders") || '["2025","2026"]',
        ),
      );
    } catch {
      return new Set();
    }
  });
  useEffect(
    () =>
      localStorage.setItem("collapsedFolders", JSON.stringify([...collapsed])),
    [collapsed],
  );
  const selectedDelimiter =
    folders.find((folder) => folder.path === selected)?.delimiter || "/";
  const selectionKey = JSON.stringify([selected, selectedDelimiter]);
  const [revealedSelection, setRevealedSelection] = useState(selectionKey);
  if (revealedSelection !== selectionKey) {
    setRevealedSelection(selectionKey);
    // Reveal a newly selected child, including folders created inside a closed branch.
    setCollapsed((current) => {
      const next = new Set(
        [...current].filter(
          (path) => !selected?.startsWith(path + selectedDelimiter),
        ),
      );
      return next.size === current.size ? current : next;
    });
  }
  const tree = buildFolderTree(folders, hidden);
  const toggle = (path) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  function branch(nodes, depth = 0) {
    return nodes.map((node) => {
      const open = !collapsed.has(node.path);
      const Icon =
        icons[node.specialUse] ||
        (open && node.children.length ? FolderOpen : Folder);
      const label =
        node.specialUse && !realNames
          ? t(
              {
                "\\Inbox": "inbox",
                "\\Sent": "sent",
                "\\Drafts": "drafts",
                "\\Archive": "archive",
                "\\Trash": "trash",
                "\\Junk": "spam",
              }[node.specialUse] || "",
              { defaultValue: node.name },
            )
          : node.name;
      return (
        <div key={node.path} className="tree-branch">
          <div
            className={`folder-tree-row ${selected === node.path && !search ? "active" : ""}`}
            style={{ paddingLeft: 6 + depth * 14 }}
          >
            <button
              className={`tree-toggle ${node.children.length ? "" : "invisible"}`}
              aria-label={t(open ? "collapseFolder" : "expandFolder", {
                name: label,
              })}
              aria-expanded={node.children.length ? open : undefined}
              onClick={() => toggle(node.path)}
              tabIndex={node.children.length ? 0 : -1}
            >
              <ChevronRight size={13} className={open ? "expanded" : ""} />
            </button>
            <button
              className="tree-select"
              title={node.path}
              onClick={() =>
                node.selectable === false
                  ? toggle(node.path)
                  : onSelect(node.path)
              }
            >
              <Icon size={17} />
              <span>{label}</span>
              {node.unseen > 0 && (
                <span className="unread-count">{node.unseen}</span>
              )}
            </button>
            {canDeleteFolder(node) && (
              <button
                className="tree-delete"
                aria-label={t("deleteFolderNamed", { name: node.path })}
                title={t("deleteFolder")}
                onClick={() => onDelete(node)}
              >
                <Trash2 size={13} />
              </button>
            )}
          </div>
          {open && branch(node.children, depth + 1)}
        </div>
      );
    });
  }
  return <div className="folder-list">{branch(tree)}</div>;
}
