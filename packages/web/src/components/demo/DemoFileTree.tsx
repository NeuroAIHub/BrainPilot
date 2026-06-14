import { useMemo, useState } from "react";
import { ChevronRight, File, FileImage, FileText, Folder } from "lucide-react";
import type { DemoFile } from "../../contracts/demoBundle";
import { getPreviewKind } from "../files/filePreview";

interface TreeNode {
  name: string;
  path: string;
  isDir: boolean;
  children: TreeNode[];
}

/** Build a nested tree from a flat list of file paths. Folders first, alpha. */
export function buildFileTree(paths: string[]): TreeNode[] {
  const root: TreeNode = { name: "", path: "", isDir: true, children: [] };
  for (const raw of paths) {
    const norm = raw.replace(/^\/+/, "");
    const parts = norm.split("/").filter(Boolean);
    let cursor = root;
    let acc = "";
    parts.forEach((part, idx) => {
      acc = acc ? `${acc}/${part}` : part;
      const isLeaf = idx === parts.length - 1;
      let child = cursor.children.find((c) => c.name === part);
      if (!child) {
        // Preserve the original (possibly leading-slash) path on the leaf so it
        // matches DemoFile.path / artifact paths exactly.
        child = { name: part, path: isLeaf ? raw : acc, isDir: !isLeaf, children: [] };
        cursor.children.push(child);
      }
      if (!isLeaf) {
        child.isDir = true;
      }
      cursor = child;
    });
  }
  sortTree(root);
  return root.children;
}

function sortTree(node: TreeNode) {
  node.children.sort((a, b) => {
    if (a.isDir !== b.isDir) {
      return a.isDir ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });
  node.children.forEach(sortTree);
}

function leafIcon(name: string) {
  const kind = getPreviewKind(name);
  if (kind === "image") {
    return <FileImage size={14} />;
  }
  if (kind === "text") {
    return <FileText size={14} />;
  }
  return <File size={14} />;
}

interface DemoFileTreeProps {
  files: DemoFile[];
  highlightedPaths: Set<string>;
  activePath: string | null;
  onSelect: (path: string) => void;
  emptyLabel: string;
  skippedLabel: string;
  unreadableLabel: string;
}

export function DemoFileTree({ files, highlightedPaths, activePath, onSelect, emptyLabel, skippedLabel, unreadableLabel }: DemoFileTreeProps) {
  const tree = useMemo(() => buildFileTree(files.map((f) => f.path)), [files]);
  const truncated = useMemo(() => new Set(files.filter((f) => f.truncated).map((f) => f.path)), [files]);
  const unreadable = useMemo(
    () => new Set(files.filter((f) => f.reason === "unreadable").map((f) => f.path)),
    [files],
  );
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());

  if (files.length === 0) {
    return <p className="demo-panel__empty">{emptyLabel}</p>;
  }

  const toggle = (path: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const renderNode = (node: TreeNode, depth: number) => {
    const pad = 8 + depth * 14;
    if (node.isDir) {
      const isOpen = !collapsed.has(node.path);
      return (
        <div key={node.path || node.name} className="demo-tree-node">
          <button
            className="demo-tree-row demo-tree-row--dir"
            style={{ paddingLeft: pad }}
            onClick={() => toggle(node.path)}
            type="button"
          >
            <span className={`demo-tree-chevron ${isOpen ? "is-open" : ""}`}>
              <ChevronRight size={13} />
            </span>
            <Folder size={14} />
            <span className="demo-tree-name">{node.name}</span>
          </button>
          {isOpen ? node.children.map((child) => renderNode(child, depth + 1)) : null}
        </div>
      );
    }
    const isSkipped = truncated.has(node.path);
    const isUnreadable = unreadable.has(node.path);
    const isProduced = highlightedPaths.has(node.path);
    const isActive = activePath === node.path;
    return (
      <div key={node.path} className="demo-tree-node">
        <button
          className={`demo-tree-row ${isActive ? "is-active" : ""} ${isProduced ? "is-produced" : ""} ${isSkipped ? "is-skipped" : ""}`}
          style={{ paddingLeft: pad + 13 }}
          disabled={isSkipped && !isUnreadable}
          onClick={() => onSelect(node.path)}
          title={node.path}
          type="button"
        >
          {leafIcon(node.name)}
          <span className="demo-tree-name">{node.name}</span>
          {isUnreadable ? (
            <small className="demo-tree-skip">{unreadableLabel}</small>
          ) : isSkipped ? (
            <small className="demo-tree-skip">{skippedLabel}</small>
          ) : null}
        </button>
      </div>
    );
  };

  return <div className="demo-file-tree">{tree.map((node) => renderNode(node, 0))}</div>;
}
