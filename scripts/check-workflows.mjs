#!/usr/bin/env node
/** Offline workflow checks for local development and branch CI. No acceptance drivers. */
import { spawn } from "node:child_process";
import { statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

if (process.argv.length !== 2) {
  console.error("Usage: npm run check:workflows (no arguments)");
  process.exit(2);
}

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const tests = [
  "packages/plugin-sdk/src/workflow.test.ts",
  "packages/protocol/src/__tests__/http.test.ts",
  "packages/protocol/test/domain.test.ts",
  "packages/protocol/test/events.test.ts",
  "packages/protocol/test/http.test.ts",
  "packages/runtime/src/__tests__/principal-workflow-guard.test.ts",
  "packages/runtime/src/__tests__/mcp-bridge.test.ts",
  "packages/runtime/src/__tests__/pi-provider.test.ts",
  "packages/runtime/src/__tests__/provider-config.test.ts",
  "packages/runtime/src/__tests__/session-manager.test.ts",
  "packages/runtime/src/__tests__/server.test.ts",
  "packages/runtime/src/__tests__/workflow-host.test.ts",
  "packages/runtime/src/__tests__/workflow-native-tools.test.ts",
  "packages/runtime/src/__tests__/workflow-research-tools.test.ts",
  "packages/runtime/src/__tests__/workflow-run-manager.test.ts",
  "packages/runtime/src/__tests__/workflow-scholar-transport.test.ts",
  "packages/runtime/src/__tests__/workflow-session-integration.test.ts",
  "packages/runtime/src/__tests__/workflow-stage-completion.test.ts",
  "packages/runtime/src/__tests__/workflow-stage-lifecycle.test.ts",
  "packages/runtime/src/__tests__/workflow-stage-transport.test.ts",
  "packages/runtime/src/__tests__/deep-research-contract.test.ts",
  "packages/runtime/src/__tests__/deep-research-ledger.test.ts",
  "packages/runtime/src/__tests__/deep-research-loop.test.ts",
  "packages/runtime/src/__tests__/deep-research-reading.test.ts",
  "packages/runtime/src/__tests__/deep-research.test.ts",
  "packages/runtime/src/__tests__/formatting-references.test.ts",
  "packages/runtime/src/__tests__/paper-writing.test.ts",
  "packages/backend-core/test/app.test.ts",
  "packages/backend-core/test/config.test.ts",
  "packages/backend-core/test/plugins.test.ts",
];
const webTests = ["src/__tests__/runningToast.test.ts", "src/__tests__/filePreviewBlob.test.ts"];
for (const file of [...tests, ...webTests.map(file => `packages/web/${file}`)]) {
  try {
    if (!statSync(join(root, file)).isFile()) throw new Error("not a file");
  } catch {
    console.error(`Missing workflow test: ${file}`);
    process.exit(2);
  }
}

// Keep provider credentials out of child processes even when run on a developer
// machine with a configured account. Tests use fixtures and mocked transports.
const env = { ...process.env, BP_MOCK: "1" };
for (const key of [
  "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "OPENAI_API_KEY",
  "GEMINI_API_KEY", "GOOGLE_API_KEY", "CUSTOM_API_KEY", "SQZ_API_KEY",
  "TAVILY_API_KEY", "EXA_API_KEY", "SEMANTIC_SCHOLAR_API_KEY",
]) delete env[key];

const steps = [
  ["Workspace typecheck", npm, ["run", "typecheck"]],
  ["Runtime build", npm, ["run", "build", "-w", "@brainpilot/runtime"]],
  ["Workflow unit tests", npm, ["test", "--", ...tests]],
  ["Web workflow and file preview tests", npm, ["run", "test", "-w", "@brainpilot/web", "--", ...webTests]],
  ["Web build", npm, ["run", "build", "-w", "@brainpilot/web"]],
  ["Writing acceptance accounting", process.execPath, ["scripts/workflow-writing-acceptance.mjs"]],
  ["Writing finalization accounting", process.execPath, ["scripts/workflow-writing-finalization.mjs"]],
  ["Stream observer fixture", process.execPath, ["scripts/workflow-stream-observer.test.mjs"]],
];

for (const [label, command, args] of steps) {
  console.log(`\n== ${label} ==`);
  const code = await new Promise((resolveExit, reject) => {
    const child = spawn(command, args, { cwd: root, env, stdio: "inherit", shell: false });
    child.once("error", reject);
    child.once("exit", (status, signal) => resolveExit(signal ? 1 : status ?? 1));
  });
  if (code !== 0) {
    console.error(`${label} failed (exit ${code}).`);
    process.exit(code);
  }
}

console.log("\nOffline workflow checks passed.");
