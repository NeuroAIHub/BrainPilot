import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
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
  const dataDir = await mkdtemp(join(tmpdir(), "bp-mcp-api-"));
  const app = createApp({
    orchestrator: fakeOrchestrator(),
    serveWeb: false,
    dataDir,
  });
  return { app, dataDir };
}

function post(app: ReturnType<typeof createApp>, body: unknown) {
  return app.request("/api/mcp-servers", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function put(app: ReturnType<typeof createApp>, name: string, body: unknown) {
  return app.request(`/api/mcp-servers/${name}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function del(app: ReturnType<typeof createApp>, name: string) {
  return app.request(`/api/mcp-servers/${name}`, { method: "DELETE" });
}

describe("MCP Servers CRUD (/api/mcp-servers)", () => {
  it("GET returns empty array when no config file exists", async () => {
    const { app } = await setup();
    const res = await app.request("/api/mcp-servers");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it("GET returns servers from an existing mcp_servers.json", async () => {
    const { app, dataDir } = await setup();
    await mkdir(join(dataDir, "bp_template"), { recursive: true });
    await writeFile(
      join(dataDir, "bp_template", "mcp_servers.json"),
      JSON.stringify({ mcpServers: { fs: { type: "stdio", command: "npx" } } }),
    );
    const res = await app.request("/api/mcp-servers");
    expect(res.status).toBe(200);
    const list = await res.json();
    expect(list).toHaveLength(1);
    expect(list[0]).toEqual({ name: "fs", type: "stdio", command: "npx" });
  });

  it("POST creates a server and returns it with 201", async () => {
    const { app } = await setup();
    const res = await post(app, {
      name: "my-api",
      config: { type: "http", url: "https://host/mcp", headers: { Authorization: "Bearer t" } },
    });
    expect(res.status).toBe(201);
    const entry = await res.json();
    expect(entry.name).toBe("my-api");
    expect(entry.type).toBe("http");
    expect(entry.url).toBe("https://host/mcp");
    expect(entry.headers).toEqual({ Authorization: "Bearer t" });
  });

  it("POST with an existing name overwrites", async () => {
    const { app } = await setup();
    await post(app, { name: "s", config: { type: "stdio", command: "old" } });
    await post(app, { name: "s", config: { type: "stdio", command: "new" } });
    const list = await (await app.request("/api/mcp-servers")).json();
    expect(list).toHaveLength(1);
    expect(list[0].command).toBe("new");
  });

  it("POST returns 400 when name or config is missing", async () => {
    const { app } = await setup();
    expect((await post(app, { config: { type: "stdio" } })).status).toBe(400);
    expect((await post(app, { name: "x" })).status).toBe(400);
    expect((await post(app, {})).status).toBe(400);
  });

  it("PUT updates an existing server", async () => {
    const { app } = await setup();
    await post(app, { name: "s", config: { type: "stdio", command: "a" } });
    const res = await put(app, "s", { type: "stdio", command: "b" });
    expect(res.status).toBe(200);
    expect((await res.json()).command).toBe("b");
  });

  it("PUT returns 404 for a missing server", async () => {
    const { app } = await setup();
    const res = await put(app, "nope", { type: "stdio", command: "x" });
    expect(res.status).toBe(404);
  });

  it("DELETE removes an existing server and returns 204", async () => {
    const { app } = await setup();
    await post(app, { name: "s", config: { type: "sse", url: "http://x/sse" } });
    const res = await del(app, "s");
    expect(res.status).toBe(204);
    const list = await (await app.request("/api/mcp-servers")).json();
    expect(list).toHaveLength(0);
  });

  it("DELETE returns 404 for a missing server", async () => {
    const { app } = await setup();
    expect((await del(app, "nope")).status).toBe(404);
  });

  // #49: invalid transport configs must 400 (JSON) and never be persisted.
  describe("#49 transport config validation", () => {
    it("rejects the four invalid configs from the issue with 400", async () => {
      const { app } = await setup();
      const bad = [
        { name: "bad-http-no-url", config: { type: "http" } },
        { name: "bad-sse-no-url", config: { type: "sse" } },
        { name: "bad-stdio-no-command", config: { type: "stdio" } },
        { name: "bad-type", config: { type: "wat", url: "http://x" } },
      ];
      for (const body of bad) {
        const res = await post(app, body);
        expect(res.status, `${body.name} should 400`).toBe(400);
        expect(res.headers.get("content-type")).toContain("application/json");
      }
    });

    it("leaves the on-disk file unchanged when a config is invalid", async () => {
      const { app, dataDir } = await setup();
      // seed one valid entry
      await post(app, { name: "good", config: { type: "http", url: "http://host/mcp" } });
      const before = await readFile(join(dataDir, "bp_template", "mcp_servers.json"), "utf8");
      // an invalid create must not touch the file
      const res = await post(app, { name: "bad", config: { type: "wat" } });
      expect(res.status).toBe(400);
      const after = await readFile(join(dataDir, "bp_template", "mcp_servers.json"), "utf8");
      expect(after).toBe(before);
    });

    it("rejects empty url / command (whitespace-only) as invalid", async () => {
      const { app } = await setup();
      expect((await post(app, { name: "a", config: { type: "http", url: "   " } })).status).toBe(400);
      expect((await post(app, { name: "b", config: { type: "stdio", command: "" } })).status).toBe(400);
    });

    it("PUT also rejects invalid configs with 400", async () => {
      const { app } = await setup();
      await post(app, { name: "s", config: { type: "stdio", command: "a" } });
      expect((await put(app, "s", { type: "http" })).status).toBe(400);
      expect((await put(app, "s", { type: "wat", url: "http://x" })).status).toBe(400);
    });
  });

  it("persists the runtime's {mcpServers: ...} disk format", async () => {
    const { app, dataDir } = await setup();
    await post(app, { name: "kb", config: { type: "http", url: "http://host/mcp" } });
    const raw = JSON.parse(
      await readFile(join(dataDir, "bp_template", "mcp_servers.json"), "utf8"),
    );
    expect(raw).toEqual({
      mcpServers: { kb: { type: "http", url: "http://host/mcp" } },
    });
  });
});
