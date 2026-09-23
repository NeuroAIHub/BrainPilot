import { chmod, mkdir, mkdtemp, readFile, readdir, rm, symlink, truncate, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { delimiter, dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import {
  executeNativeWorkflowTool, nativeWorkflowCapabilities, runNativeWorkflowCommand,
  type NativeWorkflowCommand, type NativeWorkflowCommandResult, type NativeWorkflowCommandRunner,
  type NativeWorkflowToolOptions,
} from "../workflows/native-tools.js";

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });
const pdfBytes = Buffer.from("%PDF-1.7\n% deterministic process-runner fixture, not a rendered paper\n%%EOF\n");
const pngBytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
const ok = (stdout = ""): NativeWorkflowCommandResult => ({ exitCode: 0, stdout, stderr: "", timedOut: false });
function deferred() { let resolve!: () => void; const promise = new Promise<void>((done) => { resolve = done; }); return { promise, resolve }; }
async function until(predicate: () => Promise<boolean>, label: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!await predicate()) {
    if (Date.now() > deadline) throw new Error(`Timed out: ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function fixture(runner?: NativeWorkflowCommandRunner) {
  const root = await mkdtemp(join(tmpdir(), "workflow-native-")); directories.push(root);
  const workspaceDir = join(root, "workspace"); await mkdir(workspaceDir);
  const controller = new AbortController();
  const published: Array<{ sourcePath: string; path: string; mediaType: string; role: string }> = [];
  const runId = "wf_native_fixture";
  const publishFile: NativeWorkflowToolOptions["publishFile"] = async (request) => {
    controller.signal.throwIfAborted();
    const bytes = await readFile(request.sourcePath);
    const path = `workflow-runs/${runId}/${request.path}`;
    await mkdir(dirname(join(workspaceDir, path)), { recursive: true });
    await writeFile(join(workspaceDir, path), bytes, { flag: "wx" });
    published.push(request);
    return { path, mediaType: request.mediaType, role: request.role,
      sha256: createHash("sha256").update(bytes).digest("hex"), producerRunId: runId };
  };
  return { root, workspaceDir, runId, controller, published,
    execute: (name: string, input: unknown) => executeNativeWorkflowTool({ runId, workspaceDir, request: { name, input },
      signal: controller.signal, publishFile, ...(runner ? { runner } : {}) }) };
}

describe("native workflow file/compiler tools", () => {
  it("keeps the upstream four-pass order even when BibTeX reports no citations", async () => {
    const calls: NativeWorkflowCommand[] = [];
    const f = await fixture(async (request) => {
      calls.push(request);
      expect(request.timeoutMs).toBe(30_000);
      expect(request.env.openin_any).toBe("p");
      expect(request.env.openout_any).toBe("p");
      expect(request.env.shell_escape).toBe("f");
      expect(request.env.TEXINPUTS).toBeUndefined();
      if (request.command === "pdflatex") {
        expect(request.args).toContain("-no-shell-escape");
        expect(await readFile(join(request.cwd, "references.bib"), "utf8")).toBe("");
        await writeFile(join(request.cwd, "main.pdf"), pdfBytes);
      }
      if (request.command === "bibtex") return { ...ok(), exitCode: 2, stderr: "I found no citation commands" };
      return ok(request.command === "pdftotext" ? "Extracted fixture text." : "compiler output");
    });
    const result = await f.execute("compile_latex", { stem: "attempt-1", source: "\\documentclass{article}\\begin{document}Text.\\end{document}" });
    expect(calls.map((call) => call.command)).toEqual(["pdflatex", "bibtex", "pdflatex", "pdflatex", "pdftotext"]);
    expect(result.data).toMatchObject({ success: true, text: "Extracted fixture text.", pdfPath: `workflow-runs/${f.runId}/attempt-1.pdf` });
    expect((result.data as { log: string }).log).toContain("I found no citation commands");
    expect(f.published.map((file) => file.path)).toEqual(["attempt-1-compile.log", "attempt-1.pdf"]);
    expect(await readFile(join(f.workspaceDir, result.artifacts[1]!.path))).toEqual(pdfBytes);
    expect(await readdir(join(f.workspaceDir, "workflow-runs", f.runId, ".work"))).toEqual([]);
  });

  it.each(["missing-pdf", "last-pass-failed", "timeout"])("returns failure and only publishes its log for %s", async (failure) => {
    let passes = 0;
    const f = await fixture(async (request) => {
      if (request.command === "pdflatex") {
        passes++;
        if (failure !== "missing-pdf") await writeFile(join(request.cwd, "main.pdf"), pdfBytes);
        if (failure === "last-pass-failed" && passes === 3) return { ...ok(), exitCode: 1, stderr: "LaTeX error" };
      }
      if (failure === "timeout" && request.command === "bibtex") return { ...ok(), exitCode: null, timedOut: true };
      return ok();
    });
    const result = await f.execute("compile_latex", { stem: "failed-attempt", source: "text" });
    expect(passes).toBe(3);
    expect(result.data).toMatchObject({ success: false });
    expect(result.data).not.toHaveProperty("pdfPath");
    expect(f.published.map((item) => item.path)).toEqual(["failed-attempt-compile.log"]);
    expect(result.artifacts).toHaveLength(1);
  });

  it("copies assets into an isolated compiler directory and rejects reserved targets", async () => {
    const f = await fixture(async (request) => {
      if (request.command === "pdflatex") {
        expect(await readFile(join(request.cwd, "figures", "plot.png"))).toEqual(pngBytes);
        await writeFile(join(request.cwd, "main.pdf"), pdfBytes);
      }
      return ok();
    });
    await writeFile(join(f.workspaceDir, "source-plot.png"), pngBytes);
    const result = await f.execute("compile_latex", { stem: "with-assets", source: "source", bibliography: "@article{test,title={Test}}",
      assets: [{ sourcePath: "source-plot.png", targetPath: "figures/plot.png" }] });
    expect(result.data).toMatchObject({ success: true });
    expect(await readFile(join(f.workspaceDir, "source-plot.png"))).toEqual(pngBytes);
    await expect(f.execute("compile_latex", { stem: "reserved", source: "source", assets: [{ sourcePath: "source-plot.png", targetPath: "main.tex" }] })).rejects.toThrow("collides");
  });

  it("reuses identical copied assets across retries and refuses changed destinations", async () => {
    const f = await fixture();
    await writeFile(join(f.workspaceDir, "source.png"), pngBytes);
    const request = { files: [{ sourcePath: "source.png", targetPath: "figures/plot.png" }] };
    const first = await f.execute("copy_files", request);
    const repeated = await f.execute("copy_files", request);
    expect(repeated).toEqual(first);
    expect(f.published).toHaveLength(1);
    const samePath = await f.execute("copy_files", { files: [{ sourcePath: first.artifacts[0]!.path, targetPath: "figures/plot.png" }] });
    expect(samePath.artifacts).toEqual(first.artifacts);
    expect(f.published).toHaveLength(1);
    await writeFile(join(f.workspaceDir, "source.png"), Buffer.concat([pngBytes, Buffer.from("changed")]));
    await expect(f.execute("copy_files", request)).rejects.toThrow("will not overwrite");
    expect(await readFile(join(f.workspaceDir, first.artifacts[0]!.path))).toEqual(pngBytes);
  });

  it("lists bounded regular files with both workspace-relative and requested-root paths", async () => {
    const f = await fixture();
    await mkdir(join(f.workspaceDir, "figures", "nested"), { recursive: true });
    await writeFile(join(f.workspaceDir, "figures", "a.png"), pngBytes);
    await writeFile(join(f.workspaceDir, "figures", "nested", "b.txt"), "asset metadata");
    expect(await f.execute("list_files", { path: "/workspace/figures" })).toEqual({ data: { files: [
      { path: "figures/a.png", relativePath: "a.png" },
      { path: "figures/nested/b.txt", relativePath: "nested/b.txt" },
    ] }, artifacts: [] });
    await writeFile(join(f.workspaceDir, "large.bin"), "");
    await truncate(join(f.workspaceDir, "large.bin"), 33 * 1024 * 1024);
    await expect(f.execute("copy_files", { files: [{ sourcePath: "large.bin", targetPath: "large.bin" }] })).rejects.toThrow("regular file");
  });

  it("rejects traversal, symlinks and arbitrary command fields", async () => {
    const f = await fixture();
    await writeFile(join(f.root, "outside.txt"), "outside");
    await symlink(join(f.root, "outside.txt"), join(f.workspaceDir, "escape.txt"));
    for (const sourcePath of ["../outside.txt", "escape.txt"]) {
      await expect(f.execute("copy_files", { files: [{ sourcePath, targetPath: "copy.txt" }] })).rejects.toThrow();
    }
    await writeFile(join(f.workspaceDir, "safe.txt"), "safe");
    await expect(f.execute("copy_files", { files: [{ sourcePath: "safe.txt", targetPath: "../overwrite" }] })).rejects.toThrow();
    await expect(f.execute("compile_latex", { stem: "../overwrite", source: "text" })).rejects.toThrow();
    await expect(f.execute("compile_latex", { stem: "safe", source: "text", command: "touch /outside" })).rejects.toThrow();
    await expect(f.execute("bash", { command: "anything" })).rejects.toThrow("Unknown native");
    expect(f.published).toEqual([]);
  });

  it("returns ordered scratch PNG paths and rejects partial page-limit output", async () => {
    let overflow = false;
    const f = await fixture(async (request) => {
      expect(request.command).toBe("pdftoppm");
      expect(request.args).toEqual(expect.arrayContaining(["-png", "-r", "100", "-scale-to", "1600", "-l", "25"]));
      const pages = overflow ? Array.from({ length: 25 }, (_, index) => index + 1) : [10, 2, 1];
      for (const page of pages) await writeFile(join(request.cwd, `page-${page}.png`), pngBytes);
      return ok();
    });
    await writeFile(join(f.workspaceDir, "paper.pdf"), pdfBytes);
    const result = await f.execute("render_pdf", { pdfPath: "paper.pdf" });
    const paths = (result.data as { imagePaths: string[] }).imagePaths;
    expect(paths.map((path) => path.split("/").at(-1))).toEqual(["page-1.png", "page-2.png", "page-10.png"]);
    expect(paths.every((path) => path.startsWith(`workflow-runs/${f.runId}/.work/`))).toBe(true);
    expect(result.artifacts).toEqual([]);
    expect(f.published).toEqual([]);
    overflow = true;
    await expect(f.execute("render_pdf", { pdfPath: "paper.pdf" })).rejects.toThrow("1–24 pages");
  });

  it("propagates Stop to the runner and publishes nothing after cancellation", async () => {
    const entered = deferred();
    const f = await fixture((request) => new Promise((_resolve, reject) => {
      request.signal.addEventListener("abort", () => reject(request.signal.reason), { once: true });
      entered.resolve();
    }));
    const pending = f.execute("compile_latex", { stem: "cancelled", source: "source" });
    const rejected = pending.catch((error: Error) => error.message);
    await entered.promise; f.controller.abort(new Error("session Stop"));
    expect(await rejected).toBe("session Stop");
    expect(f.published).toEqual([]);
    expect(await readdir(join(f.workspaceDir, "workflow-runs", f.runId, ".work"))).toEqual([]);
  });

  it("advertises only actually executable process dependencies", async () => {
    const f = await fixture(); const bin = join(f.root, "bin"); await mkdir(bin);
    expect(nativeWorkflowCapabilities(bin)).toEqual(["copy_files", "list_files"]);
    for (const executable of ["pdflatex", "bibtex", "pdftotext", "pdftoppm"]) {
      const path = join(bin, executable); await writeFile(path, "fixture"); await chmod(path, 0o700);
    }
    if (process.platform !== "win32") expect(nativeWorkflowCapabilities(bin)).toEqual(["copy_files", "list_files", "compile_latex", "render_pdf"]);
    await chmod(join(bin, "pdftotext"), 0o600);
    expect(nativeWorkflowCapabilities(bin)).not.toContain("compile_latex");
  });
});

describe.skipIf(process.platform !== "linux")("owned native process runner (Linux fixture executables)", () => {
  it("bounds command output without depending on a local TeX installation", async () => {
    const f = await fixture(); const bin = join(f.root, "bin"); await mkdir(bin);
    await symlink(process.execPath, join(bin, "pdflatex"));
    const result = await runNativeWorkflowCommand({ command: "pdflatex", args: ["-e", 'process.stdout.write("x".repeat(50000)); process.stderr.write("y".repeat(50000));'],
      cwd: f.workspaceDir, env: { PATH: `${bin}${delimiter}${process.env.PATH ?? ""}` }, signal: f.controller.signal, timeoutMs: 5_000, maxOutputBytes: 1024 });
    expect(result.exitCode).toBe(0);
    expect(result.outputTruncated).toBe(true);
    expect(Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr)).toBeLessThanOrEqual(1024);
  });

  it("Stop kills the owned group including a grandchild that ignores SIGTERM", async () => {
    const f = await fixture(); const bin = join(f.root, "bin"); await mkdir(bin);
    await symlink(process.execPath, join(bin, "pdflatex"));
    const code = `const fs = require('node:fs'); const {spawn} = require('node:child_process');
      const child = spawn(process.execPath, ['-e', 'process.on("SIGTERM", () => {}); process.send("ready"); setInterval(() => {}, 1000);'], {stdio: ['ignore','ignore','ignore','ipc']});
      child.once('message', () => fs.writeFileSync('owned.json', JSON.stringify({pid: process.pid, child: child.pid})));
      process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);`;
    const pending = runNativeWorkflowCommand({ command: "pdflatex", args: ["-e", code], cwd: f.workspaceDir,
      env: { PATH: `${bin}${delimiter}${process.env.PATH ?? ""}` }, signal: f.controller.signal, timeoutMs: 5_000, maxOutputBytes: 1024 });
    const observed = pending.then(() => "unexpected success", (error: Error) => error.message);
    try {
      await until(async () => { try { await readFile(join(f.workspaceDir, "owned.json")); return true; } catch { return false; } }, "owned child ready");
      const owned = JSON.parse(await readFile(join(f.workspaceDir, "owned.json"), "utf8")) as { pid: number; child: number };
      f.controller.abort(new Error("owned group Stop"));
      expect(await observed).toBe("owned group Stop");
      await until(async () => {
        try { return /State:\s+[ZX]/.test(await readFile(`/proc/${owned.child}/status`, "utf8")); }
        catch (error) { return (error as NodeJS.ErrnoException).code === "ENOENT"; }
      }, "owned grandchild stopped");
    } finally { f.controller.abort(); await observed; }
  });
});
