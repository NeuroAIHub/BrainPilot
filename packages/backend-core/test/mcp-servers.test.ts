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

  it("#204 POST with an existing name returns 409 and does not overwrite", async () => {
    const { app } = await setup();
    expect((await post(app, { name: "s", config: { type: "stdio", command: "old" } })).status).toBe(201);
    const dup = await post(app, { name: "s", config: { type: "stdio", command: "new" } });
    expect(dup.status).toBe(409);
    const list = await (await app.request("/api/mcp-servers")).json();
    expect(list).toHaveLength(1);
    expect(list[0].command).toBe("old"); // original preserved, not overwritten
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

    it("#203 rejects a non-URL http/sse url with 400", async () => {
      const { app } = await setup();
      expect((await post(app, { name: "a", config: { type: "http", url: "not a url" } })).status).toBe(400);
      expect((await post(app, { name: "b", config: { type: "sse", url: "not a url" } })).status).toBe(400);
      // a non-http scheme is rejected too
      expect((await post(app, { name: "c", config: { type: "http", url: "ftp://h/x" } })).status).toBe(400);
    });

    it("#203 accepts localhost / 127.0.0.1 http urls", async () => {
      const { app } = await setup();
      expect(
        (await post(app, { name: "a", config: { type: "http", url: "http://localhost:8080/mcp" } })).status,
      ).toBe(201);
      expect(
        (await post(app, { name: "b", config: { type: "sse", url: "http://127.0.0.1:3000/sse" } })).status,
      ).toBe(201);
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

  // #377: hosted deployments inject read-only presets (optionally BYOK-annotated)
  // into the same on-disk file. GET must retain only the safe display metadata the
  // web UI needs; PUT/DELETE must refuse, because hiding the buttons in the UI is a
  // hint and the stored transport can carry the platform's shared credentials.
  describe("#377 platform-managed presets", () => {
    const preset = {
      type: "http",
      url: "https://mcp.tavily.com/mcp/?tavilyApiKey=SHARED",
      readOnly: true,
      byok: { kind: "tavily", keyParam: "tavilyApiKey" },
    };

    async function seedPreset() {
      const { app, dataDir } = await setup();
      await mkdir(join(dataDir, "bp_template"), { recursive: true });
      await writeFile(
        join(dataDir, "bp_template", "mcp_servers.json"),
        JSON.stringify({ mcpServers: { tavily: preset } }),
      );
      return { app, dataDir };
    }

    it("GET keeps BYOK metadata but exposes only the managed endpoint's origin", async () => {
      const { app, dataDir } = await seedPreset();
      const list = await (await app.request("/api/mcp-servers")).json();
      expect(list).toEqual([{
        name: "tavily",
        type: "http",
        url: "https://mcp.tavily.com",
        readOnly: true,
        byok: { kind: "tavily", keyParam: "tavilyApiKey" },
      }]);
      expect(JSON.stringify(list)).not.toContain("SHARED");
      expect(JSON.stringify(list)).not.toContain("tavilyApiKey=SHARED");

      // Redaction is an HTTP-boundary concern. The runtime still needs the full
      // transport on disk to call the preset with the platform fallback key.
      const stored = await readFile(join(dataDir, "bp_template", "mcp_servers.json"), "utf8");
      expect(stored).toContain("tavilyApiKey=SHARED");
    });

    it("GET strips every managed transport field that can carry a credential", async () => {
      const { app, dataDir } = await setup();
      await mkdir(join(dataDir, "bp_template"), { recursive: true });
      await writeFile(
        join(dataDir, "bp_template", "mcp_servers.json"),
        JSON.stringify({
          mcpServers: {
            internal: {
              type: "stdio",
              command: "runner",
              args: ["--token", "ARGS_SECRET"],
              env: { API_KEY: "ENV_SECRET" },
              headers: { Authorization: "Bearer HEADER_SECRET" },
              readOnly: true,
              byok: { kind: "internal", keyHeader: "Authorization", extraSecret: "METADATA_SECRET" },
            },
          },
        }),
      );

      const list = await (await app.request("/api/mcp-servers")).json();
      expect(list).toEqual([{
        name: "internal",
        type: "stdio",
        readOnly: true,
        byok: { kind: "internal", keyHeader: "Authorization" },
      }]);
      expect(JSON.stringify(list)).not.toMatch(/ARGS_SECRET|ENV_SECRET|HEADER_SECRET|METADATA_SECRET/);
    });

    it("GET omits an invalid managed URL instead of echoing it", async () => {
      const { app, dataDir } = await setup();
      await mkdir(join(dataDir, "bp_template"), { recursive: true });
      await writeFile(
        join(dataDir, "bp_template", "mcp_servers.json"),
        JSON.stringify({
          mcpServers: {
            broken: { type: "http", url: "not-a-url?token=SECRET", readOnly: true },
          },
        }),
      );

      const list = await (await app.request("/api/mcp-servers")).json();
      expect(list).toEqual([{ name: "broken", type: "http", readOnly: true }]);
      expect(JSON.stringify(list)).not.toContain("SECRET");
    });

    it("PUT on a read-only preset returns 403 and leaves the file unchanged", async () => {
      const { app, dataDir } = await seedPreset();
      const before = await readFile(join(dataDir, "bp_template", "mcp_servers.json"), "utf8");
      const res = await put(app, "tavily", { type: "http", url: "https://evil.test/mcp" });
      expect(res.status).toBe(403);
      expect(await readFile(join(dataDir, "bp_template", "mcp_servers.json"), "utf8")).toBe(before);
    });

    it("DELETE on a read-only preset returns 403 and leaves the entry in place", async () => {
      const { app } = await seedPreset();
      expect((await del(app, "tavily")).status).toBe(403);
      const list = await (await app.request("/api/mcp-servers")).json();
      expect(list).toHaveLength(1);
    });

    it("a name collision with a preset still 409s rather than overwriting it", async () => {
      const { app } = await seedPreset();
      const res = await post(app, { name: "tavily", config: { type: "http", url: "https://evil.test/mcp" } });
      expect(res.status).toBe(409);
    });

    it("a client cannot mint its own read-only / BYOK entry", async () => {
      const { app } = await setup();
      // `readOnly` and `byok` are platform-injected annotations; the config schema
      // strips them, so a user can't self-lock an entry against their own Delete.
      const res = await post(app, {
        name: "mine",
        config: { type: "http", url: "https://host/mcp", readOnly: true, byok: { kind: "tavily" } },
      });
      expect(res.status).toBe(201);
      const entry = await res.json();
      expect(entry.readOnly).toBeUndefined();
      expect(entry.byok).toBeUndefined();
      expect((await del(app, "mine")).status).toBe(204);
    });

    it("read-only presets do not block CRUD on ordinary neighbours", async () => {
      const { app } = await seedPreset();
      expect((await post(app, { name: "mine", config: { type: "stdio", command: "npx" } })).status).toBe(201);
      expect((await put(app, "mine", { type: "stdio", command: "node" })).status).toBe(200);
      expect((await del(app, "mine")).status).toBe(204);
    });
  });
});
