import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createAgentSession, DefaultResourceLoader, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import { mergeLoadedExtensionToolNames } from "../agent-factory.js";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

type Handler = (event: Record<string, unknown>, context: Record<string, unknown>) => unknown | Promise<unknown>;

describe("trusted Pi package extensions", () => {
  it("loads the pinned Superpowers extension and preserves its native lifecycle", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "bp-superpowers-extension-"));
    roots.push(root);
    const agentDir = path.join(root, "agent");
    const pluginRoot = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../../backend-core/plugins/superpowers/6.2.0",
    );
    const loader = new DefaultResourceLoader({
      cwd: root,
      agentDir,
      settingsManager: SettingsManager.create(root, agentDir, { projectTrusted: true }),
      noExtensions: true,
      noSkills: true,
      noContextFiles: true,
      additionalExtensionPaths: [path.join(pluginRoot, ".pi", "extensions", "superpowers.ts")],
    });

    await loader.reload();
    const loaded = loader.getExtensions();
    expect(loaded.errors).toEqual([]);
    expect(loaded.extensions).toHaveLength(1);
    const extension = loaded.extensions[0]!;
    expect([...extension.handlers.keys()]).toEqual([
      "resources_discover",
      "session_start",
      "session_compact",
      "agent_end",
      "context",
    ]);

    const handler = (name: string): Handler => extension.handlers.get(name)![0] as Handler;
    await expect(handler("resources_discover")({}, {})).resolves.toEqual({ skillPaths: [path.join(pluginRoot, "skills")] });
    const injected = await handler("context")({ messages: [] }, {}) as { messages: Array<{ content: Array<{ text: string }> }> };
    expect(injected.messages[0]?.content[0]?.text).toContain("superpowers:using-superpowers bootstrap for pi");
    expect(injected.messages[0]?.content[0]?.text).toContain("Pi tool mapping");

    await handler("agent_end")({}, {});
    await expect(handler("context")({ messages: [] }, {})).resolves.toBeUndefined();
    await handler("session_compact")({}, {});
    await expect(handler("context")({ messages: [] }, {})).resolves.toEqual(expect.objectContaining({ messages: expect.any(Array) }));
  });

  it("keeps tools from explicitly loaded extensions active under Pi's hard allowlist", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "bp-extension-tool-"));
    roots.push(root);
    const agentDir = path.join(root, "agent");
    const settingsManager = SettingsManager.create(root, agentDir, { projectTrusted: true });
    const loader = new DefaultResourceLoader({
      cwd: root,
      agentDir,
      settingsManager,
      noExtensions: true,
      noSkills: true,
      noContextFiles: true,
      extensionFactories: [(pi) => pi.registerTool({
        name: "probe",
        label: "Probe",
        description: "Probe extension visibility",
        parameters: { type: "object", properties: {} },
        execute: async () => ({ content: [{ type: "text", text: "ok" }], details: {} }),
      })],
    });
    await loader.reload();

    const tools = mergeLoadedExtensionToolNames(["read"], loader);
    const { session } = await createAgentSession({
      cwd: root,
      tools,
      resourceLoader: loader,
      settingsManager,
      sessionManager: SessionManager.inMemory(root),
    });
    try {
      expect(session.getAllTools().map((tool) => tool.name)).toContain("probe");
      expect(session.getActiveToolNames()).toContain("probe");
    } finally {
      session.dispose();
    }
  });
});
