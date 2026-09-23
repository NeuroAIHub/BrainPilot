#!/usr/bin/env node
/** One-shot 208/Linux transport probe. Real Pi + WorkflowHost, no routing/writing claim. */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { inspect } from "node:util";

if (process.platform !== "linux") throw new Error("Run this one-shot probe only on the designated 208 Linux host.");
const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  assert(["--output", "--preflight", "--provider-env"].includes(process.argv[i]) && process.argv[i + 1], "Usage: --output NEW-dir --preflight raw-preflight.json [--provider-env existing.env]");
  args.set(process.argv[i], process.argv[i + 1]);
}
assert(args.has("--output") && args.has("--preflight"));
const output = resolve(args.get("--output"));
const preflightPath = resolve(args.get("--preflight"));
const preflight = JSON.parse(await readFile(preflightPath, "utf8"));
assert(["text", "tool", "image"].every(kind => preflight[kind]?.status === "passed"), "Matching successful raw text/tool/image preflight is required before any Pi call");
assert.equal(preflight.modelId, "kimi-k3", "This one-shot probe is only authorized for the user-selected kimi-k3");
assert(typeof preflight.image.expected === "string" && preflight.image.expected.length > 0);
const credentialReference = args.get("--provider-env") ?? preflight.credentialReference;
assert(typeof credentialReference === "string");
const env = {};
for (const line of (await readFile(credentialReference, "utf8")).split(/\r?\n/)) {
  const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
  if (!match) continue;
  let value = match[2].trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
  env[match[1]] = value; // Data only. Never source or print the credential file.
}
const key = env.SQZ_API_KEY || env.CUSTOM_API_KEY || env.ANTHROPIC_API_KEY;
const baseUrl = env.CUSTOM_BASE_URL || env.ANTHROPIC_BASE_URL;
const api = env.BP_API || env.CUSTOM_API || "anthropic-messages";
const hash = value => createHash("sha256").update(value).digest("hex");
assert(key && baseUrl && hash(baseUrl) === preflight.endpointHash && api === preflight.protocol, "Preflight endpoint/protocol must match the existing credential reference");
const redact = value => String(value).split(key).join("[REDACTED]").split(encodeURIComponent(key)).join("[REDACTED]");
for (const name of ["log", "info", "warn", "error", "debug"]) {
  const original = console[name].bind(console);
  console[name] = (...items) => original(...items.map(item => redact(typeof item === "string" ? item : inspect(item, { depth: 5 }))));
}
await mkdir(output, { recursive: false, mode: 0o700 });
const dataRoot = join(output, "data"); const stateDir = join(output, "state"); const workspaceDir = join(output, "workspace");
await Promise.all([mkdir(join(dataRoot, "bp_template"), { recursive: true }), mkdir(stateDir), mkdir(workspaceDir)]);
Object.assign(process.env, { BP_LOCAL_MODE: "1", BP_DATA_DIR: dataRoot, BP_KB_ROOT: join(output, "knowledge-base"),
  PI_CODING_AGENT_DIR: join(output, "pi-agent"), PI_CODING_AGENT_SESSION_DIR: join(output, "pi-sessions"), BP_PI_IMAGE_PROBE_KEY: key });
delete process.env.BP_MOCK;
const profileId = "kimi-pi-image-probe";
await writeFile(join(dataRoot, "bp_template/providers.json"), JSON.stringify({ selectedProfileId: profileId, profiles: [{
  id: profileId, baseUrl, api, apiKeyEnv: "BP_PI_IMAGE_PROBE_KEY", models: [preflight.modelId], reasoningModels: [preflight.modelId],
  contextWindow: 200_000, inputModalities: { [preflight.modelId]: ["text", "image"] },
}] }, null, 2), { mode: 0o600 });
await cp(join(dirname(preflightPath), "image-check.png"), join(workspaceDir, "image-check.png"));
const sourceImage = await readFile(join(workspaceDir, "image-check.png"));
const report = { boundary: "Real Pi/realAgentFactory/WorkflowHost image plus submit_result transport probe only. Principal instantiated but never prompted. No natural-language routing or manuscript quality was tested.",
  startedAt: new Date().toISOString(), modelId: preflight.modelId, thinkingLevel: "low", protocol: api,
  endpointHash: preflight.endpointHash, credentialReference, preflightPath, imageSha256: hash(sourceImage),
  stageCount: 0, stagePromptCount: 0, successfulSubmissions: 0, usage: [], terminal: [] };
let principal; let host; let timer;
try {
  const { realAgentFactory } = await import("../packages/runtime/dist/agent-factory.js");
  const { resolveSessionProvider } = await import("../packages/runtime/dist/provider-config.js");
  const { WorkflowHost } = await import("../packages/runtime/dist/workflows/host.js");
  const { defineWorkflow } = await import("../packages/plugin-sdk/dist/workflow.js");
  const providerConfig = await resolveSessionProvider(dataRoot, { providerId: profileId, modelId: preflight.modelId }, { requireConfiguredModel: true });
  assert(providerConfig);
  const sessionId = randomUUID();
  principal = await realAgentFactory({ sessionId, agentName: "principal", role: "principal", cwd: workspaceDir,
    historyPath: join(stateDir, "principal.jsonl"), systemTools: [], allowedToolNames: [], skillPaths: [],
    systemPrompt: "Transport probe Principal. No user request is dispatched in this session.",
    suppressCoordinationHooks: true, thinkingLevel: "low", providerConfig });
  const binding = principal.getWorkflowModelBinding();
  assert.equal(binding.model.id, preflight.modelId); assert.equal(binding.thinkingLevel, "low");
  assert(binding.model.input.includes("image"));
  report.principalBinding = { provider: binding.model.provider, modelId: binding.model.id, api: binding.model.api, thinkingLevel: binding.thinkingLevel, input: binding.model.input };
  const schema = { type: "object", additionalProperties: false, required: ["imageText"], properties: { imageText: { type: "string", minLength: 1 } } };
  const definition = { schemaVersion: 1, id: "pi-image-transport-probe", version: "0.1.0", title: "One-shot Pi image transport probe",
    description: report.boundary, applicableWhen: ["Explicit isolated engineering transport check."], notApplicableWhen: ["Scientific or writing tasks."],
    requiredCapabilities: ["agent", "images", "writeArtifact"], inputSchema: { type: "object", additionalProperties: false }, outputSchema: schema, resume: false };
  const implementation = defineWorkflow({ definition, run: async (_, ctx) => {
    const result = await ctx.runAgent({ stageId: "read-image-submit", instructions: "Inspect the attached image. Read the alphanumeric laboratory sample label shown in it. Submit only that label as imageText through submit_result, then finish. Do not guess from filenames or invent text.",
      inputs: { task: "Read the sample label in the attached image." }, images: ["image-check.png"], outputSchema: schema, tools: [] });
    const artifact = await ctx.writeArtifact({ path: "image-result.json", content: JSON.stringify(result), mediaType: "application/json", role: "probe-result" });
    return { summary: "Pi image/tool transport response received.", artifacts: [artifact], data: result };
  } });
  host = new WorkflowHost({ sessionId, workspaceDir, stateDir, persist: true, implementations: () => [implementation], isEnabled: () => true,
    captureBinding: async () => principal.getWorkflowModelBinding(),
    runWithCapacity: async (fn, signal) => { signal.throwIfAborted(); return fn(); },
    onUsage: (stageId, usage) => report.usage.push({ stageId, usage }), onChanged: () => {}, onTerminal: async run => { report.terminal.push({ id: run.id, status: run.status }); },
    stageTimeoutMs: 180_000,
    agentFactory: async params => {
      report.stageCount++;
      assert.equal(params.workflowModelBinding.modelRuntime, binding.modelRuntime);
      assert.equal(params.workflowModelBinding.model.id, binding.model.id);
      assert.equal(params.workflowModelBinding.model.provider, binding.model.provider);
      assert.equal(params.workflowModelBinding.thinkingLevel, "low"); assert.equal(params.thinkingLevel, "low");
      assert.deepEqual(params.allowedToolNames, ["submit_result"]);
      report.samePrincipalBinding = true;
      const session = await realAgentFactory({ ...params, systemTools: params.systemTools.map(tool => ({ ...tool, execute: async args => {
        const response = await tool.execute(args); if (tool.name === "submit_result" && !response.isError) report.successfulSubmissions++;
        return response;
      } })) });
      const prompt = session.prompt.bind(session);
      session.prompt = async (text, opts) => {
        report.stagePromptCount++; assert.equal(opts.images.length, 1); assert.equal(opts.images[0].mimeType, "image/png");
        assert.equal(hash(Buffer.from(opts.images[0].data, "base64")), report.imageSha256);
        assert(!text.includes(preflight.image.expected), "Expected answer must not leak into the model prompt");
        report.imageBytesReachedPi = true;
        return prompt(text, opts);
      };
      return session;
    },
  });
  timer = setTimeout(() => { void host.manager.cancelAll(); }, 210_000);
  const accepted = await host.start({ workflowId: definition.id, input: {}, idempotencyKey: "one-shot" });
  const run = await host.manager.wait(accepted.id); report.run = run;
  assert.equal(run.status, "succeeded", run.error ?? "Pi image/tool stage failed");
  assert.equal(run.result.data.imageText.trim(), preflight.image.expected);
  assert.equal(report.stageCount, 1); assert.equal(report.stagePromptCount, 1); assert.equal(report.successfulSubmissions, 1);
  report.status = "passed";
} catch (error) { report.status = "failed"; report.error = redact(error.stack ?? error); process.exitCode = 1; }
finally {
  clearTimeout(timer); await host?.manager.cancelAll(); await principal?.abort(); principal?.dispose();
  report.finishedAt = new Date().toISOString();
  await writeFile(join(output, "report.json"), redact(JSON.stringify(report, null, 2)), { mode: 0o600 });
  console.log(JSON.stringify({ status: report.status, stageCount: report.stageCount, successfulSubmissions: report.successfulSubmissions,
    samePrincipalBinding: report.samePrincipalBinding, imageBytesReachedPi: report.imageBytesReachedPi, report: join(output, "report.json"), error: report.error }));
}
