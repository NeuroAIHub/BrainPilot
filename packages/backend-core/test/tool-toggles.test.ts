/**
 * Route + disk tests for /api/tool-toggles.
 *
 * Invariants:
 *   - GET on a fresh data dir returns {} (default-on for all tools).
 *   - PUT is a PATCH (partial merge), not a REPLACE — the endpoint the
 *     frontend calls with a single-field payload must not clear the others.
 *   - Unknown / non-boolean fields are silently dropped by the writer, and
 *     GET reflects only the sanitised state (matches the runtime loader
 *     contract, so backend and runtime never disagree on a malformed file).
 *   - File permissions are 0o600 (secret hygiene: this is a config file, not
 *     public API surface, and follows the same posture as providers.json
 *     and mcp_servers.json).
 */
import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/app.js";
import type { Orchestrator, RuntimeHandle } from "../src/orchestrator.js";

function fakeOrchestrator(): Orchestrator {
  return {
    async ensureRuntime(): Promise<RuntimeHandle> {
      return { baseUrl: "http://runtime.test" };
    },
    async health() {
      return true;
    },
    async stopRuntime() {},
  };
}

async function setup() {
  const dataDir = await mkdtemp(join(tmpdir(), "bp-tool-toggles-"));
  const app = createApp({
    orchestrator: fakeOrchestrator(),
    serveWeb: false,
    dataDir,
  });
  return { app, dataDir };
}

function togglesPath(dataDir: string): string {
  return join(dataDir, "bp_template", "tool_toggles.json");
}

function put(app: ReturnType<typeof createApp>, body: unknown) {
  return app.request("/api/tool-toggles", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("Tool toggles CRUD (/api/tool-toggles)", () => {
  it("GET returns {} on a fresh data dir (default-on for all tools)", async () => {
    const { app } = await setup();
    const res = await app.request("/api/tool-toggles");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({});
  });

  it("GET returns the parsed contents of an existing tool_toggles.json", async () => {
    const { app, dataDir } = await setup();
    await mkdir(join(dataDir, "bp_template"), { recursive: true });
    await writeFile(
      togglesPath(dataDir),
      JSON.stringify({ skill_search: false, get_domain_knowledge_local: true }),
    );
    const res = await app.request("/api/tool-toggles");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      skill_search: false,
      get_domain_knowledge_local: true,
    });
  });

  it("PUT with one field merges (doesn't clobber the others)", async () => {
    const { app, dataDir } = await setup();
    // Seed all three keys.
    await mkdir(join(dataDir, "bp_template"), { recursive: true });
    await writeFile(
      togglesPath(dataDir),
      JSON.stringify({
        skill_search: true,
        get_domain_knowledge_local: true,
        search_papers_local: true,
      }),
    );
    // Flip just one field.
    const res = await put(app, { skill_search: false });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      skill_search: false,
      get_domain_knowledge_local: true,
      search_papers_local: true,
    });
    // Reflected on disk.
    const onDisk = JSON.parse(await readFile(togglesPath(dataDir), "utf8"));
    expect(onDisk).toEqual({
      skill_search: false,
      get_domain_knowledge_local: true,
      search_papers_local: true,
    });
  });

  it("PUT with an empty body writes the file but changes nothing (normalise-only)", async () => {
    const { app, dataDir } = await setup();
    const res = await put(app, {});
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({});
    // File exists (empty object) — subsequent reads are fast, no re-normalise.
    const onDisk = JSON.parse(await readFile(togglesPath(dataDir), "utf8"));
    expect(onDisk).toEqual({});
  });

  it("PUT drops unknown keys and non-boolean values", async () => {
    const { app, dataDir } = await setup();
    const res = await put(app, {
      skill_search: false,
      skil_search: true,           // typo
      dispatch_task: false,        // not toggleable
      get_domain_knowledge_local: "off",  // non-boolean
    });
    expect(res.status).toBe(200);
    // Only the one valid boolean field survived.
    expect(await res.json()).toEqual({ skill_search: false });
    const onDisk = JSON.parse(await readFile(togglesPath(dataDir), "utf8"));
    expect(onDisk).toEqual({ skill_search: false });
  });

  it("preserves unknown top-level keys on disk across PUTs (forward-compat)", async () => {
    // A future field the user's build doesn't know about (`experimental_x`)
    // must survive a round-trip so an older UI doesn't strip it on save.
    const { app, dataDir } = await setup();
    await mkdir(join(dataDir, "bp_template"), { recursive: true });
    await writeFile(
      togglesPath(dataDir),
      JSON.stringify({
        skill_search: true,
        experimental_x: { future: "field" },
      }),
    );
    const res = await put(app, { skill_search: false });
    expect(res.status).toBe(200);
    const onDisk = JSON.parse(await readFile(togglesPath(dataDir), "utf8"));
    expect(onDisk.skill_search).toBe(false);
    expect(onDisk.experimental_x).toEqual({ future: "field" });
  });

  it("writes with 0o600 permissions (same posture as providers.json)", async () => {
    const { app, dataDir } = await setup();
    const res = await put(app, { skill_search: false });
    expect(res.status).toBe(200);
    const info = await stat(togglesPath(dataDir));
    // Just check the mode bits, ignoring the file-type portion.
    const mode = info.mode & 0o777;
    expect(mode).toBe(0o600);
  });
});
