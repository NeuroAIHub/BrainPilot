import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "../session-manager.js";
import { mockAgentFactory } from "../agent-factory.js";

/**
 * #193: `listSessionFiles` must distinguish a genuinely-empty / not-yet-created
 * workspace (ENOENT → `[]`) from a real readdir failure. Before the fix every
 * error was swallowed as `[]`, so a broken listing looked identical to an empty
 * workspace and the Files panel silently showed nothing.
 */
describe("listSessionFiles error surfacing (#193)", () => {
  let dataRoot: string;
  let m: SessionManager;

  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), "bp-listfiles-"));
    m = new SessionManager({ persist: true, dataRoot, agentFactory: mockAgentFactory });
  });

  afterEach(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  it("returns an empty list for a never-written workspace (ENOENT is benign)", async () => {
    const s = await m.createSession({ title: "Empty" });
    // createSession mkdirs the workspace; listing the freshly-created (empty)
    // dir must be `[]`, not an error.
    const files = await m.listSessionFiles(s.id, "/workspace");
    expect(files).toEqual([]);
  });

  it("returns an empty list for an unknown session (no dir → ENOENT)", async () => {
    const files = await m.listSessionFiles("does-not-exist", "/workspace");
    expect(files).toEqual([]);
  });

  it("lists files that exist in the workspace", async () => {
    const s = await m.createSession({ title: "WithFile" });
    await m.writeSessionFile(s.id, "report.txt", Buffer.from("hello").toString("base64"));
    const files = await m.listSessionFiles(s.id, "/workspace");
    expect(files.map((f) => f.name)).toContain("report.txt");
  });

  it("throws instead of returning [] when the path is a file, not a directory (ENOTDIR)", async () => {
    const s = await m.createSession({ title: "NotDir" });
    // Create a file, then ask to list it as if it were a directory. readdir
    // fails with ENOTDIR — a real error that must surface, not be hidden as [].
    const abs = join(dataRoot, "workspaces", s.id, "afile.txt");
    await writeFile(abs, "x");
    await expect(m.listSessionFiles(s.id, "afile.txt")).rejects.toThrow(/failed to list workspace/);
  });
});
