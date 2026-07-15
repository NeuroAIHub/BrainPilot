import { describe, it, expect } from "vitest";
import {
  isPathUnderOrEqual,
  isProtectedRoot,
  removeNode,
  type PathTreeNode,
} from "../components/files/FileSidebar";
import { applyMockFileDelete } from "../mocks/backend";
import type { FileEntry } from "../contracts/backend";

describe("FileSidebar delete helpers (#307)", () => {
  it("isProtectedRoot blocks workspace and data roots only", () => {
    expect(isProtectedRoot("/workspace")).toBe(true);
    expect(isProtectedRoot("/data")).toBe(true);
    expect(isProtectedRoot("/workspace/README.md")).toBe(false);
    expect(isProtectedRoot("/data/dataset.csv")).toBe(false);
    expect(isProtectedRoot("/shared")).toBe(false);
  });

  it("isPathUnderOrEqual matches self and descendants", () => {
    expect(isPathUnderOrEqual("/workspace/src", "/workspace/src")).toBe(true);
    expect(isPathUnderOrEqual("/workspace/src/a.py", "/workspace/src")).toBe(true);
    expect(isPathUnderOrEqual("/workspace/src2", "/workspace/src")).toBe(false);
    expect(isPathUnderOrEqual("/workspace/src-backup", "/workspace/src")).toBe(false);
  });

  it("removeNode drops a file and keeps siblings", () => {
    const tree: PathTreeNode = {
      path: "",
      children: [
        {
          path: "/workspace",
          children: [
            { path: "/workspace/README.md" },
            {
              path: "/workspace/src",
              children: [
                { path: "/workspace/src/a.py" },
                { path: "/workspace/src/b.py" },
              ],
            },
          ],
        },
      ],
    };
    const next = removeNode(tree, "/workspace/src/a.py");
    expect(next.children?.[0]?.children?.[1]?.children?.map((c) => c.path)).toEqual([
      "/workspace/src/b.py",
    ]);
  });

  it("removeNode drops a folder node entirely", () => {
    const tree: PathTreeNode = {
      path: "",
      children: [
        {
          path: "/workspace",
          children: [
            { path: "/workspace/README.md" },
            { path: "/workspace/src", children: [{ path: "/workspace/src/a.py" }] },
          ],
        },
      ],
    };
    const next = removeNode(tree, "/workspace/src");
    expect(next.children?.[0]?.children?.map((c) => c.path)).toEqual(["/workspace/README.md"]);
  });
});

describe("applyMockFileDelete (#307)", () => {
  it("removes a file from parent listing and contents", () => {
    const entries: Record<string, FileEntry[]> = {
      "/workspace": [
        { name: "README.md", type: "file", size: 10, modified: 1, permissions: "rw" },
        { name: "src", type: "folder", size: 0, modified: 1, permissions: "rwx" },
      ],
      "/workspace/src": [
        { name: "a.py", type: "file", size: 5, modified: 1, permissions: "rw" },
      ],
    };
    const contents: Record<string, string> = {
      "/workspace/README.md": "hi",
      "/workspace/src/a.py": "print(1)",
    };

    applyMockFileDelete("/workspace/README.md", entries, contents);

    expect(entries["/workspace"]?.map((e) => e.name)).toEqual(["src"]);
    expect(contents["/workspace/README.md"]).toBeUndefined();
    expect(contents["/workspace/src/a.py"]).toBe("print(1)");
  });

  it("recursively removes a folder listing and descendant contents", () => {
    const entries: Record<string, FileEntry[]> = {
      "/workspace": [
        { name: "README.md", type: "file", size: 10, modified: 1, permissions: "rw" },
        { name: "src", type: "folder", size: 0, modified: 1, permissions: "rwx" },
      ],
      "/workspace/src": [
        { name: "a.py", type: "file", size: 5, modified: 1, permissions: "rw" },
        { name: "nested", type: "folder", size: 0, modified: 1, permissions: "rwx" },
      ],
      "/workspace/src/nested": [
        { name: "b.py", type: "file", size: 3, modified: 1, permissions: "rw" },
      ],
    };
    const contents: Record<string, string> = {
      "/workspace/README.md": "hi",
      "/workspace/src/a.py": "a",
      "/workspace/src/nested/b.py": "b",
    };

    applyMockFileDelete("/workspace/src", entries, contents);

    expect(entries["/workspace"]?.map((e) => e.name)).toEqual(["README.md"]);
    expect(entries["/workspace/src"]).toBeUndefined();
    expect(entries["/workspace/src/nested"]).toBeUndefined();
    expect(contents["/workspace/src/a.py"]).toBeUndefined();
    expect(contents["/workspace/src/nested/b.py"]).toBeUndefined();
    expect(contents["/workspace/README.md"]).toBe("hi");
  });
});
