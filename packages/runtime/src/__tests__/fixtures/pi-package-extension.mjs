import path from "node:path";
import { DefaultResourceLoader, SettingsManager } from "@brainpilot/pi-sdk";

const [root, pluginRoot] = process.argv.slice(2);
const agentDir = path.join(root, "agent");
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
if (loaded.errors.length || loaded.extensions.length !== 1) {
  console.log(JSON.stringify({ errors: loaded.errors, extensionCount: loaded.extensions.length }));
  process.exit(0);
}
const extension = loaded.extensions[0];
const handler = (name) => extension.handlers.get(name)[0];
const discovered = await handler("resources_discover")({}, {});
const first = await handler("context")({ messages: [] }, {});
await handler("agent_end")({}, {});
const afterEnd = await handler("context")({ messages: [] }, {});
await handler("session_compact")({}, {});
const afterCompact = await handler("context")({ messages: [] }, {});
console.log(JSON.stringify({
  errors: loaded.errors,
  extensionCount: loaded.extensions.length,
  handlerNames: [...extension.handlers.keys()],
  discovered,
  firstText: first?.messages?.[0]?.content?.[0]?.text,
  afterEnd: afterEnd ?? null,
  afterCompact,
}));
