import { describe, expect, it } from "vitest";
import {
  AgentStateSchema,
  FileContentSchema,
  FileEntrySchema,
  McpServerEntrySchema,
  ProviderProfileSchema,
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
    expect(
      ProviderProfileSchema.parse({
        id: "p1",
        name: "OpenAI",
        baseUrl: "u",
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
      }).healthStatus,
    ).toBe("healthy");
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
