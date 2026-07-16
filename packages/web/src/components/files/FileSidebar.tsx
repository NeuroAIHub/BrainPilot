import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronRight,
  Database,
  Download,
  File,
  FileImage,
  FileText,
  Folder,
  FolderOpen,
  Package,
  Maximize2,
  Minimize2,
  RefreshCw,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { FileContent, FileEntry } from "../../contracts/backend";
import { runtimeConfig } from "../../config";
import { useSandbox } from "../../contexts/SandboxContext";
import { useSessions } from "../../contexts/SessionContext";
import { useT } from "../../i18n/useT";
import { api, isUploadAbortError, type UploadProgress } from "../../utils/api";
import { downloadBlob } from "../../utils/download";
import { createZipBlob, type ZipEntry } from "../../utils/zip";
import { IconButton } from "../primitives/IconButton";
import { UploadProgressBar } from "../primitives/UploadProgressBar";
import { ONE_MB, MAX_BINARY_PREVIEW, formatBytes, formatModified, getPreviewKind, isMarkdown } from "./filePreview";
import { FilePreviewView, PreviewSource } from "./FilePreviewView";

/** #305: in-flight persistent-library upload state for the progress row. */
type DataUploadState = {
  filename: string;
  fileIndex: number;
  fileCount: number;
  fileSize: number;
  percent: number | null;
  phase: UploadProgress["phase"];
};

type FileNode = FileEntry & {
  path: string;
  children?: FileNode[];
  loaded?: boolean;
};

type FileSidebarProps = {
  isOpen: boolean;
  onClose: () => void;
  onResize: (width: number) => void;
  onResizeEnd: () => void;
  onResizeStart: () => void;
  width: number;
};

const MIN_FILE_SIDEBAR_WIDTH = 320;
const MAX_FILE_SIDEBAR_WIDTH = 680;
const MIN_PREVIEW_WIDTH = 360;
const MAX_PREVIEW_WIDTH = 900;
const DEFAULT_PREVIEW_WIDTH = 560;

// #257: the panel shows TWO addressable roots as distinct top-level nodes —
// the per-session workspace (`/workspace`) and the shared cross-session
// persistent library (`/data`). They hang off a synthetic, never-rendered
// container so the existing recursive tree helpers work unchanged.
const WORKSPACE_ROOT_PATH = "/workspace";
const DATA_ROOT_PATH = "/data";

function makeRootTree(): FileNode {
  return {
    name: "",
    path: "", // synthetic container — its children are the rendered roots
    type: "folder",
    size: 0,
    modified: 0,
    permissions: "",
    loaded: true,
    children: [
      { name: "workspace", path: WORKSPACE_ROOT_PATH, type: "folder", size: 0, modified: 0, permissions: "" },
      { name: "data", path: DATA_ROOT_PATH, type: "folder", size: 0, modified: 0, permissions: "" },
    ],
  };
}

function joinPath(parent: string, name: string) {
  return `${parent.replace(/\/$/, "")}/${name}`;
}

function basename(path: string) {
  return path.split("/").filter(Boolean).pop() || "download";
}

function workspaceRelativePath(path: string) {
  if (path === "/workspace") {
    return "workspace";
  }
  return path.startsWith("/workspace/") ? path.slice("/workspace/".length) : path.replace(/^\/+/, "");
}

function removeNestedSelections(paths: string[]): string[] {
  return [...paths]
    .sort((a, b) => a.length - b.length)
    .filter((path, index, sorted) => !sorted.slice(0, index).some((parent) => path.startsWith(`${parent}/`)));
}

/** #307: roots shown as tiers — never deletable from the file tree UI. */
export function isProtectedRoot(path: string): boolean {
  return path === WORKSPACE_ROOT_PATH || path === DATA_ROOT_PATH;
}

/** True when `path` is `deleted` or a descendant of it. */
export function isPathUnderOrEqual(path: string, deleted: string): boolean {
  return path === deleted || path.startsWith(`${deleted}/`);
}

/** Minimal tree shape for `removeNode` (FileNode satisfies this). */
export type PathTreeNode = { path: string; children?: PathTreeNode[] };

/** Drop `targetPath` from the tree (any depth). */
export function removeNode<T extends PathTreeNode>(root: T, targetPath: string): T {
  if (root.children) {
    const filtered = root.children
      .filter((child) => child.path !== targetPath)
      .map((child) => removeNode(child as T, targetPath));
    return { ...root, children: filtered };
  }
  return root;
}

function prunePathsUnder(paths: Set<string>, deleted: string): Set<string> {
  const next = new Set<string>();
  for (const path of paths) {
    if (!isPathUnderOrEqual(path, deleted)) {
      next.add(path);
    }
  }
  return next;
}

function FileIcon({ node }: { node: FileNode }) {
  if (node.type === "folder" || node.type === "symlink") {
    return <Folder size={16} />;
  }
  if (/\.(md|txt|py|yaml|yml|csv|json|ts|tsx|js|jsx)$/i.test(node.name)) {
    return <FileText size={16} />;
  }
  if (/\.(svg|png|jpg|jpeg|gif|webp)$/i.test(node.name)) {
    return <FileImage size={16} />;
  }
  return <File size={16} />;
}

function sortNodes(nodes: FileNode[]): FileNode[] {
  return [...nodes].sort((a, b) => {
    const aIsFolder = a.type === "folder" || a.type === "symlink";
    const bIsFolder = b.type === "folder" || b.type === "symlink";
    if (aIsFolder !== bIsFolder) {
      return aIsFolder ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });
}

function updateNode(root: FileNode, path: string, updater: (node: FileNode) => FileNode): FileNode {
  if (root.path === path) {
    return updater(root);
  }
  return {
    ...root,
    children: root.children?.map((child) => updateNode(child, path, updater)),
  };
}

/**
 * Turn raw runtime upload errors into short, human-readable copy. The runtime
 * returns `file too large: N bytes exceeds limit of M` (#256); without this the
 * long byte strings dominate the sidebar and look like a crash dump.
 */
function formatSidebarError(message: string, t: (key: string, params?: Record<string, string | number>) => string): string {
  const match = message.match(/file too large:\s*(\d+)\s*bytes exceeds limit of\s*(\d+)/i);
  if (match) {
    const size = Number(match[1]);
    const limit = Number(match[2]);
    if (Number.isFinite(size) && Number.isFinite(limit)) {
      return t("files.error.tooLarge", { size: formatBytes(size), limit: formatBytes(limit) });
    }
  }
  // Stream path uses a slightly shorter form before size is known in the catch.
  const streamMatch = message.match(/file too large:\s*exceeds limit of\s*(\d+)/i);
  if (streamMatch) {
    const limit = Number(streamMatch[1]);
    if (Number.isFinite(limit)) {
      return t("files.error.tooLargeLimitOnly", { limit: formatBytes(limit) });
    }
  }
  return message;
}

function findNode(root: FileNode, path: string | null): FileNode | null {
  if (!path) {
    return null;
  }
  if (root.path === path) {
    return root;
  }
  for (const child of root.children ?? []) {
    const found = findNode(child, path);
    if (found) {
      return found;
    }
  }
  return null;
}

export function FileSidebar({ isOpen, onClose, onResize, onResizeEnd, onResizeStart, width }: FileSidebarProps) {
  const { currentSandbox } = useSandbox();
  const { currentSession } = useSessions();
  // The runtime always addresses a workspace by session id (workspaces/<sid>/),
  // never by container id — in both local and remote mode. A container can host
  // several sessions, and the file tree shows the *current session's* workspace.
  // (#168) `currentSandbox.status` still gates whether files are live; the
  // variable name stays `sandboxId` only because the call sites/sub-component
  // prop are named that way — it has always carried the session id in local
  // mode. A full rename rides with the planned session-management cleanup.
  const sandboxId = currentSession?.id ?? null;
  const t = useT();
  const [tree, setTree] = useState<FileNode>(makeRootTree);
  // Both roots start expanded so the two tiers are visible at a glance.
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(
    () => new Set([WORKSPACE_ROOT_PATH, DATA_ROOT_PATH]),
  );
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [selectedContent, setSelectedContent] = useState<FileContent | null>(null);
  const [selectedDownloadPaths, setSelectedDownloadPaths] = useState<Set<string>>(() => new Set());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isDownloadingSelection, setIsDownloadingSelection] = useState(false);
  // #307: paths currently mid-delete (row + batch); disables repeat clicks.
  const [isDeleting, setIsDeleting] = useState<Set<string>>(() => new Set());
  const [isDeletingSelection, setIsDeletingSelection] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPreviewMaximized, setIsPreviewMaximized] = useState(false);
  // #305: replace boolean busy with progress UI state; null = idle.
  const [dataUploadState, setDataUploadState] = useState<DataUploadState | null>(null);
  const dataUploadAbortRef = useRef<AbortController | null>(null);
  const isUploadingToData = dataUploadState != null;
  const resizeStartRef = useRef<{ pointerX: number; width: number } | null>(null);
  const dataUploadInputRef = useRef<HTMLInputElement | null>(null);

  // #156: in local mode, surface the real on-disk workspace dir so users know
  // which directory the agent writes into. `workspacesRoot` comes from the
  // backend (gated to local mode there too); the per-session dir is
  // `<workspacesRoot>/<sessionId>`. Null in hosted mode → keep showing the
  // virtual `/workspace` and never disclose a host path.
  const [workspacesRoot, setWorkspacesRoot] = useState<string | null>(null);
  useEffect(() => {
    if (!runtimeConfig.localMode) return;
    let cancelled = false;
    void api.getInfo().then((info) => {
      if (!cancelled && info.localMode && info.workspacesRoot) {
        setWorkspacesRoot(info.workspacesRoot);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Join with the platform's separator: a Windows root contains "\", a POSIX
  // root "/". Detect from the root itself rather than assuming the host.
  const realWorkspacePath = useMemo(() => {
    if (!workspacesRoot || !currentSession?.id) return null;
    const sepChar = workspacesRoot.includes("\\") && !workspacesRoot.includes("/") ? "\\" : "/";
    return `${workspacesRoot.replace(/[\\/]$/, "")}${sepChar}${currentSession.id}`;
  }, [workspacesRoot, currentSession?.id]);

  // Map a virtual `/workspace[/...]` path to its real on-disk equivalent for
  // display. Returns the original virtual path when no real root is known.
  const toDisplayPath = useCallback(
    (virtualPath: string): string => {
      if (!realWorkspacePath) return virtualPath;
      const sepChar = realWorkspacePath.includes("\\") && !realWorkspacePath.includes("/") ? "\\" : "/";
      if (virtualPath === "/workspace") return realWorkspacePath;
      if (virtualPath.startsWith("/workspace/")) {
        const rel = virtualPath.slice("/workspace/".length).split("/").join(sepChar);
        return `${realWorkspacePath}${sepChar}${rel}`;
      }
      return virtualPath;
    },
    [realWorkspacePath],
  );

  const loadDirectory = useCallback(
    async (path: string) => {
      if (!currentSandbox || currentSandbox.status !== "running" || !sandboxId) {
        // #193 diagnostics: distinguish "panel gated off" from "listed but empty".
        // Logs the exact reason the gate blocked the load so a user (esp. on
        // Windows, where the empty-panel report originates) can paste it back.
        console.warn("[FileSidebar] load skipped — sandbox not ready", {
          path,
          sandboxId,
          hasSandbox: !!currentSandbox,
          sandboxStatus: currentSandbox?.status ?? null,
        });
        setError(t("files.error.notRunning"));
        return;
      }
      setError(null);
      try {
        // #193 diagnostics: log the exact request being addressed so an empty or
        // failing listing can be traced to the real sandboxId + path on the wire.
        console.debug("[FileSidebar] listFiles", { sandboxId, path });
        const entries = await api.sandbox.listFiles(sandboxId, path);
        console.debug("[FileSidebar] listFiles ok", { sandboxId, path, count: entries.length });
        const children = entries.map((entry) => ({ ...entry, path: joinPath(path, entry.name) }));
        setTree((current) => updateNode(current, path, (node) => ({ ...node, children, loaded: true })));
      } catch (err) {
        // The runtime now returns a distinct error (instead of an empty array)
        // when readdir fails for a reason other than ENOENT (#193). Surface it
        // rather than leaving the panel stuck loading with no feedback.
        console.error("[FileSidebar] listFiles failed", { sandboxId, path, error: err });
        setError(err instanceof Error ? err.message : t("files.error.loadFailed"));
      }
    },
    [currentSandbox, sandboxId, t],
  );

  useEffect(() => {
    if (isOpen && currentSandbox?.status === "running") {
      // Load both tiers so each root shows its contents on open.
      void loadDirectory(WORKSPACE_ROOT_PATH);
      void loadDirectory(DATA_ROOT_PATH);
    }
    if (!isOpen || currentSandbox?.status !== "running") {
      setSelectedDownloadPaths(new Set());
      setSelectedPath(null);
      setSelectedContent(null);
      setIsPreviewMaximized(false);
    }
  }, [currentSandbox?.status, isOpen, loadDirectory]);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      if (!resizeStartRef.current) {
        return;
      }
      const delta = resizeStartRef.current.pointerX - event.clientX;
      const nextWidth = Math.max(
        MIN_FILE_SIDEBAR_WIDTH,
        Math.min(MAX_FILE_SIDEBAR_WIDTH, resizeStartRef.current.width + delta),
      );
      onResize(nextWidth);
    };
    const handlePointerUp = () => {
      if (!resizeStartRef.current) {
        return;
      }
      resizeStartRef.current = null;
      onResizeEnd();
    };
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [onResize, onResizeEnd]);

  const selectedNode = useMemo(() => findNode(tree, selectedPath), [selectedPath, tree]);
  const selectedFile = selectedNode?.type === "file" ? selectedNode : null;
  const selectedDownloadCount = selectedDownloadPaths.size;

  const getNodeForPath = useCallback((path: string) => findNode(tree, path), [tree]);

  const loadDirectoryEntries = useCallback(
    async (path: string): Promise<FileNode[]> => {
      if (!sandboxId) {
        throw new Error("No active sandbox");
      }
      const cached = findNode(tree, path);
      if (cached?.loaded && cached.children) {
        return cached.children;
      }
      const entries = await api.sandbox.listFiles(sandboxId, path);
      const children = sortNodes(entries.map((entry) => ({ ...entry, path: joinPath(path, entry.name) })));
      setTree((current) => updateNode(current, path, (node) => ({ ...node, children, loaded: true })));
      return children;
    },
    [sandboxId, tree],
  );

  const collectZipEntries = useCallback(
    async (node: FileNode, zipEntries: ZipEntry[]) => {
      if (!sandboxId) {
        throw new Error("No active sandbox");
      }
      if (node.type === "folder" || node.type === "symlink") {
        const children = sortNodes(await loadDirectoryEntries(node.path));
        if (children.length === 0) {
          zipEntries.push({ path: `${workspaceRelativePath(node.path)}/`, data: new Uint8Array() });
          return;
        }
        for (const child of children) {
          await collectZipEntries(child, zipEntries);
        }
        return;
      }

      const blob = await api.sandbox.readRawFile(sandboxId, node.path);
      zipEntries.push({
        path: workspaceRelativePath(node.path),
        data: new Uint8Array(await blob.arrayBuffer()),
      });
    },
    [sandboxId, loadDirectoryEntries],
  );

  const toggleDownloadSelection = useCallback((path: string) => {
    setSelectedDownloadPaths((current) => {
      const next = new Set(current);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  const clearDownloadSelection = useCallback(() => {
    setSelectedDownloadPaths(new Set());
  }, []);

  /** #307: after a successful delete, drop the node and any dependent UI state. */
  const applyLocalDelete = useCallback(
    (deletedPath: string) => {
      setTree((current) => removeNode(current, deletedPath));
      setExpandedPaths((current) => prunePathsUnder(current, deletedPath));
      setSelectedDownloadPaths((current) => prunePathsUnder(current, deletedPath));
      const closesPreview =
        (selectedPath != null && isPathUnderOrEqual(selectedPath, deletedPath)) ||
        (selectedContent != null && isPathUnderOrEqual(selectedContent.path, deletedPath));
      if (closesPreview) {
        setSelectedPath(null);
        setSelectedContent(null);
        setIsPreviewMaximized(false);
      }
    },
    [selectedPath, selectedContent],
  );

  const markDeleting = useCallback((paths: string[], on: boolean) => {
    setIsDeleting((current) => {
      const next = new Set(current);
      for (const path of paths) {
        if (on) next.add(path);
        else next.delete(path);
      }
      return next;
    });
  }, []);

  const handleDeleteOne = useCallback(
    async (node: FileNode) => {
      if (!sandboxId || isProtectedRoot(node.path) || isDeleting.has(node.path)) {
        return;
      }
      if (!window.confirm(t("files.confirmDelete", { name: node.name }))) {
        return;
      }
      markDeleting([node.path], true);
      setError(null);
      try {
        await api.sandbox.deleteFile(sandboxId, node.path);
        applyLocalDelete(node.path);
      } catch (err) {
        setError(err instanceof Error ? err.message : t("files.error.deleteFailed"));
      } finally {
        markDeleting([node.path], false);
      }
    },
    [sandboxId, isDeleting, t, markDeleting, applyLocalDelete],
  );

  const handleDeleteSelected = useCallback(async () => {
    if (!sandboxId || isDeletingSelection || isDownloadingSelection) {
      return;
    }
    const paths = removeNestedSelections(Array.from(selectedDownloadPaths)).filter(
      (path) => !isProtectedRoot(path),
    );
    if (!paths.length) {
      return;
    }
    if (!window.confirm(t("files.confirmDeleteBatch", { count: paths.length }))) {
      return;
    }
    setIsDeletingSelection(true);
    markDeleting(paths, true);
    setError(null);
    try {
      for (const path of paths) {
        try {
          await api.sandbox.deleteFile(sandboxId, path);
          applyLocalDelete(path);
        } catch (err) {
          setError(err instanceof Error ? err.message : t("files.error.deleteFailed"));
          break;
        }
      }
    } finally {
      markDeleting(paths, false);
      setIsDeletingSelection(false);
    }
  }, [
    sandboxId,
    isDeletingSelection,
    isDownloadingSelection,
    selectedDownloadPaths,
    t,
    markDeleting,
    applyLocalDelete,
  ]);

  const downloadPaths = useCallback(
    async (paths: string[]) => {
      if (!sandboxId || isDownloadingSelection) {
        return;
      }
      const requestedPaths = removeNestedSelections(paths);
      if (!requestedPaths.length) {
        return;
      }

      setIsDownloadingSelection(true);
      setError(null);
      try {
        const nodes = requestedPaths.map((path) => {
          const node = getNodeForPath(path);
          if (!node) {
            throw new Error(`Cannot find ${path}`);
          }
          return node;
        });

        if (nodes.length === 1 && nodes[0].type === "file") {
          const blob = await api.sandbox.readRawFile(sandboxId, nodes[0].path);
          downloadBlob(blob, nodes[0].name);
          return;
        }

        const zipEntries: ZipEntry[] = [];
        for (const node of nodes) {
          await collectZipEntries(node, zipEntries);
        }
        const filename = nodes.length === 1 ? `${basename(nodes[0].path)}.zip` : "workspace-files.zip";
        downloadBlob(createZipBlob(zipEntries), filename);
      } catch (err) {
        setError(err instanceof Error ? err.message : t("files.error.downloadFailed"));
      } finally {
        setIsDownloadingSelection(false);
      }
    },
    [collectZipEntries, sandboxId, getNodeForPath, isDownloadingSelection],
  );

  const refreshFiles = async () => {
    setIsRefreshing(true);
    try {
      const paths = Array.from(expandedPaths);
      for (const path of paths.length ? paths : [WORKSPACE_ROOT_PATH, DATA_ROOT_PATH]) {
        await loadDirectory(path);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("files.error.refreshFailed"));
    } finally {
      setIsRefreshing(false);
    }
  };

  // #257: upload file(s) into the persistent library (/data), then refresh that
  // subtree so they appear. Distinct from the composer's attachment upload —
  // this targets the cross-session root, not the session.
  // #305: sequential multi-file with progress + cancel. Refresh only when at
  // least one file succeeded (including partial batch after cancel).
  const handleDataUpload = async (files: FileList | null) => {
    if (!files || files.length === 0 || !sandboxId) return;
    const list = Array.from(files);
    const controller = new AbortController();
    dataUploadAbortRef.current = controller;
    setError(null);
    let completedCount = 0;
    try {
      for (let i = 0; i < list.length; i++) {
        if (controller.signal.aborted) break;
        const file = list[i]!;
        setDataUploadState({
          filename: file.name,
          fileIndex: i + 1,
          fileCount: list.length,
          fileSize: file.size,
          percent: null,
          phase: "uploading",
        });
        await api.sandbox.uploadFile(sandboxId, `${DATA_ROOT_PATH}/${file.name}`, file, {
          signal: controller.signal,
          onProgress: (p) => {
            setDataUploadState((prev) =>
              prev && prev.filename === file.name
                ? { ...prev, percent: p.percent, phase: p.phase }
                : prev,
            );
          },
        });
        completedCount += 1;
      }
      if (completedCount > 0) {
        setExpandedPaths((current) => new Set(current).add(DATA_ROOT_PATH));
        await loadDirectory(DATA_ROOT_PATH);
      }
    } catch (err) {
      if (!isUploadAbortError(err)) {
        setError(err instanceof Error ? err.message : t("files.error.uploadFailed"));
      }
      // Partial success before a hard failure: still refresh so written files show.
      if (completedCount > 0) {
        setExpandedPaths((current) => new Set(current).add(DATA_ROOT_PATH));
        try {
          await loadDirectory(DATA_ROOT_PATH);
        } catch {
          // loadDirectory already surfaces its own error
        }
      }
    } finally {
      dataUploadAbortRef.current = null;
      setDataUploadState(null);
      if (dataUploadInputRef.current) dataUploadInputRef.current.value = "";
    }
  };

  const cancelDataUpload = () => {
    dataUploadAbortRef.current?.abort();
  };

  const toggleFolder = async (node: FileNode) => {
    setExpandedPaths((current) => {
      const next = new Set(current);
      if (next.has(node.path)) {
        next.delete(node.path);
      } else {
        next.add(node.path);
      }
      return next;
    });
    if (!node.loaded) {
      await loadDirectory(node.path);
    }
  };

  const selectFile = async (node: FileNode) => {
    setSelectedPath(node.path);
    setSelectedContent(null);
    if (!sandboxId) {
      return;
    }
    // Only text files are loaded inline (subject to the 1 MB cap). Binary files
    // (image/pdf/download) are streamed as blobs by FilePreviewPanel regardless
    // of size, so they must NOT short-circuit here.
    if (getPreviewKind(node.name) !== "text" || node.size > ONE_MB) {
      return;
    }
    try {
      setSelectedContent(await api.sandbox.readFile(sandboxId, node.path));
    } catch (err) {
      setSelectedContent({
        path: node.path,
        content: err instanceof Error ? err.message : t("files.error.previewFailed"),
        size: node.size,
      });
    }
  };

  // #257: the two top-level tiers render as labeled section headers (distinct
  // icon + name + description), not as ordinary file rows — so the difference
  // between the session workspace and the persistent library is obvious.
  const renderRootNode = (node: FileNode) => {
    const isWorkspace = node.path === WORKSPACE_ROOT_PATH;
    const isExpanded = expandedPaths.has(node.path);
    const children = node.children ?? [];
    return (
      <div className={`file-tier ${isWorkspace ? "file-tier--workspace" : "file-tier--data"}`} key={node.path}>
        <div className="file-tier__header">
          <button className="file-tier__toggle" type="button" onClick={() => void toggleFolder(node)}>
            <span className={`file-row__chevron ${isExpanded ? "is-expanded" : ""}`}>
              <ChevronRight size={14} />
            </span>
            {isWorkspace ? <FolderOpen size={16} /> : <Database size={16} />}
            <span className="file-tier__name">
              {isWorkspace ? t("files.tier.workspace") : t("files.tier.data")}
            </span>
          </button>
          {isWorkspace ? null : (
            <>
              <input
                ref={dataUploadInputRef}
                type="file"
                multiple
                style={{ display: "none" }}
                onChange={(e) => void handleDataUpload(e.target.files)}
              />
              <IconButton
                label={t("files.aria.uploadToData")}
                onClick={() => dataUploadInputRef.current?.click()}
                disabled={!sandboxId || isUploadingToData}
                className={isUploadingToData ? "is-active" : ""}
              >
                <Upload size={14} />
              </IconButton>
            </>
          )}
        </div>
        {!isWorkspace && dataUploadState ? (
          <div className="file-tier__upload-progress">
            <UploadProgressBar
              filename={dataUploadState.filename}
              fileIndex={dataUploadState.fileIndex}
              fileCount={dataUploadState.fileCount}
              fileSize={dataUploadState.fileSize}
              percent={dataUploadState.percent}
              phase={dataUploadState.phase}
              onCancel={cancelDataUpload}
            />
          </div>
        ) : null}
        <p className="file-tier__hint">
          {isWorkspace ? t("files.tier.workspaceHint") : t("files.tier.dataHint")}
        </p>
        {isExpanded ? (
          children.length > 0 ? (
            children.map((child) => renderNode(child, 1))
          ) : node.loaded ? (
            <p className="file-tier__empty">{t("files.tier.empty")}</p>
          ) : null
        ) : null}
      </div>
    );
  };

  const renderNode = (node: FileNode, depth = 0) => {
    const isFolder = node.type === "folder" || node.type === "symlink";
    const isExpanded = expandedPaths.has(node.path);
    const isSelected = selectedPath === node.path;
    const isDownloadSelected = selectedDownloadPaths.has(node.path);
    const canDelete = !isProtectedRoot(node.path);
    const isRowDeleting = isDeleting.has(node.path);
    const selectionBusy = isDownloadingSelection || isDeletingSelection;

    return (
      <div className="file-node" key={node.path}>
        <div
          className={`file-row ${canDelete ? "file-row--deletable" : ""} ${isSelected ? "is-selected" : ""} ${isDownloadSelected ? "is-download-selected" : ""}`}
        >
          <label className="file-row__check" style={{ marginLeft: 10 + depth * 16 }}>
            <span className="sr-only">{t("files.selectForDownload", { name: node.name })}</span>
            <input
              checked={isDownloadSelected}
              disabled={selectionBusy}
              onChange={() => toggleDownloadSelection(node.path)}
              type="checkbox"
            />
          </label>
          <button
            className="file-row__open"
            onClick={() => {
              if (isFolder) {
                void toggleFolder(node);
              } else {
                void selectFile(node);
              }
            }}
            type="button"
          >
            <span className={`file-row__chevron ${isFolder && isExpanded ? "is-expanded" : ""}`}>
              {isFolder ? <ChevronRight size={14} /> : null}
            </span>
            <FileIcon node={node} />
            <span className="file-row__name">{node.name}</span>
            <span className="file-row__size">{formatBytes(node.size)}</span>
          </button>
          {canDelete ? (
            <button
              className="file-row__delete"
              disabled={isRowDeleting || selectionBusy || !sandboxId || currentSandbox?.status !== "running"}
              onClick={() => void handleDeleteOne(node)}
              title={t("files.delete")}
              aria-label={t("files.aria.delete", { name: node.name })}
              type="button"
            >
              <Trash2 size={14} />
            </button>
          ) : null}
        </div>
        {isFolder && isExpanded ? node.children?.map((child) => renderNode(child, depth + 1)) : null}
      </div>
    );
  };

  return (
    <>
      <aside aria-hidden={!isOpen} aria-label={t("files.aria.sidebar")} className={`file-sidebar ${isOpen ? "is-open" : ""}`}>
        <div
          aria-label={t("files.aria.resizeSidebar")}
          className="file-sidebar__resize-handle"
          onPointerDown={(event) => {
            resizeStartRef.current = { pointerX: event.clientX, width };
            onResizeStart();
          }}
          role="separator"
        />
        <header className="file-sidebar__header">
          <div>
            <span className="file-sidebar__eyebrow">{t("files.eyebrow.workspace")}</span>
            <h2>{t("files.title")}</h2>
          </div>
          <div className="file-sidebar__actions">
            {selectedDownloadCount > 0 ? (
              <div className="file-sidebar__selection-actions">
                <span>{t("files.selectedCount", { count: selectedDownloadCount })}</span>
                <button
                  className="file-sidebar__download-selected"
                  disabled={!currentSandbox || isDownloadingSelection || isDeletingSelection}
                  onClick={() => void downloadPaths(Array.from(selectedDownloadPaths))}
                  type="button"
                >
                  <Package size={14} />
                  <span>{isDownloadingSelection ? t("files.packing") : t("files.download")}</span>
                </button>
                <button
                  className="file-sidebar__delete-selected"
                  disabled={
                    !currentSandbox ||
                    currentSandbox.status !== "running" ||
                    !sandboxId ||
                    isDownloadingSelection ||
                    isDeletingSelection
                  }
                  onClick={() => void handleDeleteSelected()}
                  type="button"
                  title={t("files.aria.deleteSelected")}
                  aria-label={t("files.aria.deleteSelected")}
                >
                  <Trash2 size={14} />
                  <span>{isDeletingSelection ? t("files.deleting") : t("files.delete")}</span>
                </button>
                <IconButton
                  disabled={isDownloadingSelection || isDeletingSelection}
                  label={t("files.aria.clearSelection")}
                  onClick={clearDownloadSelection}
                >
                  <X size={14} />
                </IconButton>
              </div>
            ) : null}
            <IconButton className={isRefreshing ? "is-active" : ""} label={t("files.aria.refresh")} onClick={() => void refreshFiles()}>
              <RefreshCw size={15} />
            </IconButton>
            <IconButton label={t("files.aria.close")} onClick={onClose}>
              <X size={15} />
            </IconButton>
          </div>
        </header>

        <div className="file-sidebar__path">
          <span title={realWorkspacePath ?? "/workspace"}>{realWorkspacePath ?? "/workspace"}</span>
          <small>{currentSandbox?.status === "running" ? t("files.live") : t("files.offline")}</small>
        </div>

        {/*
          Error lives INSIDE the tree scroll region (not as a sibling grid row).
          The sidebar uses `grid-template-rows: auto auto minmax(0, 1fr)` for
          header / path / tree — inserting an error between path and tree steals
          the 1fr track and shoves both file tiers to the bottom of the panel.
        */}
        <div className="file-sidebar__tree" aria-label={t("files.aria.tree")}>
          {error ? (
            <div
              className={`file-sidebar__error${
                error === t("files.error.notRunning") ? " file-sidebar__error--guidance" : ""
              }`}
              role="alert"
            >
              <div className="file-sidebar__error-body">
                <p className="file-sidebar__error-text">{formatSidebarError(error, t)}</p>
                {error === t("files.error.notRunning") ? (
                  <>
                    <p className="file-sidebar__error-hint">{t("files.error.notRunningHint")}</p>
                    <button
                      type="button"
                      className="file-sidebar__error-cta settings-button settings-button--ghost"
                      onClick={onClose}
                    >
                      {t("files.error.notRunningCta")}
                    </button>
                  </>
                ) : null}
              </div>
              <IconButton label={t("files.aria.dismissError")} onClick={() => setError(null)}>
                <X size={14} />
              </IconButton>
            </div>
          ) : null}
          {(tree.children ?? []).map((root) => renderRootNode(root))}
        </div>
      </aside>

      <FilePreviewPanel
        content={selectedContent}
        file={isOpen ? selectedFile : null}
        isMaximized={isPreviewMaximized}
        onClose={() => {
          setSelectedPath(null);
          setSelectedContent(null);
          setIsPreviewMaximized(false);
        }}
        sandboxId={sandboxId}
        toDisplayPath={toDisplayPath}
        onToggleMaximize={() => setIsPreviewMaximized((current) => !current)}
      />
    </>
  );
}

function FilePreviewPanel({
  file,
  content,
  isMaximized,
  onClose,
  sandboxId,
  toDisplayPath,
  onToggleMaximize,
}: {
  file: FileNode | null;
  content: FileContent | null;
  isMaximized: boolean;
  onClose: () => void;
  sandboxId: string | null;
  toDisplayPath: (virtualPath: string) => string;
  onToggleMaximize: () => void;
}) {
  const t = useT();
  const [previewWidth, setPreviewWidth] = useState(DEFAULT_PREVIEW_WIDTH);
  const [isResizingPreview, setIsResizingPreview] = useState(false);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [blobError, setBlobError] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const previewResizeStartRef = useRef<{ pointerX: number; width: number } | null>(null);
  const previewKind = file ? getPreviewKind(file.name) : "download";

  useEffect(() => {
    if (
      !file ||
      !sandboxId ||
      (previewKind !== "image" && previewKind !== "pdf") ||
      file.size > MAX_BINARY_PREVIEW
    ) {
      setBlobUrl(null);
      setBlobError(null);
      return;
    }

    let objectUrl: string | null = null;
    let isCancelled = false;

    setBlobUrl(null);
    setBlobError(null);
    void api.sandbox
      .readRawFile(sandboxId, file.path)
      .then((blob) => {
        if (isCancelled) {
          return;
        }
        objectUrl = URL.createObjectURL(blob);
        setBlobUrl(objectUrl);
      })
      .catch((err) => {
        if (!isCancelled) {
          setBlobError(err instanceof Error ? err.message : t("files.error.loadPreviewFailed"));
        }
      });

    return () => {
      isCancelled = true;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [file?.path, previewKind, sandboxId]);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      if (!previewResizeStartRef.current) {
        return;
      }
      const availableWidth = window.innerWidth - MIN_FILE_SIDEBAR_WIDTH - 80;
      const maxWidth = Math.max(MIN_PREVIEW_WIDTH, Math.min(MAX_PREVIEW_WIDTH, availableWidth));
      const delta = previewResizeStartRef.current.pointerX - event.clientX;
      const nextWidth = Math.max(MIN_PREVIEW_WIDTH, Math.min(maxWidth, previewResizeStartRef.current.width + delta));
      setPreviewWidth(nextWidth);
    };
    const handlePointerUp = () => {
      previewResizeStartRef.current = null;
      setIsResizingPreview(false);
    };
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, []);

  if (!file) {
    return null;
  }

  // Size cap is applied PER TYPE: binary (image/pdf) previews tolerate up to
  // MAX_BINARY_PREVIEW (streamed to a blob); text is held inline so it keeps the
  // 1 MB cap. Classifying by previewKind FIRST is what lets a large PDF/image
  // reach its blob branch instead of being force-classified "tooLarge".
  const previewSource: PreviewSource =
    previewKind === "image"
      ? file.size > MAX_BINARY_PREVIEW
        ? { kind: "tooLarge" }
        : { kind: "image", blobUrl: blobUrl ?? undefined }
      : previewKind === "pdf"
        ? file.size > MAX_BINARY_PREVIEW
          ? { kind: "tooLarge" }
          : { kind: "pdf", blobUrl: blobUrl ?? undefined }
        : previewKind === "download"
          ? { kind: "download" }
          : file.size > ONE_MB
            ? { kind: "tooLarge" }
            : { kind: "text", text: content?.content ?? t("files.preview.loading") };

  const downloadFile = async () => {
    if (!sandboxId) {
      return;
    }
    setIsDownloading(true);
    try {
      const blob = await api.sandbox.readRawFile(sandboxId, file.path);
      downloadBlob(blob, file.name);
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <section
      aria-label={t("files.preview.aria")}
      className={`file-preview-panel is-open ${isMaximized ? "is-maximized" : ""} ${
        isResizingPreview ? "is-resizing" : ""
      }`}
      style={{ "--preview-panel-width": `${previewWidth}px` } as React.CSSProperties}
    >
      <div
        aria-label={t("files.preview.ariaResize")}
        className="file-preview-panel__resize-handle"
        onPointerDown={(event) => {
          if (isMaximized) {
            return;
          }
          previewResizeStartRef.current = { pointerX: event.clientX, width: previewWidth };
          setIsResizingPreview(true);
        }}
        role="separator"
      />
      <div className="file-preview__header">
        <div>
          <span className="file-sidebar__eyebrow">{t("files.preview.eyebrow")}</span>
          <h3>{file.name}</h3>
        </div>
        <div className="file-preview__actions">
          <button className="file-preview__download" disabled={!sandboxId || isDownloading} onClick={() => void downloadFile()} type="button">
            <Download size={14} />
            <span>{isDownloading ? t("files.preview.downloading") : t("files.preview.download")}</span>
          </button>
          <IconButton label={isMaximized ? t("files.preview.restore") : t("files.preview.maximize")} onClick={onToggleMaximize}>
            {isMaximized ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
          </IconButton>
          <IconButton label={t("files.preview.close")} onClick={onClose}>
            <X size={15} />
          </IconButton>
        </div>
      </div>

      <dl className="file-preview__meta">
        <div>
          <dt>{t("files.preview.path")}</dt>
          <dd>{toDisplayPath(file.path)}</dd>
        </div>
        <div>
          <dt>{t("files.preview.size")}</dt>
          <dd>{formatBytes(file.size)}</dd>
        </div>
        <div>
          <dt>{t("files.preview.modified")}</dt>
          <dd>{formatModified(file.modified)}</dd>
        </div>
        <div>
          <dt>{t("files.preview.mode")}</dt>
          <dd>{file.permissions || "-"}</dd>
        </div>
      </dl>

      <FilePreviewView
        name={file.name}
        source={previewSource}
        renderMarkdown={isMarkdown(file.name)}
        error={blobError}
        t={t}
        onDownload={sandboxId ? () => void downloadFile() : undefined}
        isDownloading={isDownloading}
      />
    </section>
  );
}
