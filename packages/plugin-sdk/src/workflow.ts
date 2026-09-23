import { Ajv2020 } from "ajv/dist/2020.js";
import type { ValidateFunction } from "ajv";
import { valid } from "semver";

/** Experimental host-owned workflow contract; independent of Manifest v1. */
export const WORKFLOW_PROTOCOL_VERSION = "1" as const;
export type WorkflowJsonSchema = boolean | Record<string, unknown>;

export interface WorkflowDefinition {
  schemaVersion: 1;
  id: string;
  version: string;
  title: string;
  description: string;
  applicableWhen: string[];
  notApplicableWhen: string[];
  requiredCapabilities: string[];
  inputSchema: WorkflowJsonSchema;
  /** Validates result.data, not the common summary/artifacts envelope. */
  outputSchema: WorkflowJsonSchema;
  resume: false;
}

/** Public identity only. Opaque Pi objects and credentials remain with the host. */
export interface WorkflowModelBinding {
  id: string;
  providerId: string;
  modelId: string;
  thinkingLevel: string;
  api?: string;
}

export interface WorkflowArtifact {
  path: string;
  mediaType: string;
  role: string;
  sha256: string;
  producerRunId: string;
  stageId?: string;
}

export interface WorkflowResult {
  summary: string;
  artifacts: WorkflowArtifact[];
  /** Domain-specific JSON payload validated against definition.outputSchema. */
  data: unknown;
  issues?: string[];
}

export interface WorkflowCheck {
  kind: "scientific" | "capability";
  status: "pass" | "fail" | "unknown";
  message: string;
  /** Missing/unknown required evidence blocks start. Defaults to true. */
  required?: boolean;
}

export interface WorkflowAgentRequest {
  stageId: string;
  instructions: string;
  inputs: unknown;
  outputSchema: WorkflowJsonSchema;
  tools?: string[];
  /** Workspace image paths supplied to the same Pi model as this run. */
  images?: string[];
  /** Per-stage deadline in ms. Absent keeps the host's own stage budget. */
  timeoutMs?: number;
}

export interface WorkflowToolRequest { name: string; input: unknown }
export interface WorkflowToolResult { data: unknown; artifacts: WorkflowArtifact[] }

export interface WorkflowArtifactWrite {
  /** Relative to the host-assigned output directory of this run. */
  path: string;
  content: string;
  mediaType: string;
  role: string;
}

export interface WorkflowEvent {
  type: string;
  stageId?: string;
  message?: string;
}

export interface WorkflowPreflightContext {
  readText(path: string): Promise<string>;
  readonly signal: AbortSignal;
}

export interface WorkflowContext extends WorkflowPreflightContext {
  readonly runId: string;
  readonly modelBinding: Readonly<WorkflowModelBinding>;
  runAgent(request: WorkflowAgentRequest): Promise<unknown>;
  runTool(request: WorkflowToolRequest): Promise<WorkflowToolResult>;
  writeArtifact(request: WorkflowArtifactWrite): Promise<WorkflowArtifact>;
  emit(event: WorkflowEvent): void;
}

export interface WorkflowImplementation {
  readonly definition: WorkflowDefinition;
  run(input: unknown, context: WorkflowContext): Promise<WorkflowResult>;
  preflight?(input: unknown, context: WorkflowPreflightContext): Promise<WorkflowCheck[]>;
}

export type WorkflowRunStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled" | "interrupted";
export interface WorkflowRun {
  id: string;
  sessionId: string;
  turnId?: string;
  workflowId: string;
  workflowVersion: string;
  definition: WorkflowDefinition;
  modelBinding: WorkflowModelBinding;
  idempotencyKey: string;
  input: unknown;
  inputHash: string;
  status: WorkflowRunStatus;
  acceptedAt: string;
  startedAt?: string;
  finishedAt?: string;
  artifacts: WorkflowArtifact[];
  result?: WorkflowResult;
  error?: string;
  terminalDeliveryError?: string;
}

const text = { type: "string", minLength: 1 };
const textList = { type: "array", items: text, uniqueItems: true };
const jsonSchema = { anyOf: [{ type: "boolean" }, { type: "object" }] };
const definitionSchema = {
  type: "object", additionalProperties: false,
  required: ["schemaVersion", "id", "version", "title", "description", "applicableWhen", "notApplicableWhen", "requiredCapabilities", "inputSchema", "outputSchema", "resume"],
  properties: {
    schemaVersion: { const: 1 },
    id: { type: "string", pattern: "^[a-z0-9]+(?:[._-][a-z0-9]+)*$" },
    version: { type: "string", pattern: "^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?(?:\\+[0-9A-Za-z.-]+)?$" },
    title: text, description: text,
    applicableWhen: { ...textList, minItems: 1 },
    notApplicableWhen: textList, requiredCapabilities: textList,
    inputSchema: jsonSchema, outputSchema: jsonSchema, resume: { const: false },
  },
};
const artifactSchema = {
  type: "object", additionalProperties: false,
  required: ["path", "mediaType", "role", "sha256", "producerRunId"],
  properties: {
    path: text, mediaType: text, role: text, producerRunId: text, stageId: text,
    sha256: { type: "string", pattern: "^[a-f0-9]{64}$" },
  },
};
const resultSchema = {
  type: "object", additionalProperties: false, required: ["summary", "artifacts", "data"],
  properties: {
    summary: text, artifacts: { type: "array", items: artifactSchema }, data: true,
    issues: { type: "array", items: { type: "string" } },
  },
};
const bindingSchema = {
  type: "object", additionalProperties: false,
  required: ["id", "providerId", "modelId", "thinkingLevel"],
  properties: { id: text, providerId: text, modelId: text, thinkingLevel: text, api: text },
};
const agentRequestSchema = {
  type: "object", additionalProperties: false,
  required: ["stageId", "instructions", "inputs", "outputSchema"],
  properties: { stageId: text, instructions: text, inputs: true, outputSchema: jsonSchema, tools: textList,
    images: { type: "array", items: text, maxItems: 80 }, timeoutMs: { type: "integer", minimum: 1, maximum: 1_200_000 } },
};

export class WorkflowValidationError extends Error {
  readonly code = "WORKFLOW_VALIDATION";
  constructor(message: string) { super(message); this.name = "WorkflowValidationError"; }
}

/** Reject values that JSON.stringify would silently drop or alter. */
export function assertWorkflowJson(value: unknown, label = "value", parents = new Set<object>()): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (typeof value !== "object" || parents.has(value)) throw new WorkflowValidationError(`${label} must be finite, acyclic JSON`);
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
    throw new WorkflowValidationError(`${label} must contain plain JSON objects`);
  }
  if (Object.getOwnPropertySymbols(value).length) throw new WorkflowValidationError(`${label} must not contain symbol keys`);
  parents.add(value);
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index++) assertWorkflowJson(value[index], `${label}[${index}]`, parents);
  } else {
    for (const [key, item] of Object.entries(value)) assertWorkflowJson(item, `${label}.${key}`, parents);
  }
  parents.delete(value);
}

/** Strict draft-2020-12 validation. No coercion, defaults, remote refs, or format guessing. */
export function compileWorkflowValidator(schema: WorkflowJsonSchema, label: string): (value: unknown) => void {
  assertWorkflowJson(schema, `${label} schema`);
  const ajv = new Ajv2020({ strict: true, allErrors: true, coerceTypes: false, useDefaults: false, removeAdditional: false });
  let validate: ValidateFunction;
  try { validate = ajv.compile(schema); }
  catch (error) { throw new WorkflowValidationError(`${label} schema: ${(error as Error).message}`); }
  return (value: unknown) => {
    assertWorkflowJson(value, label);
    if (!validate(value)) throw new WorkflowValidationError(`${label}: ${ajv.errorsText(validate.errors, { separator: "; " })}`);
  };
}

const validateDefinition = compileWorkflowValidator(definitionSchema, "workflow definition");
const validateArtifact = compileWorkflowValidator(artifactSchema, "workflow artifact");
const validateResult = compileWorkflowValidator(resultSchema, "workflow result");
const validateBinding = compileWorkflowValidator(bindingSchema, "workflow model binding");
const validateAgentRequest = compileWorkflowValidator(agentRequestSchema, "workflow stage request");
const validateChecks = compileWorkflowValidator({
  type: "array", items: {
    type: "object", additionalProperties: false, required: ["kind", "status", "message"],
    properties: { kind: { enum: ["scientific", "capability"] }, status: { enum: ["pass", "fail", "unknown"] }, message: text, required: { type: "boolean" } },
  },
}, "workflow preflight checks");

export function parseWorkflowDefinition(value: unknown): WorkflowDefinition {
  validateDefinition(value);
  const definition = value as WorkflowDefinition;
  if (valid(definition.version) !== definition.version) throw new WorkflowValidationError("workflow version must be an exact SemVer version");
  compileWorkflowValidator(definition.inputSchema, "workflow input");
  compileWorkflowValidator(definition.outputSchema, "workflow output data");
  return JSON.parse(JSON.stringify(definition)) as WorkflowDefinition;
}

export function assertWorkflowModelBinding(value: unknown): asserts value is WorkflowModelBinding { validateBinding(value); }
export function assertWorkflowAgentRequest(value: unknown): asserts value is WorkflowAgentRequest { validateAgentRequest(value); }
export function assertWorkflowChecks(value: unknown): asserts value is WorkflowCheck[] { validateChecks(value); }
export function assertWorkflowArtifact(value: unknown): asserts value is WorkflowArtifact { validateArtifact(value); }
export function assertWorkflowResult(value: unknown): asserts value is WorkflowResult { validateResult(value); }

export function isSafeWorkflowOutputPath(path: string): boolean {
  return Boolean(path.trim()) && !path.startsWith("/") && !path.includes("\\") && !/^[A-Za-z]:/.test(path)
    && !path.includes("\0") && path.split("/").every((part) => part !== ".." && part !== "." && part !== "");
}

/** Freeze descriptions; implementations remain trusted host code, not a security sandbox. */
export function freezeWorkflowValue<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) freezeWorkflowValue(item);
    Object.freeze(value);
  }
  return value;
}

export function defineWorkflow(implementation: WorkflowImplementation): WorkflowImplementation {
  if (typeof implementation.run !== "function" || (implementation.preflight !== undefined && typeof implementation.preflight !== "function")) {
    throw new WorkflowValidationError("workflow requires run and an optional preflight function");
  }
  return Object.freeze({
    definition: freezeWorkflowValue(parseWorkflowDefinition(implementation.definition)),
    run: implementation.run,
    ...(implementation.preflight ? { preflight: implementation.preflight } : {}),
  });
}
