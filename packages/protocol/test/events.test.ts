import { describe, expect, it } from "vitest";
import {
  AG_UI_EVENT_TYPES,
  AgUiEventSchema,
  CompactionCustomValueSchema,
  CUSTOM_EVENT,
  TaskStateValueSchema,
  DomainResourceUsageValueSchema,
  isAgUiEvent,
  parseEvent,
  safeParseEvent,
  SystemMessageEventSchema,
  UserInputRequestEventSchema,
  UserInputResponseEventSchema,
  UserInputCancelledEventSchema,
} from "../src/events.js";

describe("AG-UI event union — NEW events", () => {
  it("accepts enhanced TOOL_CALL_END while keeping legacy END valid", () => {
    expect(parseEvent({ type: "TOOL_CALL_END", tool_call_id: "t1" }).type).toBe("TOOL_CALL_END");
    expect(parseEvent({
      type: "TOOL_CALL_END",
      tool_call_id: "t1",
      status: "interrupted",
      duration_ms: 4100,
      reason: "user_requested",
      _ts: "2026-07-27T00:00:00.000Z",
    })).toMatchObject({ status: "interrupted", duration_ms: 4100 });
  });
  it("round-trips system_message (all four levels)", () => {
    for (const level of ["info", "warning", "error", "fatal"] as const) {
      const e = {
        type: "system_message",
        session_id: "s1",
        agent: "librarian",
        level,
        message: "API timeout",
        details: "120s",
        timestamp: "2026-06-12T00:00:00Z",
        recoverable: level !== "fatal",
      };
      const parsed = parseEvent(e);
      expect(parsed.type).toBe("system_message");
      expect(SystemMessageEventSchema.parse(e).level).toBe(level);
    }
  });

  it("system_message rejects an invalid level", () => {
    const r = safeParseEvent({
      type: "system_message",
      session_id: "s1",
      level: "critical",
      message: "x",
      timestamp: "t",
      recoverable: true,
    });
    expect(r.success).toBe(false);
  });

  it("system_message requires message + recoverable + timestamp", () => {
    expect(safeParseEvent({ type: "system_message", session_id: "s1", level: "info" }).success).toBe(
      false,
    );
  });

  it("round-trips user_input_request with options", () => {
    const e = {
      type: "user_input_request",
      session_id: "s1",
      request_id: "r1",
      agent: "principal",
      question: "Pick one",
      options: ["a", "b"],
      allow_free_text: true,
      timeout_sec: 30,
    };
    const parsed = parseEvent(e);
    expect(parsed.type).toBe("user_input_request");
    expect(UserInputRequestEventSchema.parse(e).options).toEqual(["a", "b"]);
  });

  it("user_input_request requires request_id + agent + question", () => {
    expect(
      safeParseEvent({ type: "user_input_request", session_id: "s1", question: "?" }).success,
    ).toBe(false);
  });

  it("round-trips user_input_response", () => {
    const e = {
      type: "user_input_response",
      session_id: "s1",
      request_id: "r1",
      answer: "a",
    };
    expect(parseEvent(e).type).toBe("user_input_response");
    expect(UserInputResponseEventSchema.parse(e).answer).toBe("a");
  });

  it("round-trips user_input_cancelled", () => {
    const e = {
      type: "user_input_cancelled",
      session_id: "s1",
      request_id: "r1",
      reason: "interrupted",
    };
    expect(parseEvent(e).type).toBe("user_input_cancelled");
    expect(UserInputCancelledEventSchema.parse(e).reason).toBe("interrupted");
    expect(UserInputCancelledEventSchema.safeParse({ ...e, reason: "unknown" }).success).toBe(false);
  });
});

describe("AG-UI event union — existing events", () => {
  it("round-trips TEXT_MESSAGE_START", () => {
    const e = {
      type: "TEXT_MESSAGE_START",
      message_id: "m1",
      role: "assistant",
      session_id: "s1",
      agent_name: "principal",
    };
    expect(parseEvent(e).type).toBe("TEXT_MESSAGE_START");
  });

  it("round-trips TEXT_MESSAGE_CONTENT", () => {
    expect(
      parseEvent({ type: "TEXT_MESSAGE_CONTENT", message_id: "m1", delta: "hi" }).type,
    ).toBe("TEXT_MESSAGE_CONTENT");
  });

  it("round-trips TOOL_CALL_START / ARGS / END / RESULT", () => {
    expect(
      parseEvent({ type: "TOOL_CALL_START", tool_call_id: "t1", tool_call_name: "bash" }).type,
    ).toBe("TOOL_CALL_START");
    expect(parseEvent({ type: "TOOL_CALL_ARGS", tool_call_id: "t1", delta: "{" }).type).toBe(
      "TOOL_CALL_ARGS",
    );
    expect(parseEvent({ type: "TOOL_CALL_END", tool_call_id: "t1" }).type).toBe("TOOL_CALL_END");
    expect(
      parseEvent({ type: "TOOL_CALL_RESULT", tool_call_id: "t1", content: "ok", is_error: false })
        .type,
    ).toBe("TOOL_CALL_RESULT");
  });

  it("round-trips RUN_STARTED / FINISHED / ERROR", () => {
    expect(parseEvent({ type: "RUN_STARTED", run_id: "r1" }).type).toBe("RUN_STARTED");
    expect(parseEvent({ type: "RUN_FINISHED", run_id: "r1", result: { ok: 1 } }).type).toBe(
      "RUN_FINISHED",
    );
    expect(parseEvent({ type: "RUN_ERROR", message: "boom", code: "X" }).type).toBe("RUN_ERROR");
  });

  it("round-trips MESSAGES_SNAPSHOT with a message", () => {
    const e = {
      type: "MESSAGES_SNAPSHOT",
      session_id: "s1",
      messages: [
        { id: "m1", role: "assistant", content: "hi", agent_name: "librarian", unfinished: true },
      ],
    };
    expect(parseEvent(e).type).toBe("MESSAGES_SNAPSHOT");
  });

  it("round-trips CUSTOM (session_state channel)", () => {
    const e = {
      type: "CUSTOM",
      session_id: "s1",
      name: "session_state",
      value: { runState: { active: true, runId: "r1" } },
    };
    expect(parseEvent(e).type).toBe("CUSTOM");
  });

  it("round-trips agent_status_update with lastError and retry progress", () => {
    const e = {
      type: "agent_status_update",
      name: "librarian",
      status: "error",
      active_run_id: "r1",
      active_tool_executions: ["t1"],
      retry: { attempt: 2, maxAttempts: 5, delayMs: 4_000 },
      last_error: { message: "x", timestamp: "t", consecutive_count: 2 },
    };
    expect(parseEvent(e).type).toBe("agent_status_update");
  });

  it("agent_status_update rejects an invalid status", () => {
    expect(safeParseEvent({ type: "agent_status_update", name: "a", status: "boom" }).success).toBe(
      false,
    );
  });
});

describe("discriminated union behavior", () => {
  it("rejects an unknown type", () => {
    expect(safeParseEvent({ type: "NOT_A_REAL_EVENT" }).success).toBe(false);
    expect(isAgUiEvent({ type: "NOPE" })).toBe(false);
  });

  it("rejects a malformed payload for a known type", () => {
    // TOOL_CALL_START missing required tool_call_name
    expect(safeParseEvent({ type: "TOOL_CALL_START", tool_call_id: "t1" }).success).toBe(false);
  });

  it("rejects a non-object", () => {
    expect(safeParseEvent(42).success).toBe(false);
    expect(safeParseEvent(null).success).toBe(false);
  });

  it("AG_UI_EVENT_TYPES has 23 entries matching the union", () => {
    // 23 type strings (CUSTOM is the shared channel for session_state etc.)
    expect(new Set(AG_UI_EVENT_TYPES).size).toBe(23);
    // Every catalogued type parses with a minimal-ish payload via the union's
    // option set: spot check that each is a recognized discriminator.
    const optionTypes = new Set(
      AgUiEventSchema.options.map((o) => o.shape.type.value as string),
    );
    for (const t of AG_UI_EVENT_TYPES) {
      expect(optionTypes.has(t)).toBe(true);
    }
  });

  it("CUSTOM(name=compaction) value schema validates start + end shapes", () => {
    const start = CompactionCustomValueSchema.parse({ op: "start", reason: "threshold" });
    expect(start.op).toBe("start");

    const end = CompactionCustomValueSchema.parse({
      op: "end",
      reason: "threshold",
      aborted: false,
      willRetry: false,
      tokensBefore: 195000,
      estimatedTokensAfter: 24000,
      firstKeptEntryId: "u_42",
    });
    if (end.op === "end") expect(end.tokensBefore).toBe(195000);

    // Wrapped as an AG-UI CUSTOM event — full-union round trip.
    const wrapped = parseEvent({
      type: "CUSTOM",
      session_id: "s1",
      name: CUSTOM_EVENT.COMPACTION,
      value: { op: "start", reason: "overflow" },
    });
    expect((wrapped as { name?: string }).name).toBe("compaction");

    // Rejects unknown op / reason.
    expect(CompactionCustomValueSchema.safeParse({ op: "middle", reason: "threshold" }).success).toBe(false);
    expect(CompactionCustomValueSchema.safeParse({ op: "start", reason: "nope" }).success).toBe(false);
  });

  it("CUSTOM domain-resource usage exposes counts without resource contents", () => {
    const value = DomainResourceUsageValueSchema.parse({
      schemaVersion: "1.0",
      kind: "skill_load",
      skillName: "fmri-analysis",
      source: "router",
    });
    expect(value.skillName).toBe("fmri-analysis");
    expect(value).not.toHaveProperty("query");
    expect(value).not.toHaveProperty("content");
    expect(DomainResourceUsageValueSchema.safeParse({
      schemaVersion: "1.0",
      kind: "skill_load",
      source: "router",
      query: "private query",
    }).success).toBe(false);
    const wrapped = parseEvent({
      type: "CUSTOM",
      session_id: "s1",
      agent_name: "engineer",
      name: CUSTOM_EVENT.DOMAIN_RESOURCE_USAGE,
      value,
    });
    expect((wrapped as { name?: string }).name).toBe("domain_resource_usage");
  });

  it("CUSTOM task_state reuses snapshot and incremental AG-UI shapes", () => {
    const task = {
      id: "task_000001",
      seq: 1,
      created_by: "principal",
      assigned_to: "engineer",
      content: "implement",
      status: "pending" as const,
      created_at: 1,
    };
    expect(TaskStateValueSchema.parse({ op: "snapshot", tasks: [task] })).toEqual({ op: "snapshot", tasks: [task] });
    expect(TaskStateValueSchema.parse({ op: "created", task })).toEqual({ op: "created", task });
    expect(CUSTOM_EVENT.TASK_STATE).toBe("task_state");
    expect(TaskStateValueSchema.safeParse({ op: "failed", task }).success).toBe(false);
  });

  it("passthrough keeps forward-compat extras", () => {
    const parsed = parseEvent({
      type: "TEXT_MESSAGE_CONTENT",
      message_id: "m1",
      delta: "x",
      futureField: 123,
    }) as Record<string, unknown>;
    expect(parsed.futureField).toBe(123);
  });
});
