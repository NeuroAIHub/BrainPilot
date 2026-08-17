import { describe, expect, it } from "vitest";
import {
  applyDirectoryListing,
  createFileSidebarRoot,
  findFileSidebarNode,
  type FileSidebarTreeNode,
} from "../components/files/fileSidebarTree";

function folder(name: string): Omit<FileSidebarTreeNode, "path"> {
  return { name, type: "folder", size: 0, modified: 0, permissions: "700" };
}

function file(name: string): Omit<FileSidebarTreeNode, "path"> {
  return { name, type: "file", size: 10, modified: 0, permissions: "600" };
}

describe("linked-file directory loading", () => {
  it("attaches each delayed directory response to the path requested for that response", () => {
    let tree = createFileSidebarRoot();

    const rootUpdate = applyDirectoryListing("/workspace", [folder("docs")]);
    const docsUpdate = applyDirectoryListing("/workspace/docs", [folder("reports")]);
    const reportsUpdate = applyDirectoryListing("/workspace/docs/reports", [file("data-inventory.md")]);

    tree = rootUpdate(tree);
    tree = docsUpdate(tree);
    tree = reportsUpdate(tree);

    expect(tree.children?.[0]?.children?.map((node) => node.name)).toEqual(["docs"]);
    expect(findFileSidebarNode(tree, "/workspace/docs/reports/data-inventory.md"))
      .toMatchObject({ name: "data-inventory.md", type: "file" });
  });
});
