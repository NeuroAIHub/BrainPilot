import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronRight, File, Folder, Trash2 } from "lucide-react";
import { FileEntry } from "../../contracts/backend";
import { useT } from "../../i18n/useT";
import { api } from "../../utils/api";

type FileNode = FileEntry & {
  path: string;
  children?: FileNode[];
  loaded?: boolean;
};

type QuotaFileManagerProps = {
  sandboxId: string;
};

const rootNode: FileNode = {
  name: "workspace",
  path: "/workspace",
  type: "folder",
  size: 0,
  modified: 0,
  permissions: "",
};

function joinPath(parent: string, name: string) {
  return `${parent.replace(/\/$/, "")}/${name}`;
}

function formatBytes(bytes: number) {
  if (bytes === 0) return "-";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
}

export function QuotaFileManager({ sandboxId }: QuotaFileManagerProps) {
  const t = useT();
  const [tree, setTree] = useState<FileNode>({ ...rootNode });
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set(["/workspace"]));
  const [isDeleting, setIsDeleting] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const loadDirectory = useCallback(
    async (path: string) => {
      setIsLoading(true);
      setError(null);
      try {
        const entries = await api.sandbox.listFiles(sandboxId, path);
        const children = entries.map((e) => ({
          ...e,
          path: joinPath(path, e.name),
        }));
        setTree((current) => updateNodeChildren(current, path, children));
      } catch (err) {
        setError(err instanceof Error ? err.message : t("quota.fm.loadFailed"));
      } finally {
        setIsLoading(false);
      }
    },
    [sandboxId, t]
  );

  useEffect(() => {
    void loadDirectory("/workspace");
  }, [loadDirectory]);

  const toggleFolder = useCallback(
    (node: FileNode) => {
      setExpandedPaths((current) => {
        const next = new Set(current);
        if (next.has(node.path)) {
          next.delete(node.path);
        } else {
          next.add(node.path);
          if (!node.loaded) {
            void loadDirectory(node.path);
          }
        }
        return next;
      });
    },
    [loadDirectory]
  );

  const handleDelete = useCallback(
    async (node: FileNode) => {
      if (!window.confirm(t("quota.fm.confirmDelete", { name: node.name }))) return;
      setIsDeleting((current) => {
        const next = new Set(current);
        next.add(node.path);
        return next;
      });
      setError(null);
      try {
        await api.sandbox.deleteFile(sandboxId, node.path);
        setTree((current) => removeNode(current, node.path));
        setExpandedPaths((current) => {
          const next = new Set(current);
          next.delete(node.path);
          return next;
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : t("quota.fm.deleteFailed"));
      } finally {
        setIsDeleting((current) => {
          const next = new Set(current);
          next.delete(node.path);
          return next;
        });
      }
    },
    [sandboxId, t]
  );

  const renderNode = (node: FileNode, depth = 0): JSX.Element => {
    const isFolder = node.type === "folder";
    const isExpanded = expandedPaths.has(node.path);
    const isRowDeleting = isDeleting.has(node.path);

    return (
      <div className="file-node" key={node.path}>
        <div className="file-row file-row--deletable">
          <button
            className="file-row__open"
            onClick={() => {
              if (isFolder) {
                toggleFolder(node);
              }
            }}
            style={{ marginLeft: depth * 16 }}
            type="button"
          >
            <span className={`file-row__chevron ${isFolder && isExpanded ? "is-expanded" : ""}`}>
              {isFolder ? <ChevronRight size={14} /> : null}
            </span>
            {isFolder ? (
              <Folder size={14} />
            ) : (
              <File size={14} />
            )}
            <span className="file-row__name">{node.name}</span>
            <span className="file-row__size">{formatBytes(node.size)}</span>
          </button>
          <button
            className="file-row__delete"
            disabled={isRowDeleting}
            onClick={() => void handleDelete(node)}
            title={t("quota.fm.delete")}
            type="button"
          >
            <Trash2 size={14} />
          </button>
        </div>
        {isFolder && isExpanded
          ? node.children?.map((child) => renderNode(child, depth + 1))
          : null}
      </div>
    );
  };

  return (
    <div>
      {error ? <p className="quota-file-manager__error">{error}</p> : null}
      {isLoading && tree.children == null ? (
        <p className="file-sidebar__empty">{t("quota.fm.loading")}</p>
      ) : (
        <div className="file-sidebar__tree">{renderNode(tree)}</div>
      )}
    </div>
  );
}

function updateNodeChildren(root: FileNode, targetPath: string, children: FileNode[]): FileNode {
  if (root.path === targetPath) {
    return { ...root, children: [...children], loaded: true };
  }
  if (root.children) {
    return {
      ...root,
      children: root.children.map((child) => updateNodeChildren(child, targetPath, children)),
    };
  }
  return root;
}

function removeNode(root: FileNode, targetPath: string): FileNode {
  if (root.children) {
    const filtered = root.children
      .filter((child) => child.path !== targetPath)
      .map((child) => removeNode(child, targetPath));
    return { ...root, children: filtered };
  }
  return root;
}
