import { describe, expect, it } from "vitest";
import {
  AgentStateSchema,
  EXAMPLE_MODEL,
  FileContentSchema,
  FileEntrySchema,
  McpServerConfigSchema,
  McpServerEntrySchema,
  ProviderProfileSchema,
  ProviderProfileCreateSchema,
  SessionSchema,
  SessionStateSnapshotSchema,
  SettingsDataSchema,
  TraceGraphSchema,
  UserRoleSchema,
} from "../src/domain.js";

describe("domain schemas", () => {
  it("validates Session", () => {
    const session = SessionSchema.parse({
        id: "s1",
        title: "T",
        createdAt: "2026-06-12T00:00:00Z",
        updatedAt: "2026-06-12T00:00:00Z",
        domainResources: "base",
      });
    expect(session.id).toBe("s1");
    expect(session.domainResources).toBe("base");
    expect(SessionSchema.safeParse({ ...session, domainResources: "unknown" }).success).toBe(false);
  });

  it("validates SessionStateSnapshot with agents", () => {
    const snap = {
      runState: { active: true, runId: "r1" },
      agents: [{ name: "principal", status: "running", task: "thinking", alive: true }],
      lastActivityTs: "2026-06-12T00:00:00Z",
      domainResources: "full",
    };
    expect(SessionStateSnapshotSchema.parse(snap).agents[0]?.name).toBe("principal");
    expect(SessionStateSnapshotSchema.parse(snap).domainResources).toBe("full");
  });

  it("SessionStateSnapshot allows null runId", () => {
    expect(
      SessionStateSnapshotSchema.parse({
        runState: { active: false, runId: null },
        agents: [],
        lastActivityTs: "",
      }).runState.runId,
    ).toBeNull();
  });

  it("SessionStateSnapshot carries optional tokenUsage", () => {
    const parsed = SessionStateSnapshotSchema.parse({
      runState: { active: false, runId: null },
      agents: [],
      lastActivityTs: "",
      tokenUsage: {
        total: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, total: 15 },
        byAgent: {
          principal: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, total: 15 },
        },
      },
    });
    expect(parsed.tokenUsage?.total.total).toBe(15);
    expect(parsed.tokenUsage?.byAgent.principal?.input).toBe(10);
    // tokenUsage is optional — a frame without it still validates.
    expect(
      SessionStateSnapshotSchema.parse({
        runState: { active: false, runId: null },
        agents: [],
        lastActivityTs: "",
      }).tokenUsage,
    ).toBeUndefined();
  });

  it("AgentState enforces the status enum", () => {
    expect(AgentStateSchema.parse({ name: "a", status: "idle" }).status).toBe("idle");
    expect(AgentStateSchema.safeParse({ name: "a", status: "weird" }).success).toBe(false);
  });

  it("validates a TraceGraph", () => {
    const g = {
      meta: { sessionId: "s1", projectName: "P" },
      nodes: [
        {
          id: "n1",
          title: "root",
          type: "step",
          status: "completed",
          parents: [],
          artifacts: [],
          parentIds: [],
          childIds: ["n2"],
          toolCalls: [],
        },
      ],
    };
    expect(TraceGraphSchema.parse(g).nodes[0]?.id).toBe("n1");
  });

  it("validates SettingsData / McpServerEntry / ProviderProfile", () => {
    expect(SettingsDataSchema.parse({ model: "m", apiKey: "k", baseUrl: "u" }).model).toBe("m");
    expect(
      McpServerEntrySchema.parse({ name: "x", type: "http", url: "http://h" }).type,
    ).toBe("http");
    expect(McpServerEntrySchema.safeParse({ name: "x", type: "grpc" }).success).toBe(false);
    const profile = ProviderProfileSchema.parse({
      id: "p1",
      name: "OpenAI",
      baseUrl: "u",
      api: "openai-responses",
      adapter: "openai",
      isShared: false,
      models: ["m"],
      icon: "circle",
      iconColor: "#000",
      notes: "",
      isActive: true,
      apiKeyMasked: "sk-***",
      createdAt: 1,
      updatedAt: 2,
      healthStatus: "healthy",
      modelHealth: [{ model: "m", status: "healthy" }],
    });
    expect(profile.healthStatus).toBe("healthy");
    expect(profile.api).toBe("openai-responses");
    // #68: adapter + isShared surface on the response shape.
    expect(profile.adapter).toBe("openai");
    expect(profile.isShared).toBe(false);
    // #63: an unknown api value is rejected.
    expect(
      ProviderProfileCreateSchema.safeParse({ name: "x", api: "nope", models: ["m"] }).success,
    ).toBe(false);
    // #63: a known api value on create is accepted; omitting it is allowed.
    expect(
      ProviderProfileCreateSchema.safeParse({ name: "x", api: "azure-openai-responses", models: ["m"] })
        .success,
    ).toBe(true);
    expect(ProviderProfileCreateSchema.safeParse({ name: "x", models: ["m"] }).success).toBe(true);
    // #68: adapter on create is accepted; an unknown adapter is rejected.
    expect(
      ProviderProfileCreateSchema.safeParse({ name: "x", adapter: "openai", models: ["m"] }).success,
    ).toBe(true);
    expect(
      ProviderProfileCreateSchema.safeParse({ name: "x", adapter: "nope", models: ["m"] }).success,
    ).toBe(false);
  });

  it("validates FileEntry / FileContent", () => {
    expect(
      FileEntrySchema.parse({ name: "a", type: "file", size: 1, modified: 0, permissions: "rw" })
        .type,
    ).toBe("file");
    expect(FileContentSchema.parse({ path: "/a", content: "x", size: 1 }).path).toBe("/a");
  });

  it("validates UserRole", () => {
    expect(UserRoleSchema.parse("admin")).toBe("admin");
    expect(UserRoleSchema.safeParse("root").success).toBe(false);
  });

  // #203: http/sse url and provider base_url must be syntactically valid URLs,
  // while local-dev (localhost / 127.0.0.1) and an empty provider base_url stay
  // allowed.
  describe("#203 URL validation", () => {
    it("rejects a non-URL http/sse url", () => {
      expect(McpServerConfigSchema.safeParse({ type: "http", url: "not a url" }).success).toBe(false);
      expect(McpServerConfigSchema.safeParse({ type: "sse", url: "not a url" }).success).toBe(false);
      // non-http scheme rejected
      expect(McpServerConfigSchema.safeParse({ type: "http", url: "ftp://h/x" }).success).toBe(false);
    });

    it("accepts a valid + localhost http/sse url", () => {
      expect(McpServerConfigSchema.safeParse({ type: "http", url: "https://host/mcp" }).success).toBe(true);
      expect(McpServerConfigSchema.safeParse({ type: "http", url: "http://localhost:8080" }).success).toBe(true);
      expect(McpServerConfigSchema.safeParse({ type: "sse", url: "http://127.0.0.1:3000/sse" }).success).toBe(true);
    });

    it("rejects a non-URL provider base_url but allows empty / localhost", () => {
      const base = { name: "x", models: ["m"] };
      expect(ProviderProfileCreateSchema.safeParse({ ...base, base_url: "not a url" }).success).toBe(false);
      expect(ProviderProfileCreateSchema.safeParse({ ...base, base_url: "" }).success).toBe(true);
      expect(ProviderProfileCreateSchema.safeParse({ ...base, base_url: "http://127.0.0.1:1234" }).success).toBe(true);
      expect(ProviderProfileCreateSchema.safeParse({ ...base, base_url: "https://api.x.com" }).success).toBe(true);
      // omitted entirely is fine (optional)
      expect(ProviderProfileCreateSchema.safeParse(base).success).toBe(true);
    });
  });

  describe("#207 EXAMPLE_MODEL", () => {
    it("is a non-empty Claude example string shared across packages", () => {
      expect(typeof EXAMPLE_MODEL).toBe("string");
      expect(EXAMPLE_MODEL.length).toBeGreaterThan(0);
      expect(EXAMPLE_MODEL).toBe("claude-sonnet-4-6");
    });
  });
});
