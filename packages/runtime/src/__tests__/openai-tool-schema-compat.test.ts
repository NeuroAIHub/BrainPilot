import { describe, expect, it } from "vitest";
import {
  makeOpenAiToolSchemaCompatExt,
  normalizeToolSchema,
} from "../extensions/openai-tool-schema-compat.js";

describe("normalizeToolSchema", () => {
  it("adds empty required arrays to all-optional and empty object schemas", () => {
    expect(normalizeToolSchema({
      type: "object",
      properties: { query: { type: "string" } },
    })).toEqual({
      type: "object",
      properties: { query: { type: "string" } },
      required: [],
    });
    expect(
      normalizeToolSchema({ type: "object", properties: {}, required: null }),
    ).toEqual({
      type: "object",
      properties: {},
      required: [],
    });
  });

  it("normalizes nested object schemas through properties, items, and combinators", () => {
    expect(normalizeToolSchema({
      type: "object",
      properties: {
        filter: {
          type: "object",
          properties: { query: { type: "string" } },
        },
        rows: {
          type: "array",
          items: { type: "object", properties: {} },
        },
      },
      oneOf: [
        { type: "object", properties: { title: { type: "string" } } },
      ],
      anyOf: [{ type: "object", properties: {} }],
      allOf: [{ type: "object", properties: {} }],
    })).toEqual({
      type: "object",
      properties: {
        filter: {
          type: "object",
          properties: { query: { type: "string" } },
          required: [],
        },
        rows: {
          type: "array",
          items: { type: "object", properties: {}, required: [] },
        },
      },
      oneOf: [
        { type: "object", properties: { title: { type: "string" } }, required: [] },
      ],
      anyOf: [{ type: "object", properties: {}, required: [] }],
      allOf: [{ type: "object", properties: {}, required: [] }],
      required: [],
    });
  });

  it("preserves existing required arrays and invalid non-array values", () => {
    expect(normalizeToolSchema({
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    })).toEqual({
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    });
    expect(normalizeToolSchema({ type: "object", required: "query" })).toEqual({
      type: "object",
      required: "query",
    });
  });

  it("returns a deep clone without changing schema-valued defaults", () => {
    const schema = {
      type: "object",
      properties: {
        options: { type: "object", properties: {} },
      },
      default: { type: "object" },
    };
    const normalized = normalizeToolSchema(schema) as typeof schema & { required: [] };

    expect(normalized).not.toBe(schema);
    expect(normalized.properties).not.toBe(schema.properties);
    expect(normalized.default).toEqual({ type: "object" });
    expect(normalized.required).toEqual([]);
    expect(schema).not.toHaveProperty("required");
  });
});

type PayloadHandler = (
  event: { payload: unknown },
  context: { model?: { api?: string } },
) => unknown;

function install(): PayloadHandler {
  let handler: PayloadHandler | undefined;
  makeOpenAiToolSchemaCompatExt()({
    on(_event, callback) {
      handler = callback;
    },
  });
  if (!handler) throw new Error("before_provider_request handler was not registered");
  return handler;
}

describe("makeOpenAiToolSchemaCompatExt", () => {
  it("normalizes final Chat Completions tool payloads", () => {
    const handler = install();
    const payload = {
      model: "moonshot-test",
      tools: [
        {
          type: "function",
          function: {
            name: "ls",
            parameters: { type: "object", properties: {} },
          },
        },
      ],
    };

    const result = handler(
      { payload },
      { model: { api: "openai-completions" } },
    ) as {
      tools: Array<{ function: { parameters: Record<string, unknown> } }>;
    };
    expect(result.tools[0]?.function.parameters.required).toEqual([]);
    expect(payload.tools[0]?.function.parameters).not.toHaveProperty("required");
  });

  it("leaves non-Chat-Completions provider payloads unchanged", () => {
    const handler = install();
    const payload = {
      tools: [{ name: "ls", parameters: { type: "object", properties: {} } }],
    };

    expect(handler(
      { payload },
      { model: { api: "anthropic-messages" } },
    )).toBeUndefined();
    expect(payload.tools[0]?.parameters).not.toHaveProperty("required");
  });
});
