import { describe, expect, it } from "vitest";
import {
  AgentStateSchema,
  FileContentSchema,
  FileEntrySchema,
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
    expect(
      SessionSchema.parse({
        id: "s1",
        title: "T",
        createdAt: "2026-06-12T00:00:00Z",
        updatedAt: "2026-06-12T00:00:00Z",
      }).id,
    ).toBe("s1");
  });

  it("validates SessionStateSnapshot with agents", () => {
    const snap = {
      runState: { active: true, runId: "r1" },
      agents: [{ name: "principal", status: "running", task: "thinking", alive: true }],
      lastActivityTs: "2026-06-12T00:00:00Z",
    };
    expect(SessionStateSnapshotSchema.parse(snap).agents[0]?.name).toBe("principal");
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
});
