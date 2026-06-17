import { describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
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
  const dataDir = await mkdtemp(join(tmpdir(), "bp-authme-api-"));
  const app = createApp({
    orchestrator: fakeOrchestrator(),
    serveWeb: false,
    dataDir,
  });
  return { app, dataDir };
}

// Trust-front (#21/#35) moved auth to an upstream gateway. Self-hosted `bp --up`
// has no gateway, so the SPA's GET /api/auth/me must resolve locally instead of
// hitting the JSON-404 guard — otherwise the frontend loops on /account/login (#38).
describe("self-hosted auth identity (/api/auth/me)", () => {
  it("GET returns 200 with a default local identity", async () => {
    const { app } = await setup();
    const res = await app.request("/api/auth/me");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      id: "local",
      username: "local",
      createdAt: "1970-01-01T00:00:00.000Z",
    });
  });

  it("does NOT fall through to the /api/* JSON-404 guard", async () => {
    const { app } = await setup();
    const res = await app.request("/api/auth/me");
    expect(res.status).not.toBe(404);
  });
});
