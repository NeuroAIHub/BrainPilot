import { describe, it, expect, vi } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "./program.js";

// Use the OS tmpdir so the `--dir` argv literal is shaped the same way on
// Windows and POSIX. The CLI just echoes the option value back through
// commander; we never touch the filesystem. (#9 — cross-platform pass.)
const TMP_DIR = join(tmpdir(), "x");

describe("program — commander wiring", () => {
  it("dispatches `up` with parsed --dir/--port and foreground default", async () => {
    const upFn = vi.fn().mockResolvedValue({ url: "x", config: {} });
    await run(["up", "--dir", TMP_DIR, "--port", "9100"], { upFn });
    expect(upFn).toHaveBeenCalledOnce();
    const [opts] = upFn.mock.calls[0]!;
    expect(opts).toMatchObject({ dir: TMP_DIR, port: 9100, foreground: true });
  });

  it("`up --detach` sets foreground false", async () => {
    const upFn = vi.fn().mockResolvedValue({ url: "x", config: {} });
    await run(["up", "--detach"], { upFn });
    expect(upFn.mock.calls[0]![0]).toMatchObject({ foreground: false });
  });

  it("`up --no-open` disables browser open", async () => {
    const upFn = vi.fn().mockResolvedValue({ url: "x", config: {} });
    await run(["up", "--no-open"], { upFn });
    expect(upFn.mock.calls[0]![0]).toMatchObject({ open: false });
  });

  it("`up --mode static` forwards the orchestrator mode", async () => {
    const upFn = vi.fn().mockResolvedValue({ url: "x", config: {} });
    await run(["up", "--mode", "static"], { upFn });
    expect(upFn.mock.calls[0]![0]).toMatchObject({ mode: "static" });
  });

  it("`up` with no --mode leaves mode undefined (resolver defaults to local)", async () => {
    const upFn = vi.fn().mockResolvedValue({ url: "x", config: {} });
    await run(["up"], { upFn });
    expect(upFn.mock.calls[0]![0].mode).toBeUndefined();
  });

  it("rejects an invalid --mode", async () => {
    const upFn = vi.fn();
    await expect(run(["up", "--mode", "bogus"], { upFn })).rejects.toThrow();
    expect(upFn).not.toHaveBeenCalled();
  });

  it("dispatches `down` with --dir", async () => {
    const downFn = vi.fn().mockResolvedValue({ stopped: true, pid: 1, forced: false });
    await run(["down", "--dir", "/d"], { downFn });
    expect(downFn.mock.calls[0]![0]).toMatchObject({ dir: "/d" });
  });

  it("dispatches `status`", async () => {
    const statusFn = vi.fn().mockResolvedValue({ running: false });
    await run(["status", "-p", "9001"], { statusFn });
    expect(statusFn.mock.calls[0]![0]).toMatchObject({ port: 9001 });
  });

  it("dispatches `init` with --api-key", async () => {
    const initFn = vi.fn().mockResolvedValue({ dataDir: "/d", created: [], keyPersisted: true });
    await run(["init", "--api-key", "sk-1"], { initFn });
    expect(initFn.mock.calls[0]![0]).toMatchObject({ apiKey: "sk-1" });
  });

  it("dispatches `init` with --base-url and --model", async () => {
    const initFn = vi.fn().mockResolvedValue({ dataDir: "/d", created: [], keyPersisted: false });
    await run(["init", "--base-url", "https://gw/api", "--model", "m1"], { initFn });
    expect(initFn.mock.calls[0]![0]).toMatchObject({
      baseUrl: "https://gw/api",
      model: "m1",
    });
  });

  it("dispatches `logs --runtime`", async () => {
    const logsFn = vi.fn().mockResolvedValue("");
    await run(["logs", "--runtime"], { logsFn });
    expect(logsFn.mock.calls[0]![0]).toMatchObject({ which: "runtime" });
  });

  it("rejects an invalid --port", async () => {
    const upFn = vi.fn();
    await expect(run(["up", "--port", "notaport"], { upFn })).rejects.toThrow();
    expect(upFn).not.toHaveBeenCalled();
  });
});
