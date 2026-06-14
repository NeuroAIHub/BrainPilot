/**
 * scaffold.ts — materialize the `./brainpilot/` launch directory tree
 * (TS_PI_REFACTOR_DESIGN §11A.2). Creating a default editable `bp_template/`
 * (agents prompts + example settings/mcp config) and a default
 * `brainpilot.config.json`.
 *
 * Idempotent: existing files are never overwritten, protecting user edits
 * (§11A.4 step 2 "幂等，已存在不覆盖").
 */
import { mkdir, writeFile, access } from "node:fs/promises";
import { constants as FS } from "node:fs";
import { join } from "node:path";
import { dataPaths, type DataPaths } from "./paths.js";

/** Default backend port (§11A.5 决策 D). Runtime uses port+1 (stride-2 §16). */
export const DEFAULT_PORT = 9001;

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, FS.F_OK);
    return true;
  } catch {
    return false;
  }
}

/** Write a file only if it does not already exist. Returns true if written. */
async function writeIfAbsent(path: string, content: string): Promise<boolean> {
  if (await exists(path)) return false;
  await writeFile(path, content, "utf8");
  return true;
}

/** Default principal agent prompt — minimal, user-editable. */
const PRINCIPAL_PROMPT = `# Principal Agent (PI)

You are the Principal Investigator — the user-facing orchestrator of the
BrainPilot multi-agent system. You decompose the user's request, delegate to
expert agents via \`send_message\`, and synthesize their results into a final
answer.

Keep the user informed of progress. Be concise and rigorous.
`;

const PRINCIPAL_SETTINGS = JSON.stringify(
  {
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    timeoutMs: 120000,
    maxRetries: 2,
  },
  null,
  2,
);

const PRINCIPAL_MANIFEST = JSON.stringify(
  {
    role: "principal",
    parent: null,
    allowedTools: ["send_message", "create_agent", "destroy_agent", "record_trace"],
  },
  null,
  2,
);

/** session-level default Pi SDK settings template (§11A.2). */
const TEMPLATE_SETTINGS_EXAMPLE = JSON.stringify(
  {
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    apiKey: "",
    baseUrl: "",
  },
  null,
  2,
);

/** MCP server config template (§11A.2). */
const TEMPLATE_MCP_EXAMPLE = JSON.stringify(
  {
    mcpServers: {},
  },
  null,
  2,
);

export interface ScaffoldOptions {
  /** Default backend port baked into brainpilot.config.json. */
  port?: number;
  /** Default provider name baked into brainpilot.config.json. */
  provider?: string;
}

export interface ScaffoldResult {
  paths: DataPaths;
  /** Files that were freshly created (absent before). */
  created: string[];
}

/**
 * Create the launch directory tree under `dataDir`. Idempotent — only writes
 * files that don't yet exist. Returns the list of newly created files so the
 * caller can report "scaffolded" vs "already present".
 */
export async function scaffold(
  dataDir: string,
  options: ScaffoldOptions = {},
): Promise<ScaffoldResult> {
  const p = dataPaths(dataDir);
  const created: string[] = [];

  // ① Directory skeleton.
  const principalDir = join(p.bpTemplateAgents, "principal");
  await mkdir(p.dataDir, { recursive: true });
  await mkdir(principalDir, { recursive: true });
  await mkdir(p.bp, { recursive: true });
  await mkdir(p.workspaces, { recursive: true });
  await mkdir(p.logsDir, { recursive: true });

  // ② Default bp_template/agents/principal/* (user-editable).
  const writes: Array<[string, string]> = [
    [join(principalDir, "prompt.md"), PRINCIPAL_PROMPT],
    [join(principalDir, "settings.json"), PRINCIPAL_SETTINGS],
    [join(principalDir, "manifest.json"), PRINCIPAL_MANIFEST],
    // ③ session-level template defaults.
    [p.bpTemplateSettings, TEMPLATE_SETTINGS_EXAMPLE],
    [join(p.bpTemplate, "settings.example.json"), TEMPLATE_SETTINGS_EXAMPLE],
    [p.bpTemplateMcpServers, TEMPLATE_MCP_EXAMPLE],
    [join(p.bpTemplate, "mcp_servers.example.json"), TEMPLATE_MCP_EXAMPLE],
    // ④ CLI global config.
    [
      p.brainpilotConfig,
      JSON.stringify(
        {
          port: options.port ?? DEFAULT_PORT,
          dataDir: ".",
          provider: { name: options.provider ?? "anthropic" },
          logLevel: "info",
        },
        null,
        2,
      ),
    ],
  ];

  for (const [path, content] of writes) {
    if (await writeIfAbsent(path, content)) created.push(path);
  }

  return { paths: p, created };
}

/** Whether the data dir already has a `bp_template/` (used by `up` to decide). */
export async function isScaffolded(dataDir: string): Promise<boolean> {
  return exists(dataPaths(dataDir).bpTemplate);
}
