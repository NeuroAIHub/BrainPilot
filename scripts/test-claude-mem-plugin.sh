#!/usr/bin/env bash
set -euo pipefail

repo="https://github.com/thedotmack/claude-mem.git"
tag="v13.13.1"
commit="f9e330199c411cb49b1874915b9a1736d33b2703"
root=$(cd "$(dirname "$0")/.." && pwd)
work=$(mktemp -d)
cleanup() {
  if [[ "${BP_KEEP_CLAUDE_MEM_TEST:-0}" == "1" ]]; then
    printf 'kept test data at %s\n' "$work"
  else
    rm -rf "$work"
  fi
}
trap cleanup EXIT

source_repo="${CLAUDE_MEM_SOURCE:-$repo}"
git clone --quiet --depth 1 --branch "$tag" "$source_repo" "$work/claude-mem"
actual=$(git -C "$work/claude-mem" rev-parse HEAD)
if [[ "$actual" != "$commit" ]]; then
  printf 'expected %s at %s, got %s\n' "$tag" "$commit" "$actual" >&2
  exit 1
fi

cd "$root"
if [[ "${CLAUDE_MEM_LIVE:-0}" == "1" ]] && ! command -v bun >/dev/null 2>&1; then
  printf 'CLAUDE_MEM_LIVE=1 requires Bun on PATH\n' >&2
  exit 1
fi
npm run build --workspace @brainpilot/runtime --workspace @brainpilot/backend-core --workspace @brainpilot/app >/dev/null
node packages/cli/dist/bin.js plugin import "$work/claude-mem/plugin" \
  --format claude-code \
  --dir "$work/data"

DATA_DIR="$work/data" node --input-type=module <<'NODE'
import { readFile } from "node:fs/promises";
import path from "node:path";
import { setPluginEnabled } from "./packages/backend-core/dist/index.js";
import { loadMcpServersConfig, McpBridge, runCompatHookEvent } from "./packages/runtime/dist/index.js";

const dataDir = process.env.DATA_DIR;
const enabled = await setPluginEnabled(dataDir, "claude-mem", true);
if (!enabled?.enabled) throw new Error("claude-mem did not enable");
const projection = JSON.parse(await readFile(path.join(dataDir, "plugins/runtime/claude-mem.json"), "utf8"));
if (projection.format !== "claude-code" || !projection.mcpConfigPath || !projection.hookConfig) {
  throw new Error("claude-mem runtime projection is incomplete");
}
await readFile(path.join(dataDir, "bp_template/skills-router/99_Marketplace_claude-mem/mem-search/SKILL.md"));
console.log(`Enabled claude-mem ${enabled.activeVersion}; runtime root ${projection.root}`);

if (process.env.CLAUDE_MEM_LIVE === "1") {
  const base = { session_id: "brainpilot-claude-mem-e2e", cwd: projection.root, transcript_path: path.join(projection.dataDir, "e2e.jsonl") };
  await runCompatHookEvent(projection, "SessionStart", { ...base, hook_event_name: "SessionStart", source: "startup" }, "startup");
  await runCompatHookEvent(projection, "UserPromptSubmit", { ...base, hook_event_name: "UserPromptSubmit", prompt: "Remember that BrainPilot plugin compatibility E2E marker is cobalt-orbit." });
  await runCompatHookEvent(projection, "PostToolUse", { ...base, hook_event_name: "PostToolUse", tool_name: "Read", tool_input: { file_path: "README.md" }, tool_response: "BrainPilot compatibility marker cobalt-orbit", tool_use_id: "e2e-tool" }, "Read");
  await runCompatHookEvent(projection, "Stop", { ...base, hook_event_name: "Stop" });
  await new Promise((resolve) => setTimeout(resolve, 10_000));
  const context = await runCompatHookEvent(projection, "SessionStart", { ...base, session_id: "brainpilot-claude-mem-e2e-2", hook_event_name: "SessionStart", source: "startup" }, "startup");
  if (!context.some((result) => result.additionalContext?.trim())) throw new Error("claude-mem did not inject context into the second session");
  const config = await loadMcpServersConfig(dataDir);
  const bridge = new McpBridge();
  const tools = config ? await bridge.connectAll(config) : [];
  const search = tools.find((tool) => tool.name.startsWith("mcp__mcp-search__"));
  if (!search) throw new Error("claude-mem MCP search tool was not discovered");
  await search.execute({ query: "cobalt-orbit" });
  await bridge.close();
  console.log("Credentialed memory capture, second-session context, and MCP search passed");
}
NODE

printf 'Compatibility smoke passed. Use CLAUDE_MEM_LIVE=1 for the credentialed memory loop, and BP_KEEP_CLAUDE_MEM_TEST=1 to retain its data.\n'
