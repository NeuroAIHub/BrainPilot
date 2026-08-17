/**
 * Normalize JSON Schemas at the final OpenAI Chat Completions payload boundary.
 *
 * Some OpenAI-compatible gateways materialize an omitted `required` keyword as
 * null and then reject the otherwise-valid all-optional object schema (#452).
 * Running as the last inline `before_provider_request` extension covers every
 * active tool source after Pi has combined built-ins, custom tools, and MCP or
 * package extensions.
 */

const SINGLE_SCHEMA_KEYS = new Set([
  "additionalItems",
  "additionalProperties",
  "contains",
  "else",
  "if",
  "items",
  "not",
  "propertyNames",
  "then",
  "unevaluatedItems",
  "unevaluatedProperties",
]);

const ARRAY_SCHEMA_KEYS = new Set([
  "allOf",
  "anyOf",
  "oneOf",
  "prefixItems",
]);

const MAP_SCHEMA_KEYS = new Set([
  "$defs",
  "definitions",
  "dependentSchemas",
  "patternProperties",
  "properties",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cloneJsonValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, cloneJsonValue(entry)]),
  );
}

function normalizeSchemaList(value: unknown): unknown {
  return Array.isArray(value)
    ? value.map((schema) => normalizeToolSchema(schema))
    : cloneJsonValue(value);
}

function normalizeSchemaMap(value: unknown): unknown {
  if (!isRecord(value)) return cloneJsonValue(value);
  return Object.fromEntries(
    Object.entries(value).map(([key, schema]) => [key, normalizeToolSchema(schema)]),
  );
}

/** Deep-clone one JSON Schema and add `required: []` to object schemas that omit it. */
export function normalizeToolSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map((entry) => normalizeToolSchema(entry));
  if (!isRecord(schema)) return schema;

  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (SINGLE_SCHEMA_KEYS.has(key)) {
      normalized[key] = Array.isArray(value)
        ? value.map((entry) => normalizeToolSchema(entry))
        : normalizeToolSchema(value);
    } else if (ARRAY_SCHEMA_KEYS.has(key)) {
      normalized[key] = normalizeSchemaList(value);
    } else if (MAP_SCHEMA_KEYS.has(key)) {
      normalized[key] = normalizeSchemaMap(value);
    } else if (key === "dependencies" && isRecord(value)) {
      normalized[key] = Object.fromEntries(
        Object.entries(value).map(([dependency, entry]) => [
          dependency,
          Array.isArray(entry) ? cloneJsonValue(entry) : normalizeToolSchema(entry),
        ]),
      );
    } else {
      normalized[key] = cloneJsonValue(value);
    }
  }

  if (normalized.type === "object" && normalized.required == null) {
    normalized.required = [];
  }
  return normalized;
}

function normalizeOpenAiCompletionsPayload(payload: unknown): unknown {
  if (!isRecord(payload) || !Array.isArray(payload.tools)) return payload;

  return {
    ...payload,
    tools: payload.tools.map((tool) => {
      if (!isRecord(tool) || !isRecord(tool.function)) return cloneJsonValue(tool);
      if (!("parameters" in tool.function)) return cloneJsonValue(tool);
      return {
        ...tool,
        function: {
          ...tool.function,
          parameters: normalizeToolSchema(tool.function.parameters),
        },
      };
    }),
  };
}

interface OpenAiToolSchemaCompatApi {
  on(
    event: "before_provider_request",
    handler: (
      event: { payload: unknown },
      context: { model?: { api?: string } },
    ) => unknown,
  ): void;
}

/** Build the final-payload compatibility extension for OpenAI Chat Completions. */
export function makeOpenAiToolSchemaCompatExt(): (
  pi: OpenAiToolSchemaCompatApi,
) => void {
  return (pi) => {
    pi.on("before_provider_request", (event, context) => {
      if (context.model?.api !== "openai-completions") return undefined;
      return normalizeOpenAiCompletionsPayload(event.payload);
    });
  };
}
