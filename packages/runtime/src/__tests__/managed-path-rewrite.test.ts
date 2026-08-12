/**
 * #346 — logical path rewrite + write confinement for Pi file tools.
 */
import { describe, expect, it } from "vitest";
import { join, resolve } from "node:path";
import {
  applyManagedPathToolCall,
  denyEphemeralWriteReason,
  denyPathEscapeReason,
  denySharedWriteReason,
  denyWriteOutsideDurable,
  isUnderRoot,
  rewriteBashWorkspacePaths,
  rewriteLogicalPath,
  type ManagedPathRoots,
} from "../managed-path-rewrite.js";

const cwd = resolve("/root/.bp-root/workspaces/s1");
const persistentDir = resolve("/root/.bp-root/data");
const sharedDir = resolve("/srv/shared");
const otherSid = resolve("/root/.bp-root/workspaces/s2");

const roots: ManagedPathRoots = { cwd, persistentDir, sharedDir };
const rootsNoShared: ManagedPathRoots = { cwd, persistentDir };

describe("isUnderRoot", () => {
  it("matches the root and descendants only at a path boundary", () => {
    expect(isUnderRoot(cwd, cwd)).toBe(true);
    expect(isUnderRoot(join(cwd, "a", "b.txt"), cwd)).toBe(true);
    expect(isUnderRoot(join(cwd + "-evil", "x"), cwd)).toBe(false);
    expect(isUnderRoot(otherSid, cwd)).toBe(false);
  });
});

describe("rewriteLogicalPath", () => {
  it("rewrites /workspace to a cwd-relative path", () => {
    const r = rewriteLogicalPath("/workspace/EEG_MI/train.py", roots);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rewritten).toBe(true);
    expect(r.root).toBe("workspace");
    expect(r.path).toBe("EEG_MI/train.py");
    expect(r.abs).toBe(resolve(cwd, "EEG_MI/train.py"));
  });

  it("rewrites bare /workspace to '.'", () => {
    const r = rewriteLogicalPath("/workspace", roots);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.path).toBe(".");
    expect(r.abs).toBe(cwd);
  });

  it("rewrites /data to the absolute persistent library path", () => {
    const r = rewriteLogicalPath("/data/lib/set.csv", roots);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rewritten).toBe(true);
    expect(r.root).toBe("data");
    expect(r.path).toBe(resolve(persistentDir, "lib/set.csv"));
    expect(r.abs).toBe(resolve(persistentDir, "lib/set.csv"));
  });

  it("rewrites /attachments under the session .attachments dir", () => {
    const r = rewriteLogicalPath("/attachments/report.pdf", roots);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rewritten).toBe(true);
    expect(r.root).toBe("attachments");
    expect(r.path).toBe(".attachments/report.pdf");
    expect(r.abs).toBe(resolve(cwd, ".attachments/report.pdf"));
  });

  it("rewrites /shared when sharedDir is configured", () => {
    const r = rewriteLogicalPath("/shared/public/ref.txt", roots);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rewritten).toBe(true);
    expect(r.root).toBe("shared");
    expect(r.path).toBe(resolve(sharedDir, "public/ref.txt"));
  });

  it("does not treat /shared as logical when sharedDir is unset", () => {
    const r = rewriteLogicalPath("/shared/x", rootsNoShared);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rewritten).toBe(false);
    expect(r.root).toBe("other");
    expect(r.abs).toBe(resolve("/shared/x"));
  });

  it("leaves relative paths unchanged", () => {
    const r = rewriteLogicalPath("EEG_MI/train.py", roots);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rewritten).toBe(false);
    expect(r.path).toBe("EEG_MI/train.py");
    expect(r.root).toBe("workspace");
    expect(r.abs).toBe(resolve(cwd, "EEG_MI/train.py"));
  });

  it("leaves real absolute durable paths unchanged", () => {
    const abs = resolve(persistentDir, "reuse.csv");
    const r = rewriteLogicalPath(abs, roots);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rewritten).toBe(false);
    expect(r.root).toBe("data");
    expect(r.path).toBe(abs);
  });

  it("prefers physical roots when the data root itself is mounted at /data", () => {
    const mountedCwd = resolve("/data/workspaces/s1");
    const mountedPersistentDir = resolve("/data/data");
    const mountedRoots: ManagedPathRoots = {
      cwd: mountedCwd,
      persistentDir: mountedPersistentDir,
    };

    const workspace = rewriteLogicalPath("/data/workspaces/s1/scripts/train.py", mountedRoots);
    expect(workspace).toMatchObject({
      ok: true,
      path: "/data/workspaces/s1/scripts/train.py",
      rewritten: false,
      root: "workspace",
      abs: resolve(mountedCwd, "scripts/train.py"),
    });

    const physicalData = rewriteLogicalPath("/data/data/models/best.pkl", mountedRoots);
    expect(physicalData).toMatchObject({
      ok: true,
      path: "/data/data/models/best.pkl",
      rewritten: false,
      root: "data",
      abs: resolve(mountedPersistentDir, "models/best.pkl"),
    });

    const logicalData = rewriteLogicalPath("/data/models/best.pkl", mountedRoots);
    expect(logicalData).toMatchObject({
      ok: true,
      path: resolve(mountedPersistentDir, "models/best.pkl"),
      rewritten: true,
      root: "data",
      abs: resolve(mountedPersistentDir, "models/best.pkl"),
    });
  });

  it("rejects traversal out of /workspace", () => {
    const r = rewriteLogicalPath("/workspace/../../etc/passwd", roots);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe(denyPathEscapeReason("workspace", "/workspace/../../etc/passwd"));
  });

  it("rejects traversal out of /data", () => {
    const r = rewriteLogicalPath("/data/../workspaces/evil.txt", roots);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("data root");
  });

  it("normalizes backslashes like resolveManagedPath", () => {
    const r = rewriteLogicalPath("\\workspace\\a.py", roots);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rewritten).toBe(true);
    expect(r.path).toBe("a.py");
  });

  it("two session cwds rewrite /workspace independently (no clobber)", () => {
    const a = rewriteLogicalPath("/workspace/x", { ...roots, cwd });
    const b = rewriteLogicalPath("/workspace/x", { ...roots, cwd: otherSid });
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.abs).toBe(resolve(cwd, "x"));
    expect(b.abs).toBe(resolve(otherSid, "x"));
    expect(a.abs).not.toBe(b.abs);
  });
});

describe("denyWriteOutsideDurable", () => {
  it("allows workspace and persistent library targets", () => {
    expect(denyWriteOutsideDurable("notes.md", roots)).toBeNull();
    expect(denyWriteOutsideDurable("/workspace/out.txt", roots)).toBeNull();
    expect(denyWriteOutsideDurable("/data/lib.csv", roots)).toBeNull();
    expect(denyWriteOutsideDurable(resolve(persistentDir, "z"), roots)).toBeNull();
  });

  it("rejects shared root writes", () => {
    expect(denyWriteOutsideDurable("/shared/x", roots)).toBe(
      denySharedWriteReason("/shared/x"),
    );
  });

  it("rejects ephemeral absolute paths (container layer)", () => {
    expect(denyWriteOutsideDurable("/tmp/model.pt", roots)).toBe(
      denyEphemeralWriteReason("/tmp/model.pt"),
    );
    // Un-rewritten bare /workspace is allowed after rewrite; real container
    // path that is NOT the logical prefix still denied if somehow passed as
    // a different ephemeral path:
    expect(denyWriteOutsideDurable("/var/log/x", roots)).toContain("durable storage");
  });

  it("rejects another session's workspace", () => {
    expect(denyWriteOutsideDurable(join(otherSid, "stolen.txt"), roots)).toContain(
      "durable storage",
    );
  });
});

describe("rewriteBashWorkspacePaths", () => {
  it("rewrites path-bounded /workspace tokens to cwd", () => {
    const { command, rewritten } = rewriteBashWorkspacePaths(
      "mkdir -p /workspace/EEG_MI && cd /workspace/EEG_MI && python train.py",
      cwd,
    );
    expect(rewritten).toBe(true);
    expect(command).toContain(`${cwd}/EEG_MI`);
    expect(command).not.toMatch(/(^|[\s])\/workspace(\/|[\s]|$)/);
  });

  it("does not rewrite /workspace_backup or substring workspace", () => {
    const { command, rewritten } = rewriteBashWorkspacePaths(
      "ls /workspace_backup && cat my/workspace/file",
      cwd,
    );
    expect(rewritten).toBe(false);
    expect(command).toBe("ls /workspace_backup && cat my/workspace/file");
  });

  it("rewrites quoted and assigned forms", () => {
    const { command, rewritten } = rewriteBashWorkspacePaths(
      `OUT="/workspace/out.txt" && echo hi > "/workspace/a"`,
      cwd,
    );
    expect(rewritten).toBe(true);
    expect(command).toContain(`${cwd}/out.txt`);
    expect(command).toContain(`${cwd}/a`);
  });
});

describe("applyManagedPathToolCall", () => {
  it("mutates write path /workspace → relative and allows the call", () => {
    const input: Record<string, unknown> = {
      path: "/workspace/EEG_MI/train.py",
      content: "print(1)\n",
    };
    const result = applyManagedPathToolCall({ toolName: "write", input, roots });
    expect(result).toBeUndefined();
    expect(input.path).toBe("EEG_MI/train.py");
  });

  it("mutates edit file_path alias", () => {
    const input: Record<string, unknown> = {
      file_path: "/workspace/a.py",
      oldText: "a",
      newText: "b",
    };
    expect(applyManagedPathToolCall({ toolName: "edit", input, roots })).toBeUndefined();
    expect(input.file_path).toBe("a.py");
  });

  it("blocks write to /tmp after no rewrite", () => {
    const input: Record<string, unknown> = { path: "/tmp/x", content: "x" };
    const result = applyManagedPathToolCall({ toolName: "write", input, roots });
    expect(result).toEqual({
      block: true,
      reason: denyEphemeralWriteReason("/tmp/x"),
    });
  });

  it("blocks write to /shared", () => {
    const input: Record<string, unknown> = { path: "/shared/x", content: "x" };
    const result = applyManagedPathToolCall({ toolName: "write", input, roots });
    expect(result?.block).toBe(true);
    expect(result?.reason).toBe(denySharedWriteReason("/shared/x"));
  });

  it("blocks path escape on read", () => {
    const input: Record<string, unknown> = { path: "/workspace/../../etc/passwd" };
    const result = applyManagedPathToolCall({ toolName: "read", input, roots });
    expect(result?.block).toBe(true);
    expect(result?.reason).toContain("escapes");
  });

  it("rewrites bash /workspace without blocking", () => {
    const input: Record<string, unknown> = {
      command: "mkdir -p /workspace/demo && echo hi > /workspace/demo/out.txt",
    };
    expect(applyManagedPathToolCall({ toolName: "bash", input, roots })).toBeUndefined();
    expect(String(input.command)).toContain(`${cwd}/demo`);
    expect(String(input.command)).not.toContain("/workspace/");
  });

  it("allows read of relative and persistent paths without mutation of real abs", () => {
    const abs = resolve(persistentDir, "lib.csv");
    const input: Record<string, unknown> = { path: abs };
    expect(applyManagedPathToolCall({ toolName: "read", input, roots })).toBeUndefined();
    expect(input.path).toBe(abs);
  });

  it("rewrites /data on write to absolute persistent path", () => {
    const input: Record<string, unknown> = {
      path: "/data/models/best.pt",
      content: "x",
    };
    expect(applyManagedPathToolCall({ toolName: "write", input, roots })).toBeUndefined();
    expect(input.path).toBe(resolve(persistentDir, "models/best.pt"));
  });
});
