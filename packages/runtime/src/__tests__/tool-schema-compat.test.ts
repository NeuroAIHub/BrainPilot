import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { realAgentFactory } from "../agent-factory.js";
import type { SystemTool } from "../types.js";

const roots: string[] = [];
const servers: Server[] = [];
const originalAgentDir = process.env.PI_CODING_AGENT_DIR;

afterEach(async () => {
  if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
  await Promise.all(
    servers.splice(0).map(
      (server) => new Promise<void>((resolve) => server.close(() => resolve())),
    ),
  );
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function schemasMissingRequired(schema: unknown, at = "parameters"): string[] {
  if (Array.isArray(schema)) {
    return schema.flatMap((entry, index) => schemasMissingRequired(entry, `${at}[${index}]`));
  }
  if (typeof schema !== "object" || schema === null) return [];

  const value = schema as Record<string, unknown>;
  const missing = value.type === "object" && !Array.isArray(value.required) ? [at] : [];
  return [
    ...missing,
    ...Object.entries(value).flatMap(([key, entry]) =>
      schemasMissingRequired(entry, `${at}.${key}`),
    ),
  ];
}

function optionalTool(name: string, parameters: Record<string, unknown>): SystemTool {
  return {
    name,
    description: `${name} fixture`,
    parameters,
    execute: async () => ({ content: [{ type: "text", text: "ok" }] }),
  };
}

describe("OpenAI-compatible tool schemas (#452)", () => {
  it("normalizes built-in and custom schemas before the provider request", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "bp-tool-schema-"));
    roots.push(root);
    process.env.PI_CODING_AGENT_DIR = path.join(root, "agent");

    const payloads: Array<Record<string, unknown>> = [];
    let schemaRejections = 0;
    const server = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const payload = JSON.parse(
        Buffer.concat(chunks).toString("utf8"),
      ) as Record<string, unknown>;
      payloads.push(payload);

      const tools = Array.isArray(payload.tools) ? payload.tools : [];
      const invalidToolIndex = tools.findIndex((tool) => {
        const parameters = (tool as { function?: { parameters?: unknown } })
          .function?.parameters;
        return schemasMissingRequired(parameters).length > 0;
      });
      if (invalidToolIndex !== -1) {
        schemaRejections += 1;
        response.writeHead(400, { "content-type": "application/json" });
        response.end(JSON.stringify({
          error: {
            type: "invalid_request_error",
            message:
              `Tool ${invalidToolIndex} function has invalid 'parameters' schema: ` +
              "None is not of type 'array' on schema['required']",
          },
        }));
        return;
      }

      response.writeHead(200, { "content-type": "text/event-stream" });
      response.write(
        `data: ${JSON.stringify({
          id: "chatcmpl-tool-schema",
          object: "chat.completion.chunk",
          created: 0,
          model: "moonshot-test",
          choices: [{ index: 0, delta: { role: "assistant", content: "ok" }, finish_reason: null }],
        })}\n\n`,
      );
      response.write(
        `data: ${JSON.stringify({
          id: "chatcmpl-tool-schema",
          object: "chat.completion.chunk",
          created: 0,
          model: "moonshot-test",
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        })}\n\n`,
      );
      response.end("data: [DONE]\n\n");
    });
    servers.push(server);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("expected TCP server address");
    }

    const session = await realAgentFactory({
      sessionId: "tool-schema-session",
      agentName: "principal",
      role: "principal",
      historyPath: path.join(root, "history.jsonl"),
      cwd: root,
      systemPrompt: "Answer with ok.",
      allowedToolNames: [
        "ls",
        "search_papers_local",
        "get_trace_graph",
        "nested_optional",
      ],
      suppressCoordinationHooks: true,
      providerConfig: {
        providerId: "kimi-test",
        baseUrl: `http://127.0.0.1:${address.port}/v1`,
        api: "openai-completions",
        apiKey: "test-key",
        modelId: "moonshot-test",
      },
      systemTools: [
        optionalTool("search_papers_local", {
          type: "object",
          properties: { title: { type: "string" } },
        }),
        optionalTool("get_trace_graph", { type: "object", properties: {} }),
        optionalTool("nested_optional", {
          type: "object",
          properties: {
            filter: {
              type: "object",
              properties: { query: { type: "string" } },
            },
          },
          required: ["filter"],
        }),
      ],
    });

    try {
      await session.prompt("hello");
    } finally {
      session.dispose();
    }

    expect(schemaRejections).toBe(0);
    expect(payloads).toHaveLength(1);
    const tools = payloads[0]?.tools as Array<{
      function: { name: string; parameters: Record<string, unknown> };
    }>;
    expect(
      tools.find((tool) => tool.function.name === "ls")?.function.parameters.required,
    ).toEqual([]);
    expect(
      tools.find((tool) => tool.function.name === "search_papers_local")
        ?.function.parameters.required,
    ).toEqual([]);
    expect(
      tools.find((tool) => tool.function.name === "get_trace_graph")
        ?.function.parameters.required,
    ).toEqual([]);
    const nested = tools.find((tool) => tool.function.name === "nested_optional")
      ?.function.parameters;
    expect(nested?.required).toEqual(["filter"]);
    expect(
      (nested?.properties as { filter?: { required?: unknown } })?.filter?.required,
    ).toEqual([]);
  });
});
