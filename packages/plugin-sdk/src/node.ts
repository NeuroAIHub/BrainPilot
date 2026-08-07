import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { promises as fs } from "node:fs";
import path from "node:path";
import { parsePluginManifest, parsePublishablePluginManifest, type PluginManifest } from "./index.js";

const sdkVersion = (createRequire(import.meta.url)("../package.json") as { version: string }).version;

function compatibleBrainPilotRange(version: string): string {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!match) return `=${version}`;
  return `>=${match[1]}.${match[2]}.${match[3]} <${match[1]}.${Number(match[2]) + 1}.0`;
}

export async function readPluginManifest(root: string): Promise<PluginManifest> {
  const raw = JSON.parse(await fs.readFile(path.join(root, "manifest.json"), "utf8")) as unknown;
  const manifest = parsePublishablePluginManifest(raw);
  if (!manifest) throw new Error("Invalid BrainPilot plugin manifest: engines.brainpilot with a valid version range is required");
  const contributions = manifest.contributes;
  const entries = [
    ...(contributions?.previewers ?? []), ...(contributions?.skills ?? []), ...(contributions?.knowledgeBases ?? []),
    ...(contributions?.panels ?? []), ...(contributions?.literatureProviders ?? []), ...(contributions?.workflows ?? []),
    ...(contributions?.agentInstructions ?? []),
    ...(contributions?.runtimeExtensions ?? []),
  ];
  for (const contribution of entries) {
    try { await fs.access(path.join(root, contribution.entry)); }
    catch { throw new Error(`Contribution entry not found: ${contribution.entry}`); }
  }
  return manifest;
}

async function collect(root: string, dir = root): Promise<Array<{ path: string; contentBase64: string }>> {
  const out: Array<{ path: string; contentBase64: string }> = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (entry.name === "manifest.json" || entry.name.endsWith(".bundle.json")) continue;
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await collect(root, absolute));
    else if (entry.isFile()) out.push({ path: path.relative(root, absolute).split(path.sep).join("/"), contentBase64: (await fs.readFile(absolute)).toString("base64") });
  }
  return out;
}

export async function packPlugin(root: string, output?: string): Promise<{ output: string; sha256: string }> {
  const manifest = await readPluginManifest(root);
  const bytes = Buffer.from(JSON.stringify({ manifest, files: await collect(root) }));
  const target = output ?? path.join(root, `${manifest.id}-${manifest.version}.bundle.json`);
  await fs.writeFile(target, bytes);
  return { output: target, sha256: createHash("sha256").update(bytes).digest("hex") };
}

export async function createPreviewerPlugin(root: string, id: string): Promise<void> {
  const manifest = { id, version: "0.1.0", apiVersion: "1", displayName: id.split(/[._-]/).at(-1) ?? id, description: "A BrainPilot file preview plugin.", categories: ["visualization"], engines: { brainpilot: compatibleBrainPilotRange(sdkVersion) }, protocols: { preview: "1" }, environments: ["local", "cloud", "browser"], permissions: ["read:workspace"], contributes: { previewers: [{ id: "main", match: { extensions: [".example"] }, priority: 100, mode: "readonly", delivery: "range", entry: "ui/index.html" }] } };
  if (!parsePluginManifest(manifest)) throw new Error("Invalid plugin id; use a reverse-domain id such as org.example.viewer");
  await fs.mkdir(path.join(root, "ui"), { recursive: true });
  await fs.writeFile(path.join(root, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", { flag: "wx" });
  await fs.writeFile(path.join(root, "ui", "index.html"), PREVIEW_TEMPLATE, { flag: "wx" });
}

const PREVIEW_TEMPLATE = `<!doctype html><meta charset="utf-8"><h1 id="title">BrainPilot Range Preview</h1><pre id="output">Waiting…</pre><script>
const token=decodeURIComponent(location.hash.slice(1));
addEventListener('message',event=>{const m=event.data;if(event.source!==parent||m?.token!==token)return;if(m.type==='preview/open'){parent.postMessage({type:'preview/read-range',rpcVersion:'1',token,requestId:m.requestId,handle:m.file.handle,offset:0,length:64},'*')}if(m.type==='preview/range-result'){document.querySelector('#output').textContent='Read '+m.buffer.byteLength+' of '+m.totalSize+' bytes from '+m.handle;parent.postMessage({type:'preview/rendered',rpcVersion:'1',token,requestId:m.requestId},'*')}});
parent.postMessage({type:'preview/ready',rpcVersion:'1',token},'*');
</script>`;
