import { describe, expect, it } from "vitest";
import {
  CreateSessionRequestSchema,
  CreateSessionResponseSchema,
  DeleteSessionResponseSchema,
  EvictSessionResponseSchema,
  GetSessionStateResponseSchema,
  HealthResponseSchema,
  InterruptResponseSchema,
  ListAgentsResponseSchema,
  ListSessionsResponseSchema,
  MetricsResponseSchema,
  RUNTIME_ROUTES,
  SendMessageRequestSchema,
  SendMessageResponseSchema,
  SseEventFrameSchema,
} from "../src/http.js";

describe("Runtime HTTP contract", () => {
  it("validates health + metrics responses", () => {
    expect(HealthResponseSchema.parse({ status: "ok" }).status).toBe("ok");
    expect(
      MetricsResponseSchema.parse({
        activeSessions: 2,
        runningAgents: 1,
        lastActivityAt: "2026-06-12T00:00:00Z",
        memRss: 12345,
        memLimitBytes: 1048576,
        memRatio: 0.5,
      }).runningAgents,
    ).toBe(1);
    expect(
      MetricsResponseSchema.parse({
        activeSessions: 0,
        runningAgents: 0,
        lastActivityAt: null,
        memRss: 0,
        memLimitBytes: null,
        memRatio: null,
      }).lastActivityAt,
    ).toBeNull();
  });

  it("validates create session req/res", () => {
    expect(CreateSessionRequestSchema.parse({ title: "T" }).title).toBe("T");
    expect(CreateSessionRequestSchema.parse({}).title).toBeUndefined();
    expect(CreateSessionResponseSchema.parse({ id: "s1" }).id).toBe("s1");
  });

  it("validates list / delete session responses", () => {
    expect(
      ListSessionsResponseSchema.parse({
        sessions: [{ id: "s1", title: "T", createdAt: "t", updatedAt: "t" }],
      }).sessions.length,
    ).toBe(1);
    expect(DeleteSessionResponseSchema.parse({ id: "s1", deleted: true }).deleted).toBe(true);
  });

  it("validates session state response", () => {
    expect(
      GetSessionStateResponseSchema.parse({
        runState: { active: false, runId: null },
        agents: [],
        lastActivityTs: "",
      }).runState.active,
    ).toBe(false);
  });

  it("validates send-message req/res", () => {
    expect(SendMessageRequestSchema.parse({ content: "hi", agent: "principal" }).content).toBe(
      "hi",
    );
    expect(SendMessageRequestSchema.safeParse({ agent: "principal" }).success).toBe(false);
    expect(SendMessageResponseSchema.parse({ accepted: true, runId: "r1" }).accepted).toBe(true);
  });

  it("validates interrupt / agents / evict responses", () => {
    expect(InterruptResponseSchema.parse({ interrupted: true }).interrupted).toBe(true);
    expect(
      ListAgentsResponseSchema.parse({
        agents: [{ name: "principal", status: "idle", task: "" }],
      }).agents.length,
    ).toBe(1);
    expect(EvictSessionResponseSchema.parse({ evicted: true, agentsKilled: 2 }).agentsKilled).toBe(
      2,
    );
  });

  it("SSE event frame is the AgUiEvent union", () => {
    expect(
      SseEventFrameSchema.parse({ type: "TEXT_MESSAGE_CONTENT", message_id: "m1", delta: "x" })
        .type,
    ).toBe("TEXT_MESSAGE_CONTENT");
    expect(SseEventFrameSchema.safeParse({ type: "BOGUS" }).success).toBe(false);
  });

  it("route catalog has the §15.4 endpoints with correct methods", () => {
    expect(RUNTIME_ROUTES.health).toEqual({ method: "GET", path: "/health" });
    expect(RUNTIME_ROUTES.metrics).toEqual({ method: "GET", path: "/metrics" });
    expect(RUNTIME_ROUTES.createSession).toEqual({ method: "POST", path: "/sessions" });
    expect(RUNTIME_ROUTES.sendMessage.path).toBe("/sessions/:id/messages");
    expect(RUNTIME_ROUTES.sessionEvents).toEqual({ method: "GET", path: "/sse/:id" });
    expect(RUNTIME_ROUTES.interrupt.path).toBe("/sessions/:id/interrupt");
    expect(RUNTIME_ROUTES.listAgents.path).toBe("/sessions/:id/agents");
    expect(RUNTIME_ROUTES.evictSession).toEqual({ method: "POST", path: "/sessions/:id/evict" });
  });
});
