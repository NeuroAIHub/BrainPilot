#!/usr/bin/env node
/**
 * ONE-SHOT 208/Linux recovery experiment. No workflow is re-executed.
 * Copies a settled study. terminal mode resumes its saved notification;
 * user-followup mode uses the public sendMessage path with explicit user intent.
 * Run only after operator authorization; --output must be a NEW directory.
 */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { cp, lstat, mkdir, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { inspect } from "node:util";
import { isReadOnlyBash } from "./workflow-readonly-bash.mjs";
import { planArtifactCopies, inspectDeliveryWorkspace, matchDeliveredArtifacts } from "./workflow-delivery-copy-guard.mjs";

const started = Date.now();
const READABLE_TOOLS = ["read", "ls", "grep", "find", "workflow_get", "get_trace_graph", "get_trace_node", "get_trace_neighborhood", "get_trace_diff", "list_monitors"];
function claimLlmRequest(report) {
  report.llmHttpRequestAttempts++;
  if (report.llmHttpRequestsStarted >= report.llmHttpRequestLimit) { report.budgetLimited = true; return false; }
  report.llmHttpRequestsStarted++; return true;
}
function toolGuardSource(callbackKey) {
  return `const isReadOnlyBash = ${isReadOnlyBash.toString()};
  export default function(pi) { pi.on("tool_call", async event => {
    if (${JSON.stringify(READABLE_TOOLS)}.includes(event.toolName) || (event.toolName === "bash" && isReadOnlyBash(event.input?.command))) return;
    if (await globalThis[${JSON.stringify(callbackKey)}]?.(event) === true) return;
    return { block: true, reason: "Delivery-only test: only reads and verified copies of saved artifacts into new deliverables files are allowed; no manuscript edits, research, Expert dispatch or workflow starts." };
  }); }\n`;
}
const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  assert(["--source", "--output", "--provider-env", "--mode", "--max-provider-requests", "--timeout-ms", "--self-check"].includes(process.argv[i]) && process.argv[i + 1], "Usage: --source completed-study --output NEW-directory --provider-env existing.env [--mode terminal|user-followup] [--max-provider-requests N] [--timeout-ms N] | --self-check true");
  args.set(process.argv[i], process.argv[i + 1]);
}
const mode = args.get("--mode") ?? "terminal"; assert(["terminal", "user-followup"].includes(mode));
const userFollowup = mode === "user-followup";
const requestLimit = Number(args.get("--max-provider-requests") ?? (userFollowup ? 2 : 3));
const LIMIT_MS = Number(args.get("--timeout-ms") ?? 180_000);
assert(Number.isSafeInteger(requestLimit) && requestLimit >= 1 && requestLimit <= 6, "Provider request cap must be 1–6.");
assert(Number.isSafeInteger(LIMIT_MS) && LIMIT_MS >= 10_000 && LIMIT_MS <= 300_000, "Timeout must be 10000–300000 ms.");
if (args.get("--self-check") === "true") {
  for (const cap of [2, 3, 6]) {
    const budget = { llmHttpRequestLimit: cap, llmHttpRequestsStarted: 0, llmHttpRequestAttempts: 0 }; let sent = 0;
    for (let attempt = 0; attempt < cap + 2; attempt++) if (claimLlmRequest(budget)) sent++;
    assert.equal(sent, cap); assert.equal(budget.llmHttpRequestsStarted, cap); assert.equal(budget.llmHttpRequestAttempts, cap + 2); assert(budget.budgetLimited);
  }
  const key = `recovery-self-check-${randomUUID()}`; const blocked = []; let handler;
  globalThis[key] = event => blocked.push(event.toolName);
  const module = await import(`data:text/javascript;base64,${Buffer.from(toolGuardSource(key)).toString("base64")}`);
  module.default({ on: (name, fn) => { assert.equal(name, "tool_call"); handler = fn; } });
  for (const toolName of READABLE_TOOLS) assert.equal(await handler({ toolName }), undefined);
  for (const toolName of ["write", "edit", "bash", "create_agent", "dispatch_task", "workflow_start"]) assert.equal((await handler({ toolName })).block, true);
  assert.equal(blocked.length, 6); delete globalThis[key];
  const observedBash = 'cd workflow-runs/wf_ee83b826-7f92-4078-9abb-8447287e9b26/attempt-1 && ls -la final_refined_paper.pdf final_paper.pdf references.bib && pdfinfo final_refined_paper.pdf 2>/dev/null | grep -E "Pages|Page size" ; wc -w final_refined_paper.tex';
  const allowedBash = [observedBash, 'pwd && ls -lh "a file.pdf"', "cat 'paper; literal | name.tex' | head -n 20", "rg --no-config -n 'a; touch literal' paper.tex", 'sha256sum -- final_paper.pdf', "stat -c '%s %n' paper.tex"];
  const blockedBash = ["rm paper.tex", "cat paper | tee copy", "cat paper > copy", "cat paper >> copy", "cat paper < input", "ls 2>errors.log", "ls &", 'cat "$(touch touched)"', "cat `id`", "cat $HOME/file", 'cat "${HOME}/file"', "ls ; touch touched", "bash -c 'ls'", "env cat paper", "command ls", "rg --pre=touch paper", "rg '--pre=touch' paper", "rg --hostname-bin=touch paper", "tail -f paper", "ls &&", "ls || pwd", "ls **", "ls \\\n; touch touched", "cat 'unterminated"];
  for (const command of allowedBash) { assert(isReadOnlyBash(command), `Expected read-only: ${command}`); assert.equal(await handler({ toolName: "bash", input: { command } }), undefined); }
  for (const command of blockedBash) {
    assert.equal(isReadOnlyBash(command), false, `Expected blocked: ${command}`);
    assert.equal((await handler({ toolName: "bash", input: { command } })).block, true);
  }
  const published = new Set(["workflow-runs/test/initial.tex", "workflow-runs/test/final_paper.pdf", "workflow-runs/test/review.json"]);
  const copied = "mkdir -p deliverables/reviews && cp workflow-runs/test/initial.tex deliverables/manuscript_draft.tex && cp workflow-runs/test/final_paper.pdf deliverables/manuscript_draft.pdf && cp workflow-runs/test/review.json deliverables/reviews/review.json";
  const plan = planArtifactCopies(copied, published); assert.equal(plan.copies.length, 3);
  assert(planArtifactCopies("mkdir -p deliverables", published));
  assert.equal(planArtifactCopies("cp workflow-runs/test/initial.tex 'deliverables/'", published).copies[0].target, "deliverables/initial.tex");
  assert(planArtifactCopies("mkdir -p deliverables/reviews && cp -- 'workflow-runs/test/review.json' 'deliverables/reviews/'", published));
  const disallowedCopies = ["mkdir -p deliverables && cp secrets.env deliverables/leaked.env", "cp workflow-runs/test/initial.tex workflow-runs/test/new.tex", "cp workflow-runs/test/initial.tex deliverables/../old.tex", "cp workflow-runs/test/initial.tex deliverables/new.tex; touch bad", "cp -r workflow-runs/test deliverables", "cp workflow-runs/test/initial.tex deliverables/$(id)", "cp workflow-runs/test/initial.tex deliverables/new.tex && sed -i x deliverables/new.tex", "mkdir -p deliverables && cp workflow-runs/test/initial.tex deliverables/a && cp workflow-runs/test/review.json deliverables/a"];
  for (const command of disallowedCopies) assert.equal(planArtifactCopies(command, published), null, command);
  globalThis[key] = async event => event.toolName === "bash" && Boolean(planArtifactCopies(event.input?.command, published));
  assert.equal(await handler({ toolName: "bash", input: { command: copied } }), undefined);
  assert.equal((await handler({ toolName: "bash", input: { command: disallowedCopies[0] } })).block, true); delete globalThis[key];
  const initial = [{ path: "workflow-runs/test/final_paper.pdf", sha256: "pdf", size: 100 }, { path: "workflow-runs/test/final_refined_paper.pdf", sha256: "pdf", size: 100 }];
  const additions = [{ path: "deliverables/manuscript_draft.pdf", sha256: "pdf", size: 100 }];
  const authorized = new Map([[additions[0].path, { ...initial[0], source: initial[0].path }]]);
  assert(inspectDeliveryWorkspace(initial, [...initial, ...additions], authorized).unchanged);
  assert.equal(inspectDeliveryWorkspace(initial, [initial[1], ...additions], authorized).unchanged, false);
  assert.equal(inspectDeliveryWorkspace(initial, [...initial, { ...additions[0], sha256: "rewritten" }], authorized).unchanged, false);
  assert.equal(inspectDeliveryWorkspace(initial, [...initial, { ...additions[0], path: "extra.txt" }], authorized).unchanged, false);
  for (const available of [initial, [...initial, ...additions]]) {
    const text = available.at(-1).path;
    assert.equal(matchDeliveredArtifacts(text, [initial[0]], available)[0].matchingPaths.length, 1);
  }
  assert.equal(matchDeliveredArtifacts("deliverables/manuscript_draft.pdf", [initial[0]], [{ ...additions[0], sha256: "different" }])[0].matchingPaths.length, 0);
  const tex = { path: "deliverables/manuscript_draft.tex", sha256: "tex", size: 200 };
  const boundaryFiles = [additions[0], tex];
  const validArtifactLinks = [
    "[PDF](deliverables/manuscript_draft.pdf)",
    "[PDF](/workspace/deliverables/manuscript_draft.pdf?download=1#page=2)",
    "[PDF](./deliverables/manuscript_draft.pdf#page=2)",
    "[PDF](deliverables%2Fmanuscript_draft%2Epdf?download=1)",
    "100% ready: [PDF](%2Fworkspace%2Fdeliverables%2Fmanuscript_draft.pdf#page=2)",
    "`deliverables/manuscript_draft.pdf`",
    "<deliverables/manuscript_draft.pdf?download=1>",
  ];
  for (const text of validArtifactLinks) assert.deepEqual(matchDeliveredArtifacts(text, [initial[0]], boundaryFiles)[0].matchingPaths, [additions[0].path], text);
  const invalidArtifactLinks = [
    "[PDF](deliverables/manuscript_draft.pdf.png)",
    "[PDF](/workspace/deliverables/manuscript_draft.pdf.png?download=1#page=2)",
    "[PDF](deliverables%2Fmanuscript_draft.pdf%2Epng)",
    "[PDF](prefix/deliverables/manuscript_draft.pdf)",
    "[PDF](prefix-deliverables/manuscript_draft.pdf)",
    "[PDF](/other/deliverables/manuscript_draft.pdf)",
    "[PDF](prefix%2Fdeliverables%2Fmanuscript_draft.pdf)",
    "[PDF](deliverables/manuscript_draft.pdf/preview)",
    "[deliverables/manuscript_draft.pdf](prefix/deliverables/manuscript_draft.pdf)",
    '[PDF](prefix/deliverables/manuscript_draft.pdf "deliverables/manuscript_draft.pdf")',
  ];
  for (const text of invalidArtifactLinks) assert.equal(matchDeliveredArtifacts(text, [initial[0]], boundaryFiles)[0].matchingPaths.length, 0, text);
  for (const text of ["[LaTeX](deliverables/manuscript_draft.tex.bak)", "[LaTeX](deliverables%2Fmanuscript_draft.tex%2Ebak?download=1)"]) {
    assert.equal(matchDeliveredArtifacts(text, [tex], boundaryFiles)[0].matchingPaths.length, 0, text);
  }
  assert.deepEqual(matchDeliveredArtifacts("[LaTeX](/workspace/deliverables/manuscript_draft.tex?raw=1#L2)", [tex], boundaryFiles)[0].matchingPaths, [tex.path]);
  console.log(JSON.stringify({ status: "passed", providerRequests: 0, credentialsRead: false, budgetCaps: [2, 3, 6], allowedReadTools: READABLE_TOOLS.length, blockedMutationTools: blocked, allowedBashCases: allowedBash.length, blockedBashCases: blockedBash.length, actual02CommandAllowed: true, identicalCopyCases: 3, mkdirOnlyAllowed: true, blockedCopyCases: disallowedCopies.length, deltaValidation: true, identityAliases: true, validArtifactPathCases: validArtifactLinks.length + 1, rejectedArtifactPathCases: invalidArtifactLinks.length + 2 }));
  process.exit(0);
}
assert.equal(process.platform, "linux", "Run only on the designated isolated 208 Linux host.");
assert(args.has("--source") && args.has("--output") && args.has("--provider-env"));
const followupMessage = "请直接给我已经保存的初稿 PDF、可编辑 LaTeX 和评审结果的现有文件路径，简要列出尚未完成的事项；无需重新整理或复制文件，本轮不要继续研究、修订或重跑 workflow。";
const source = await realpath(args.get("--source")); const output = resolve(args.get("--output"));
assert(output !== source && !output.startsWith(source + sep), "Recovery must use a separate new directory.");
await mkdir(output, { recursive: false, mode: 0o700 });
const sourceData = join(source, "data"); const dataRoot = join(output, "data");
const hash = value => createHash("sha256").update(value).digest("hex");
let redact = value => String(value);
const report = { mode, boundary: userFollowup
  ? "Explicit user-followup delivery of existing draft/review files through public SessionManager.sendMessage on a new source copy. This is a different experiment from terminal-only recovery; no automatic-notification, UI-resume, autonomous-routing or manuscript-quality claim."
  : "Recovery of one saved terminal notification using real SessionManager/Pi on a copied study. No new writing workflow or research is authorized; this does not measure autonomous routing or manuscript quality.",
  source, output, pid: process.pid, startedAt: new Date(started).toISOString(), totalLimitMs: LIMIT_MS,
  llmHttpRequestLimit: requestLimit, llmHttpRequestsStarted: 0, llmHttpRequestAttempts: 0,
  toolSurface: "Original tool names and product prompt are retained. A test-only Pi tool_call hook allows read-only commands and finite mkdir/cp packaging commands for hash-verified saved artifacts into new deliverables files. It blocks manuscript edits, research, new workflows and Expert dispatch. Unsupported packaging shell is rejected as a recoverable tool result within the same request/time budget. Original workspace files and all additions are verified after execution.",
  providerRedirectPolicy: "error",
  recoveryPreparation: userFollowup
    ? "Pause flags, notification, dedupe key and history remain unchanged before native restore. One explicit user message through public sendMessage resumes delivery; the existing terminal notification follows through the ordinary queue. No pause file edit or product-prompt override."
    : "Only the isolated copy's Principal pause is cleared before native restore. The public sendMessage path would add a new user prompt; no dedicated public resume-only SessionManager API exists. This does not validate UI resume or autonomous routing.",
  ...(userFollowup ? { userMessage: followupMessage } : {}), prompts: [],
  promptAttempts: 0, providerPromptCount: 0, workflowStartAttempts: 0, otherAgentAttempts: 0,
  calls: [], toolCallRequests: [], messages: [], usage: [], http: [], guards: [], status: "preparing" };
const persist = () => writeFile(join(output, "recovery-report.json"), redact(JSON.stringify(report, null, 2)), { mode: 0o600 });
const cancel = new AbortController();
let manager, sessionId, runId, activeSession, stopReason, stopPromise, softTimer, hardTimer, pollTimer;
let promptFinished = false;
let currentPromptKind;
let guardCallbackKey;
let workspace, workspaceBefore = [], publishedFiles = [], requestedFiles = [];
const authorizedCopies = new Map();
const sourceFiles = [];
const originalFetch = globalThis.fetch;
function stop(reason) {
  stopReason ??= reason; report.stopReason = stopReason;
  cancel.abort(new Error(stopReason));
  // Never await from a tool callback: Session Stop joins that same prompt.
  return stopPromise ??= Promise.resolve().then(async () => {
    await persist();
    if (manager && sessionId) await manager.interrupt(sessionId).catch(error => { report.stopError = redact(error.message); });
    else await activeSession?.abort();
  });
}
const onSigterm = () => { void stop("operator_SIGTERM"); };
const onSigint = () => { void stop("operator_SIGINT"); };
process.on("SIGTERM", onSigterm); process.on("SIGINT", onSigint);
hardTimer = setTimeout(() => {
  report.status = "failed"; report.stopReason ??= "hard_total_deadline"; report.cleanupComplete = false;
  report.finishedAt = new Date().toISOString();
  writeFileSync(join(output, "recovery-report.json"), redact(JSON.stringify(report, null, 2)), { mode: 0o600 });
  process.exit(2);
}, Math.max(1, LIMIT_MS - (Date.now() - started)));
softTimer = setTimeout(() => { void stop("total_deadline_cleanup"); }, Math.max(1, LIMIT_MS - 10_000 - (Date.now() - started)));
async function fingerprint(root) {
  const rows = []; let total = 0;
  async function visit(path) {
    const info = await lstat(path); assert(!info.isSymbolicLink(), "Study copy must not follow a symlink into another dataset.");
    if (info.isDirectory()) { for (const name of (await readdir(path)).sort()) await visit(join(path, name)); }
    else {
      assert(info.isFile()); total += info.size; assert(rows.length < 30_000 && total <= 1_000_000_000, "Study exceeds this recovery experiment's copy bound.");
      rows.push({ path: relative(root, path).split(sep).join("/"), size: info.size, sha256: hash(await readFile(path)) });
    }
  }
  await visit(root); return rows;
}
try {
  sourceFiles.push(...await fingerprint(sourceData));
  await cp(sourceData, dataRoot, { recursive: true, errorOnExist: true, force: false, dereference: false });
  assert.deepEqual(await fingerprint(dataRoot), sourceFiles, "Copied data does not match the original study.");
  await writeFile(join(output, "source-files.json"), JSON.stringify(sourceFiles, null, 2));
  const ids = (await readdir(join(dataRoot, ".bp"))).filter(name => /^[a-zA-Z0-9-]+$/.test(name));
  assert.equal(ids.length, 1, "This recovery is limited to one saved session."); [sessionId] = ids;
  const stateDir = join(dataRoot, ".bp", sessionId); const ledgerPath = join(stateDir, "tasks.json");
  const beforeLedger = JSON.parse(await readFile(ledgerPath, "utf8"));
  const beforeRuns = JSON.parse(await readFile(join(stateDir, "workflows.json"), "utf8"));
  const meta = JSON.parse(await readFile(join(stateDir, "meta.json"), "utf8"));
  const providerRef = JSON.parse(await readFile(join(stateDir, "provider.json"), "utf8"));
  assert.equal(meta.thinkingLevel, "low"); assert.equal(providerRef.modelId, "kimi-k3");
  assert.equal(beforeRuns.runs.length, 1); const savedRun = beforeRuns.runs[0]; runId = savedRun.id;
  assert.equal(savedRun.status, "succeeded"); assert.equal(savedRun.modelBinding.modelId, "kimi-k3"); assert.equal(savedRun.modelBinding.thinkingLevel, "low");
  assert.equal(beforeLedger.tasks.length, 0, "Do not revive unrelated Expert work.");
  assert.equal(beforeLedger.notifications.length, 1, "Only one saved terminal notification may be recovered.");
  const notification = beforeLedger.notifications[0];
  assert.equal(notification.kind, "system"); assert.equal(notification.to_agent, "principal");
  assert(notification.content.startsWith("A previously accepted workflow has settled") && notification.content.includes(runId));
  const terminalKey = `workflow:${runId}:terminal`;
  assert.equal(beforeLedger.system_keys.filter(key => key === terminalKey).length, 1);
  Object.assign(report, { sessionId, runId, pendingNotificationId: notification.id, originalRunStatus: savedRun.status,
    originalSourceManifestHash: hash(JSON.stringify(sourceFiles)), sourceFileCount: sourceFiles.length,
    sourcePause: { global: beforeLedger.delivery_paused, agents: beforeLedger.paused_agents }, terminalKey,
    finalPaths: [savedRun.result.data.finalTexPath, savedRun.result.data.finalPdfPath, ...(userFollowup ? [savedRun.result.data.finalReviewPath] : [])] });

  workspace = join(dataRoot, "workspaces", sessionId);
  const artifactPrefix = `workspaces/${sessionId}/`;
  workspaceBefore = sourceFiles.filter(file => file.path.startsWith(artifactPrefix)).map(file => ({ ...file, path: file.path.slice(artifactPrefix.length) }));
  publishedFiles = (savedRun.artifacts ?? []).map(artifact => {
    const path = artifact.path.replace(/^\/workspace\//, "");
    const file = workspaceBefore.find(file => file.path === path);
    assert(file && file.sha256 === artifact.sha256, `Published artifact disagrees with saved workspace: ${path}`);
    return file;
  });
  requestedFiles = report.finalPaths.map(path => {
    const file = publishedFiles.find(file => file.path === path.replace(/^\/workspace\//, ""));
    assert(file, `Requested artifact is missing: ${path}`); return file;
  });
  report.deliveryScope = "Existing draft delivery only; identical copies/aliases are accepted. This does not establish complete writing, refinement, citation or automatic-terminal-delivery acceptance.";
  report.publishedArtifactCount = publishedFiles.length;

  const env = {};
  for (const line of (await readFile(args.get("--provider-env"), "utf8")).split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line); if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    env[match[1]] = value; // Data only; never source or print credentials.
  }
  const key = env.SQZ_API_KEY || env.CUSTOM_API_KEY || env.ANTHROPIC_API_KEY;
  const baseUrl = env.CUSTOM_BASE_URL || env.ANTHROPIC_BASE_URL; assert(key && baseUrl);
  redact = value => [key, JSON.stringify(key).slice(1, -1), encodeURIComponent(key)].reduce((text, secret) => text.split(secret).join("[REDACTED]"), String(value));
  for (const name of ["log", "info", "warn", "error", "debug"]) {
    const original = console[name].bind(console);
    console[name] = (...items) => original(...items.map(item => redact(typeof item === "string" ? item : inspect(item, { depth: 5 }))));
  }
  const providersPath = join(dataRoot, "bp_template", "providers.json");
  const providers = JSON.parse(await readFile(providersPath, "utf8"));
  const profile = providers.profiles.find(item => item.id === providerRef.providerId); assert(profile);
  assert.equal(profile.baseUrl.replace(/\/+$/, ""), baseUrl.replace(/\/+$/, ""));
  assert.equal(profile.api, savedRun.modelBinding.api);
  assert.deepEqual(profile.models, ["kimi-k3"]); assert(profile.reasoningModels.includes("kimi-k3"));
  assert(!profile.apiKey, "Saved study must reference a key by environment variable.");
  profile.apiKeyEnv = "BP_WORKFLOW_RECOVERY_API_KEY";
  await writeFile(providersPath, JSON.stringify(providers, null, 2), { mode: 0o600 });
  Object.assign(process.env, { BP_WORKFLOW_RECOVERY_API_KEY: key, BP_LOCAL_MODE: "1", BP_DATA_DIR: dataRoot,
    BP_KB_ROOT: join(output, "knowledge-base"), PI_CODING_AGENT_DIR: join(output, "pi-agent"), PI_CODING_AGENT_SESSION_DIR: join(output, "pi-sessions") });
  delete process.env.BP_MOCK; delete process.env.BP_SHARED_DIR;
  const providerOrigin = new URL(baseUrl).origin;
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (url.origin !== providerOrigin) { void stop("unexpected_external_research_request"); throw new Error("Recovery permits only the original provider endpoint"); }
    const llmRequest = /\/(?:messages|chat\/completions|responses)\/?$/.test(url.pathname);
    if (llmRequest) {
      if (!claimLlmRequest(report)) {
        void stop("llm_http_budget_limited");
        throw new Error(`Recovery's ${report.llmHttpRequestLimit}-request LLM budget is exhausted; no further request was sent`);
      }
    }
    const signals = [cancel.signal, init?.signal, input instanceof Request ? input.signal : undefined].filter(Boolean);
    const observed = { path: url.pathname, llmRequest, at: new Date().toISOString() }; report.http.push(observed);
    try {
      const response = await originalFetch(input, { ...init, redirect: "error", signal: AbortSignal.any(signals) }); observed.status = response.status;
      return response;
    } catch (error) { observed.error = redact(error.message); throw error; }
  };

  // terminal mode alone clears the COPY's pause. user-followup preserves it and
  // uses public sendMessage below; both keep the exact pending notification,
  // task IDs, content, sequence and dedupe key. No private wake API is called.
  if (!userFollowup) {
    const resumed = { ...beforeLedger, delivery_paused: false, paused_agents: beforeLedger.paused_agents.filter(name => name !== "principal") };
    await writeFile(ledgerPath, JSON.stringify(resumed, null, 2));
  } else {
    assert(beforeLedger.delivery_paused || beforeLedger.paused_agents.includes("principal"), "The explicit-followup experiment requires the original paused state.");
  }
  const { SessionManager } = await import("../packages/runtime/dist/session-manager.js");
  const { realAgentFactory } = await import("../packages/runtime/dist/agent-factory.js");
  const readableSystem = new Set(["workflow_get", "get_trace_graph", "get_trace_node", "get_trace_neighborhood", "get_trace_diff", "list_monitors"]);
  const readableBuiltin = new Set(["read", "ls", "grep", "find"]);
  guardCallbackKey = `brainpilot-delivery-only-${randomUUID()}`;
  const guardPath = join(output, "delivery-only-guard.mjs");
  await writeFile(guardPath, toolGuardSource(guardCallbackKey));
  const publishedPaths = new Set(publishedFiles.map(file => file.path));
  globalThis[guardCallbackKey] = async event => {
    const plan = userFollowup && event.toolName === "bash" && planArtifactCopies(event.input?.command, publishedPaths);
    if (plan) {
      try {
        // All paths come from the finite recognizer; original source and every
        // destination ancestor are checked before native Bash executes the copy.
        for (const target of [...plan.directories, ...plan.copies.map(copy => copy.target)]) {
          const parts = target.split("/");
          for (let i = 1; i <= parts.length; i++) {
            const part = join(workspace, ...parts.slice(0, i));
            const info = await lstat(part).catch(error => { if (error.code === "ENOENT") return null; throw error; });
            if (info) assert(i < parts.length || plan.directories.includes(target), `Copy target already exists: ${part}`);
            if (info) assert(info.isDirectory() && !info.isSymbolicLink(), `Copy destination ancestor is not a directory: ${part}`);
          }
        }
        for (const copy of plan.copies) {
          const file = publishedFiles.find(file => file.path === copy.source);
          assert.equal(hash(await readFile(join(workspace, copy.source))), file.sha256, `Copy source changed: ${copy.source}`);
          assert(!authorizedCopies.has(copy.target), `Copy destination was already reserved: ${copy.target}`);
        }
        for (const copy of plan.copies) {
          const file = publishedFiles.find(file => file.path === copy.source);
          authorizedCopies.set(copy.target, { ...file, source: copy.source });
        }
        (report.packagingCommands ??= []).push({ command: event.input.command, ...plan, at: new Date().toISOString() });
        return true;
      } catch (error) { report.copyGuardError = redact(error.message); }
    }
    report.guards.push({ tool: event.toolName, reason: "blocked by test-only tool_call hook", recoverable: userFollowup && event.toolName === "bash" });
    // An unsupported packaging command is a tool error the PI can recover from
    // by returning existing paths. Keep the bounded turn alive; do not label an
    // overly narrow test fence as a product failure or execute ambiguous shell.
    if (!userFollowup || event.toolName !== "bash") { void activeSession?.abort(); void stop(`forbidden_tool:${event.toolName}`); }
    return false;
  };
  const factory = async params => {
    if (params.agentName !== "principal" || params.workflowModelBinding) {
      report.otherAgentAttempts++; void stop("unexpected_expert_or_workflow_stage"); throw new Error("Recovery cannot create another Agent or workflow stage");
    }
    assert.equal(params.thinkingLevel, "low"); assert.equal(params.providerConfig.modelId, "kimi-k3");
    const systemTools = params.systemTools.map(tool => ({ ...tool, execute: async arguments_ => {
      const allowed = readableSystem.has(tool.name); report.calls.push({ name: tool.name, allowed, at: new Date().toISOString() });
      if (!allowed) {
        report.guards.push({ tool: tool.name, reason: "delivery-only recovery" }); void stop(`forbidden_tool:${tool.name}`);
        throw new Error("This recovery is limited to delivering the already saved workflow result");
      }
      return tool.execute(arguments_);
    } }));
    // Preserve the complete ordinary tool surface and product prompt. The
    // public Pi extension hook is an execution fence for this test only.
    const compatPluginProjections = [...(params.compatPluginProjections ?? []), { schemaVersion: 1,
      id: "test-only-delivery-guard", version: "0.0.0", format: "pi-package", root: output, dataDir: output, extensionPaths: [guardPath] }];
    const session = await realAgentFactory({ ...params, systemTools, compatPluginProjections }); activeSession = session;
    report.unchangedToolNames = [...params.allowedToolNames];
    const binding = session.getWorkflowModelBinding();
    assert.equal(binding.model.id, "kimi-k3"); assert.equal(binding.thinkingLevel, "low");
    report.binding = { modelId: binding.model.id, providerId: binding.model.provider, api: binding.model.api, thinkingLevel: binding.thinkingLevel };
    session.subscribe(event => {
      if (event.type === "tool_execution_start") {
        const allowed = readableBuiltin.has(event.toolName) || readableSystem.has(event.toolName) || (event.toolName === "bash" && (isReadOnlyBash(event.args?.command) || (userFollowup && Boolean(planArtifactCopies(event.args?.command, publishedPaths)))));
        report.toolCallRequests.push({ name: event.toolName, toolCallId: event.toolCallId, allowed,
          ...(event.toolName === "bash" ? { command: event.args?.command } : {}) });
        if (event.toolName === "workflow_start") report.workflowStartAttempts++;
        if (!allowed && (!userFollowup || event.toolName !== "bash")) { void session.abort(); void stop(`forbidden_tool:${event.toolName}`); }
      }
      if (event.type === "message_end" && event.message?.role === "assistant") {
        const message = event.message;
        report.messages.push({ promptKind: currentPromptKind, stopReason: message.stopReason, error: message.errorMessage,
          text: (message.content ?? []).filter(block => block.type === "text").map(block => block.text).join(""),
          toolNames: (message.content ?? []).filter(block => block.type === "toolCall").map(block => block.name) });
        if (message.usage) report.usage.push(message.usage);
      }
    });
    const prompt = session.prompt.bind(session);
    session.prompt = async (text, options) => {
      report.promptAttempts++;
      const expectedUser = userFollowup && report.promptAttempts === 1 && text.includes(followupMessage);
      const expectedTerminal = report.promptAttempts === (userFollowup ? 2 : 1) && text.includes(notification.content);
      if (!expectedUser && !expectedTerminal) {
        void stop("unexpected_additional_principal_prompt"); throw new Error("Only the mode's explicit user follow-up and/or unchanged saved terminal notification may be prompted once each");
      }
      currentPromptKind = expectedUser ? "explicit-user-followup" : "saved-terminal-notification";
      report.prompts.push({ kind: currentPromptKind, textHash: hash(text), at: new Date().toISOString() });
      promptFinished = false;
      report.providerPromptCount++; report.status = "delivering"; await persist();
      try { return await prompt(text, options); } finally { promptFinished = true; }
    };
    return session;
  };
  manager = new SessionManager({ dataRoot, persist: true, agentFactory: factory, maxConcurrentAgents: 1, memLimitBytes: null });
  await manager.ensurePersistentLayout();
  const restored = await manager.restoreFromDisk(); assert(restored.includes(sessionId));
  if (userFollowup) {
    assert.equal(report.providerPromptCount, 0, "Paused restore must not prompt the Principal before the user's request.");
    const paused = JSON.parse(await readFile(ledgerPath, "utf8"));
    assert.equal(paused.delivery_paused, beforeLedger.delivery_paused); assert.deepEqual(paused.paused_agents, beforeLedger.paused_agents);
    assert.deepEqual(paused.notifications, beforeLedger.notifications);
    report.pausePreservedBeforePublicFollowup = true;
    const accepted = await manager.sendMessage(sessionId, followupMessage); assert(accepted.accepted);
    report.publicFollowupAccepted = true;
  }
  while (!stopReason) {
    const state = manager.getSessionState(sessionId);
    const currentLedger = JSON.parse(await readFile(ledgerPath, "utf8")); report.pendingCount = currentLedger.notifications.length;
    if (promptFinished && state?.workState.active === false && (!userFollowup || report.pendingCount === 0
      || currentLedger.delivery_paused || currentLedger.paused_agents.includes("principal"))) break;
    await new Promise(done => { pollTimer = setTimeout(done, 50); });
  }
  await stopPromise;
  if (stopReason) throw new Error(`Recovery stopped: ${stopReason}`);
  const afterLedger = JSON.parse(await readFile(ledgerPath, "utf8"));
  const finalPaths = report.finalPaths;
  const workspaceAfter = await fingerprint(workspace);
  const preservation = inspectDeliveryWorkspace(workspaceBefore, workspaceAfter, authorizedCopies);
  Object.assign(report, { workspacePreservation: preservation, copiedArtifacts: preservation.copies });
  assert(preservation.unchanged, preservation.errors.join("; "));
  const available = [...publishedFiles, ...preservation.copies];
  const deliveries = report.messages.filter(message => message.stopReason === "stop" && !message.error &&
    matchDeliveredArtifacts(message.text, requestedFiles, available).every(file => file.matchingPaths.length));
  report.deliveryMatches = deliveries.map(message => matchDeliveredArtifacts(message.text, requestedFiles, available));
  const afterRuns = manager.listWorkflowRuns(sessionId);
  Object.assign(report, { pendingCount: afterLedger.notifications.length, terminalKeyCount: afterLedger.system_keys.filter(key => key === terminalKey).length,
    deliveredActualPaths: deliveries.length > 0, deliveryTexts: deliveries.map(item => item.text), finalPaths, runCount: afterRuns.length });
  assert.equal(report.providerPromptCount, report.promptAttempts);
  assert(report.providerPromptCount >= 1 && report.providerPromptCount <= (userFollowup ? 2 : 1));
  if (userFollowup) assert.equal(report.prompts.filter(prompt => prompt.kind === "explicit-user-followup").length, 1);
  assert.equal(report.workflowStartAttempts, 0); assert.equal(report.otherAgentAttempts, 0);
  assert.equal(afterLedger.notifications.length, 0); assert.equal(report.terminalKeyCount, 1); assert(deliveries.length > 0, "PI did not deliver every requested real artifact path in a completed reply");
  assert.deepEqual(afterRuns, beforeRuns.runs, "Recovery changed an existing run or accepted a new run");
  // An already-loaded session makes repeated restore on this manager a no-op.
  // This does not reload persisted terminal state or test fresh-manager recovery.
  const promptsBeforeRepeatedRestore = report.promptAttempts;
  const repeatedlyRestored = await manager.restoreFromDisk();
  assert.deepEqual(repeatedlyRestored, []); assert.equal(report.promptAttempts, promptsBeforeRepeatedRestore);
  report.repeatedRestoreObservation = { scope: "same-manager-noop", freshlyLoadedSessionCount: repeatedlyRestored.length,
    promptCountUnchanged: true, freshManagerRecoveryValidated: false };
  report.status = "passed";
} catch (error) {
  report.status = report.budgetLimited ? "budget_limited" : "failed";
  if (report.budgetLimited) report.productFailure = false;
  report.error = redact(error.stack ?? error); process.exitCode = 2;
} finally {
  clearTimeout(softTimer); clearTimeout(pollTimer);
  if (manager && sessionId) await manager.interrupt(sessionId).catch(error => { report.cleanupError = redact(error.message); });
  await manager?.shutdownAndSave().catch(error => { report.cleanupError = redact(error.message); });
  if (sessionId) {
    const ledger = JSON.parse(await readFile(join(dataRoot, ".bp", sessionId, "tasks.json"), "utf8"));
    report.pendingCount = ledger.notifications.length;
    report.terminalKeyCount = (ledger.system_keys ?? []).filter(key => key === report.terminalKey).length;
    // Preservation is checked after shutdown even when budget/guard/cancellation
    // stopped the normal success path. Missing/changed files cannot become a pass.
    try {
      const preservation = inspectDeliveryWorkspace(workspaceBefore, await fingerprint(workspace), authorizedCopies);
      report.workspacePreservation = preservation; report.copiedArtifacts = preservation.copies;
      assert(preservation.unchanged, preservation.errors.join("; "));
      const available = [...publishedFiles, ...preservation.copies];
      const delivered = report.messages.filter(message => message.stopReason === "stop" && !message.error && requestedFiles.length > 0 &&
        matchDeliveredArtifacts(message.text, requestedFiles, available).every(file => file.matchingPaths.length));
      report.deliveredActualPaths = delivered.length > 0; report.deliveryTexts = delivered.map(message => message.text);
      report.deliveryMatches = delivered.map(message => matchDeliveredArtifacts(message.text, requestedFiles, available));
    } catch (error) {
      report.workspacePreservationError = redact(error.message); report.deliveredActualPaths = false;
      report.status = "failed"; process.exitCode = 2;
    }
  }
  report.terminalPromptCount = report.prompts.filter(prompt => prompt.kind === "saved-terminal-notification").length;
  report.explicitUserPromptCount = report.prompts.filter(prompt => prompt.kind === "explicit-user-followup").length;
  if (sourceFiles.length) {
    try { assert.deepEqual(await fingerprint(sourceData), sourceFiles); report.originalSourceUnchanged = true; }
    catch (error) { report.originalSourceUnchanged = false; report.sourceCheckError = redact(error.message); report.status = "failed"; process.exitCode = 2; }
  }
  report.cleanupComplete = !report.cleanupError;
  report.finishedAt = new Date().toISOString(); report.elapsedMs = Date.now() - started; await persist();
  clearTimeout(hardTimer); globalThis.fetch = originalFetch; delete process.env.BP_WORKFLOW_RECOVERY_API_KEY;
  if (guardCallbackKey) delete globalThis[guardCallbackKey];
  process.removeListener("SIGTERM", onSigterm); process.removeListener("SIGINT", onSigint);
  console.log(JSON.stringify({ status: report.status, providerPromptCount: report.providerPromptCount, workflowStartAttempts: report.workflowStartAttempts,
    pendingCount: report.pendingCount, deliveredActualPaths: report.deliveredActualPaths, originalSourceUnchanged: report.originalSourceUnchanged,
    report: join(output, "recovery-report.json"), stopReason, error: report.error }));
}
