import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadCompatPluginProjections, makeCompatHooksExt, runCompatHookEvent, type CompatPluginProjection } from "../compat-hooks.js";

const roots: string[] = [];
async function temp(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "bp-hooks-"));
  roots.push(root);
  return root;
}
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

async function fixture(hooks: unknown): Promise<CompatPluginProjection> {
  const root = await temp();
  const dataDir = path.join(root, "data");
  const hookPath = path.join(root, "hooks.json");
  await mkdir(dataDir, { recursive: true });
  await writeFile(hookPath, JSON.stringify({ hooks }));
  return { schemaVersion: 1, id: "test-plugin", version: "1.0.0", format: "claude-code", root, dataDir, hookConfig: { dialect: "claude-code", path: hookPath } };
}

describe("compat hook runner", () => {
  it("passes JSON stdin and plugin environment aliases, then parses additionalContext", async () => {
    const projection = await fixture({
      UserPromptSubmit: [{ hooks: [{ type: "command", command: `node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.stringify({additionalContext:JSON.parse(d).prompt+'@'+process.env.PLUGIN_ROOT})))"` }] }],
    });
    const [result] = await runCompatHookEvent(projection, "UserPromptSubmit", { prompt: "hello" });
    expect(result).toEqual(expect.objectContaining({ ok: true, additionalContext: `hello@${projection.root}` }));
  });

  it("reports command failures without throwing", async () => {
    const projection = await fixture({ Stop: [{ hooks: [{ type: "command", command: "node -e \"process.exit(7)\"" }] }] });
    const [result] = await runCompatHookEvent(projection, "Stop", {});
    expect(result?.ok).toBe(false);
  });

  it("maps Pi lifecycle events, aliases Read, and injects session/prompt context", async () => {
    const payloadFileName = "tool.json";
    const projection = await fixture({
      SessionStart: [{ matcher: "startup", hooks: [{ type: "command", command: `node -e "console.log(JSON.stringify({additionalContext:'session-memory'}))"` }] }],
      UserPromptSubmit: [{ hooks: [{ type: "command", command: `node -e "console.log(JSON.stringify({additionalContext:'prompt-memory'}))"` }] }],
      PreToolUse: [{ matcher: "Read", hooks: [{ type: "command", command: `node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>require('fs').writeFileSync(process.env.BRAINPILOT_PLUGIN_DATA+'/${payloadFileName}',d))"` }] }],
    });
    const handlers = new Map<string, Array<(event: any, ctx: any) => any>>();
    const api = { on(event: string, handler: (event: any, ctx: any) => any) { handlers.set(event, [...handlers.get(event) ?? [], handler]); } };
    makeCompatHooksExt([projection])(api as never);
    await handlers.get("session_start")?.[0]?.({ reason: "new" }, { cwd: projection.root });
    const before = await handlers.get("before_agent_start")?.[0]?.({ prompt: "hi", systemPrompt: "base" }, { cwd: projection.root }) as { systemPrompt: string };
    expect(before.systemPrompt).toContain("session-memory");
    expect(before.systemPrompt).toContain("prompt-memory");
    await handlers.get("tool_call")?.[0]?.({ toolName: "read", toolCallId: "tc1", input: { path: "x" } }, { cwd: projection.root });
    const payload = JSON.parse(await readFile(path.join(projection.dataDir, payloadFileName), "utf8")) as Record<string, unknown>;
    expect(payload).toEqual(expect.objectContaining({ tool_name: "Read", tool_use_id: "tc1", hook_event_name: "PreToolUse" }));
  });

  it("loads only valid enabled projections", async () => {
    const root = await temp();
    const runtime = path.join(root, "plugins", "runtime");
    await mkdir(runtime, { recursive: true });
    await writeFile(path.join(runtime, "good.json"), JSON.stringify({ schemaVersion: 1, id: "good", version: "1.0.0", format: "codex", root, dataDir: path.join(root, "data") }));
    await writeFile(path.join(runtime, "bad.json"), "not-json");
    expect(await loadCompatPluginProjections(root)).toEqual([expect.objectContaining({ id: "good" })]);
  });
});
