import type { FileEntry } from "../../contracts/backend";

export type FileSidebarTreeNode = FileEntry & {
  path: string;
  children?: FileSidebarTreeNode[];
  loaded?: boolean;
};

const WORKSPACE_ROOT_PATH = "/workspace";
const DATA_ROOT_PATH = "/data";

export function createFileSidebarRoot(): FileSidebarTreeNode {
  return {
    name: "",
    path: "",
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

export function directoryListingChildren(
  path: string,
  entries: ReadonlyArray<FileEntry>,
): FileSidebarTreeNode[] {
  const parent = path.replace(/\/$/, "");
  return entries.map((entry) => ({ ...entry, path: `${parent}/${entry.name}` }));
}

function updateFileSidebarNode(
  root: FileSidebarTreeNode,
  path: string,
  updater: (node: FileSidebarTreeNode) => FileSidebarTreeNode,
): FileSidebarTreeNode {
  if (root.path === path) return updater(root);
  return {
    ...root,
    children: root.children?.map((child) => updateFileSidebarNode(child, path, updater)),
  };
}

export function applyDirectoryListing(
  requestedPath: string,
  entries: ReadonlyArray<FileEntry>,
): (root: FileSidebarTreeNode) => FileSidebarTreeNode {
  const children = directoryListingChildren(requestedPath, entries);
  return (root) => updateFileSidebarNode(root, requestedPath, (node) => ({
    ...node,
    children,
    loaded: true,
  }));
}

export function findFileSidebarNode(
  root: FileSidebarTreeNode,
  path: string | null,
): FileSidebarTreeNode | null {
  if (!path) return null;
  if (root.path === path) return root;
  for (const child of root.children ?? []) {
    const found = findFileSidebarNode(child, path);
    if (found) return found;
  }
  return null;
}
