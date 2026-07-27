/**
 * Resolve the KnowledgeBase directory layout from a single root.
 *
 * Priority for the root (must stay in lock-step with
 * `backend-core/src/kb-builder.ts::findKbRoot`, issue #378):
 *   1. `BP_KB_ROOT` env var — highest-priority override, set by the
 *      backend/CLI when running from a non-default install layout.
 *   2. Sibling `KnowledgeBase/` reachable by walking up from this
 *      module (the git-checkout layout).
 *   3. `<cwd>/KnowledgeBase` — but ONLY when it exists (the "ran from
 *      repo root" case). Falls through otherwise so npm-only users are
 *      not silently pointed at a non-existent directory.
 *   4. `~/.brainpilot/KnowledgeBase` — single-user default for installed
 *      packages with no env override.
 *
 * Every retrieval/search tool calls `resolveKbPaths()` lazily so the user
 * can change `BP_KB_ROOT` between server restarts without rebuilding.
 */
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

const HERE = dirname(fileURLToPath(import.meta.url));

export interface KbPaths {
  root: string;
  source: string;
  pdfDir: string;
  mmdDir: string;
  ocredJson: string;
  kbSourceJson: string;
  apiConfig: string;
  chunksDir: string;
  chunksJson: string;
  vectorstoreDir: string;
  embeddingsNpy: string;
  chunksJsonl: string;
  indexJson: string;
  metaJson: string;
  modelsDir: string;
  embedModelDir: string;
  rerankerModelDir: string;
  serverScript: string;
}

function detectKbRoot(): string {
  const env = process.env.BP_KB_ROOT;
  if (env && env.trim()) return resolve(env.trim());

  // Try a sibling KnowledgeBase relative to the runtime package. Walk up to a
  // bounded depth so we don't escape to /. Check for `build_kb.py` (matches
  // the shape check backend-core uses so both resolvers agree; #378).
  let dir = HERE;
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, "KnowledgeBase");
    if (existsSync(join(candidate, "scripts", "build_kb.py"))) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  // "Ran from repo root" case: honour only when the tree is really there.
  // Kept in lock-step with backend-core/src/kb-builder.ts (#378).
  const cwdKb = join(process.cwd(), "KnowledgeBase");
  if (existsSync(join(cwdKb, "scripts", "build_kb.py"))) return cwdKb;

  return join(homedir(), ".brainpilot", "KnowledgeBase");
}

export function resolveKbPaths(rootOverride?: string): KbPaths {
  const root = rootOverride ? resolve(rootOverride) : detectKbRoot();
  const source = join(root, "source");
  const chunksDir = join(root, "chunks");
  const vectorstoreDir = join(root, "vectorstore");
  const modelsDir = join(root, "models");
  return {
    root,
    source,
    pdfDir: join(source, "pdf"),
    mmdDir: join(source, "mmd"),
    ocredJson: join(source, "OCRed_pdf.json"),
    kbSourceJson: join(source, "KB_source.json"),
    apiConfig: join(source, "API_config.json"),
    chunksDir,
    chunksJson: join(chunksDir, "chunks.json"),
    vectorstoreDir,
    embeddingsNpy: join(vectorstoreDir, "embeddings.npy"),
    chunksJsonl: join(vectorstoreDir, "chunks.jsonl"),
    indexJson: join(vectorstoreDir, "index.json"),
    metaJson: join(vectorstoreDir, "meta.json"),
    modelsDir,
    embedModelDir: join(modelsDir, "bge-m3"),
    rerankerModelDir: join(modelsDir, "bge-reranker-v2-m3"),
    serverScript: join(root, "server", "model_server.py"),
  };
}

/** Did the user finish a successful KB build at least once? */
export function isKbReady(kb = resolveKbPaths()): boolean {
  return existsSync(kb.embeddingsNpy) && existsSync(kb.chunksJsonl);
}
