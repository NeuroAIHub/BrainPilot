import { describe, expect, it } from "vitest";
import {
  assertWorkflowAgentRequest, assertWorkflowJson, assertWorkflowModelBinding,
  assertWorkflowResult, compileWorkflowValidator, defineWorkflow,
  isSafeWorkflowOutputPath, parseWorkflowDefinition, type WorkflowDefinition,
} from "./workflow.js";

const definition: WorkflowDefinition = {
  schemaVersion: 1, id: "table-qc", version: "0.1.0", title: "Table quality check",
  description: "Checks supplied observations, without inferring missing units.",
  applicableWhen: ["A structured table and its units are supplied."],
  notApplicableWhen: ["Only a conceptual explanation is requested."],
  requiredCapabilities: ["text"], resume: false,
  inputSchema: {
    $schema: "https://json-schema.org/draft/2020-12/schema", type: "object",
    required: ["values"], properties: { values: { type: "array", minItems: 1, items: { type: "number" } } },
    additionalProperties: false,
  },
  outputSchema: { type: "object", required: ["count"], properties: { count: { type: "integer", minimum: 1 } }, additionalProperties: false },
};

describe("experimental Workflow SDK", () => {
  it("validates a non-writing definition and freezes a defensive copy", () => {
    const source = structuredClone(definition);
    const implementation = defineWorkflow({ definition: source, run: async () => ({ summary: "done", artifacts: [], data: { count: 1 } }) });
    source.applicableWhen.push("mutated later");
    expect(implementation.definition.applicableWhen).toHaveLength(1);
    expect(Object.isFrozen(implementation.definition.inputSchema)).toBe(true);
  });

  it("rejects unsupported definition fields and resume claims", () => {
    expect(() => parseWorkflowDefinition({ ...definition, resume: true })).toThrow();
    expect(() => parseWorkflowDefinition({ ...definition, provider: "override" })).toThrow();
    expect(() => parseWorkflowDefinition({ ...definition, applicableWhen: [] })).toThrow();
  });

  it("uses strict 2020-12 semantics rather than coercing or dropping data", () => {
    const validate = compileWorkflowValidator({
      $schema: "https://json-schema.org/draft/2020-12/schema", type: "object",
      $defs: { value: { type: "integer", minimum: 1 } },
      properties: { count: { $ref: "#/$defs/value" } }, required: ["count"], unevaluatedProperties: false,
    }, "table output");
    expect(() => validate({ count: 2 })).not.toThrow();
    expect(() => validate({ count: "2" })).toThrow();
    expect(() => validate({ count: 0 })).toThrow();
    expect(() => validate({ count: 2, invented: true })).toThrow();
    expect(() => compileWorkflowValidator({ type: "object", misspelledKeyword: true }, "bad")).toThrow();
  });

  it("separates domain output data from the shared result envelope", () => {
    const result = { summary: "Two observations checked.", artifacts: [], data: { count: 2 } };
    expect(() => assertWorkflowResult(result)).not.toThrow();
    const validateData = compileWorkflowValidator(definition.outputSchema, "output data");
    expect(() => validateData(result.data)).not.toThrow();
    expect(() => validateData(result)).toThrow();
    expect(() => assertWorkflowResult({ summary: "done", artifacts: [] })).toThrow();
  });

  it("rejects credentials and per-stage model overrides", () => {
    const binding = { id: "opaque-1", providerId: "provider", modelId: "model", thinkingLevel: "medium" };
    expect(() => assertWorkflowModelBinding(binding)).not.toThrow();
    expect(() => assertWorkflowModelBinding({ ...binding, apiKey: "must-not-persist" })).toThrow();
    const stage = { stageId: "qc", instructions: "Check values", inputs: {}, outputSchema: true };
    expect(() => assertWorkflowAgentRequest(stage)).not.toThrow();
    expect(() => assertWorkflowAgentRequest({ ...stage, model: "other" })).toThrow();
    // A stage may widen its own deadline, but only with a real whole-millisecond
    // value inside the supported range.
    expect(() => assertWorkflowAgentRequest({ ...stage, timeoutMs: 20_000 })).not.toThrow();
    expect(() => assertWorkflowAgentRequest({ ...stage, timeoutMs: 1_200_000 })).not.toThrow();
    for (const timeoutMs of [0, -1, 1.5, 1_200_001, "20000"]) {
      expect(() => assertWorkflowAgentRequest({ ...stage, timeoutMs })).toThrow();
    }
  });

  it("rejects lossy JSON and unsafe output paths", () => {
    expect(() => assertWorkflowJson({ value: Number.NaN })).toThrow();
    expect(() => assertWorkflowJson({ value: undefined })).toThrow();
    expect(() => assertWorkflowJson(new Date())).toThrow();
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => assertWorkflowJson(cyclic)).toThrow();
    for (const path of ["/outside", "../outside", "x/../outside", "C:/outside", "a\\b", "a//b", "./report.md"]) expect(isSafeWorkflowOutputPath(path)).toBe(false);
    expect(isSafeWorkflowOutputPath("reports/summary.md")).toBe(true);
  });
});
