/**
 * Resolve the KnowledgeBase directory layout from a single root.
 *
 * Priority for the root:
 *   1. `BP_KB_ROOT` env var (set by the backend/CLI when running from
 *      a non-default install layout)
 *   2. `<repo>/KnowledgeBase` — when the runtime is checked out from git
 *      next to the KnowledgeBase tree
 *   3. `~/.brainpilot/KnowledgeBase` — single-user default for installed
 *      packages with no env override
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
  // bounded depth so we don't escape to /.
  let dir = HERE;
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, "KnowledgeBase");
    if (existsSync(join(candidate, "scripts", "_common.py"))) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

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
