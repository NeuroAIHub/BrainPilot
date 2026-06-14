import { describe, it, expect } from "vitest";
import {
  BrainPilotClient,
  parseSseStream,
  fillPath,
  isTerminalEvent,
  DEFAULT_BASE_URL,
} from "./client.js";
import { driveSession } from "./driver.js";
import { RUNTIME_ROUTES, type AgUiEvent } from "@brainpilot/protocol";

describe("fillPath", () => {
  it("fills :id params from RUNTIME_ROUTES templates", () => {
    expect(fillPath(RUNTIME_ROUTES.sendMessage.path, { id: "abc" })).toBe(
      "/sessions/abc/messages",
    );
    expect(fillPath(RUNTIME_ROUTES.sessionEvents.path, { id: "s1" })).toBe(
      "/sse/s1",
    );
  });

  it("url-encodes param values", () => {
    expect(fillPath("/sessions/:id", { id: "a/b" })).toBe("/sessions/a%2Fb");
  });

  it("throws on a missing param", () => {
    expect(() => fillPath("/sessions/:id", {})).toThrow(/Missing path param/);
  });
});

describe("BrainPilotClient.url", () => {
  it("builds absolute URLs from the protocol routes (SSOT)", () => {
    const c = new BrainPilotClient({ baseUrl: "http://localhost:9001/api" });
    expect(c.url(RUNTIME_ROUTES.health.path)).toBe(
      "http://localhost:9001/api/health",
    );
    expect(c.url(RUNTIME_ROUTES.createSession.path)).toBe(
      "http://localhost:9001/api/sessions",
    );
    expect(c.url(RUNTIME_ROUTES.sendMessage.path, { id: "x" })).toBe(
      "http://localhost:9001/api/sessions/x/messages",
    );
  });

  it("strips a trailing slash from the base URL", () => {
    const c = new BrainPilotClient({ baseUrl: "http://h:1/api/" });
    expect(c.url("/health")).toBe("http://h:1/api/health");
  });

  it("defaults to the backend /api base", () => {
    expect(new BrainPilotClient().baseUrl).toBe(DEFAULT_BASE_URL);
  });

  it("supports a runtime-direct base URL", () => {
    const c = new BrainPilotClient({ baseUrl: "http://localhost:8081" });
    expect(c.url(RUNTIME_ROUTES.listAgents.path, { id: "s" })).toBe(
      "http://localhost:8081/sessions/s/agents",
    );
  });
});

/** Build a ReadableStream from string chunks (simulating wire fragmentation). */
function streamFrom(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(enc.encode(chunks[i++]!));
      } else {
        controller.close();
      }
    },
  });
}

async function collect(
  gen: AsyncGenerator<AgUiEvent>,
): Promise<AgUiEvent[]> {
  const out: AgUiEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

describe("parseSseStream", () => {
  it("parses well-formed SSE frames into AG-UI events", async () => {
    const body = streamFrom([
      'data: {"type":"RUN_STARTED","run_id":"r1"}\n\n',
      'data: {"type":"TEXT_MESSAGE_CONTENT","message_id":"m","delta":"hi"}\n\n',
      'data: {"type":"RUN_FINISHED","run_id":"r1"}\n\n',
    ]);
    const events = await collect(parseSseStream(body));
    expect(events.map((e) => (e as { type: string }).type)).toEqual([
      "RUN_STARTED",
      "TEXT_MESSAGE_CONTENT",
      "RUN_FINISHED",
    ]);
  });

  it("reassembles frames split across chunk boundaries", async () => {
    const body = streamFrom([
      'data: {"type":"RUN_',
      'STARTED","run_id":"r1"}',
      "\n\n",
      'data: {"type":"RUN_FINISHED","run_id":"r1"}\n\n',
    ]);
    const events = await collect(parseSseStream(body));
    expect(events).toHaveLength(2);
    expect((events[1] as { type: string }).type).toBe("RUN_FINISHED");
  });

  it("skips comments, [DONE], and non-JSON data lines", async () => {
    const body = streamFrom([
      ": keep-alive\n\n",
      "data: [DONE]\n\n",
      "data: not json\n\n",
      'data: {"type":"RUN_FINISHED","run_id":"r"}\n\n',
    ]);
    const events = await collect(parseSseStream(body));
    expect(events).toHaveLength(1);
    expect((events[0] as { type: string }).type).toBe("RUN_FINISHED");
  });

  it("handles multi-line data fields and CRLF separators", async () => {
    const body = streamFrom([
      'data: {"type":"CUSTOM",\r\ndata: "name":"x"}\r\n\r\n',
    ]);
    const events = await collect(parseSseStream(body));
    expect(events).toHaveLength(1);
    expect((events[0] as { type: string }).type).toBe("CUSTOM");
  });
});

describe("isTerminalEvent", () => {
  it("is true for RUN_FINISHED / RUN_ERROR", () => {
    expect(isTerminalEvent({ type: "RUN_FINISHED", run_id: "r" } as AgUiEvent)).toBe(true);
    expect(isTerminalEvent({ type: "RUN_ERROR", message: "x", code: "E" } as AgUiEvent)).toBe(true);
  });
  it("is false for content events", () => {
    expect(
      isTerminalEvent({ type: "TEXT_MESSAGE_CONTENT", message_id: "m", delta: "d" } as AgUiEvent),
    ).toBe(false);
  });
});

describe("driveSession", () => {
  it("creates a session, sends a message, and stops on RUN_FINISHED", async () => {
    const calls: string[] = [];
    const fetchFn = (async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method ?? "GET";
      calls.push(`${method} ${u}`);
      if (u.endsWith("/sessions") && method === "POST") {
        return new Response(JSON.stringify({ id: "sess-1" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (u.endsWith("/messages") && method === "POST") {
        return new Response(JSON.stringify({ accepted: true }), { status: 200 });
      }
      if (u.includes("/sse/")) {
        return new Response(
          streamFrom([
            'data: {"type":"RUN_STARTED","run_id":"r1"}\n\n',
            'data: {"type":"TEXT_MESSAGE_CONTENT","message_id":"m","delta":"hello"}\n\n',
            'data: {"type":"RUN_FINISHED","run_id":"r1"}\n\n',
            // This event must NOT be consumed — we stop at RUN_FINISHED.
            'data: {"type":"TEXT_MESSAGE_CONTENT","message_id":"m2","delta":"after"}\n\n',
          ]),
          { status: 200, headers: { "content-type": "text/event-stream" } },
        );
      }
      return new Response("", { status: 404 });
    }) as unknown as typeof fetch;

    const result = await driveSession(
      { baseUrl: "http://localhost:9001/api", message: "go" },
      { fetchFn },
    );

    expect(result.sessionId).toBe("sess-1");
    expect(result.reason).toBe("terminal");
    expect(result.events.map((e) => (e as { type: string }).type)).toEqual([
      "RUN_STARTED",
      "TEXT_MESSAGE_CONTENT",
      "RUN_FINISHED",
    ]);
    // Verify it created the session and posted a message via the right routes.
    expect(calls.some((c) => c === "POST http://localhost:9001/api/sessions")).toBe(true);
    expect(
      calls.some((c) => c === "POST http://localhost:9001/api/sessions/sess-1/messages"),
    ).toBe(true);
  });

  it("respects maxEvents as a safety bound", async () => {
    const fetchFn = (async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method ?? "GET";
      if (u.endsWith("/sessions") && method === "POST")
        return new Response(JSON.stringify({ id: "s" }), { status: 200 });
      if (u.endsWith("/messages"))
        return new Response(JSON.stringify({ accepted: true }), { status: 200 });
      return new Response(
        streamFrom([
          'data: {"type":"TEXT_MESSAGE_CONTENT","message_id":"m","delta":"1"}\n\n',
          'data: {"type":"TEXT_MESSAGE_CONTENT","message_id":"m","delta":"2"}\n\n',
          'data: {"type":"TEXT_MESSAGE_CONTENT","message_id":"m","delta":"3"}\n\n',
        ]),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const result = await driveSession(
      { baseUrl: "http://h/api", message: "x", maxEvents: 2 },
      { fetchFn },
    );
    expect(result.reason).toBe("max_events");
    expect(result.events).toHaveLength(2);
  });
});
