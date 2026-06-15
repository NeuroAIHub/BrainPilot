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
import {
  PERSONAS,
  BUILTIN_PERSONA_NAMES,
  AGENT_TOOL_CONFIG,
  BUILTIN_TOOL_CONFIG,
  BUILTIN_TOOL_CONFIG_BY_NAME,
} from "@brainpilot/runtime";
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

/**
 * Per-agent persona text, sourced from the runtime's single-source-of-truth
 * `PERSONAS` registry so the scaffolded, user-editable copies never drift from
 * the built-in defaults the runtime falls back to.
 */
const AGENT_PROMPTS: Record<string, string> = PERSONAS;

/** Roles by agent name (mirrors `roleFor` in the runtime). */
function roleForName(name: string): string {
  if (name === "principal") return "principal";
  if (name === "trace") return "trace";
  return "expert";
}

/** Full tool allowlist (system + builtin) an agent is granted, for the manifest. */
function allowedToolsForName(name: string): string[] {
  const role = roleForName(name);
  const sys =
    role === "principal"
      ? AGENT_TOOL_CONFIG.principal!
      : role === "trace"
        ? AGENT_TOOL_CONFIG.trace!
        : (AGENT_TOOL_CONFIG[name] ?? AGENT_TOOL_CONFIG.expert!);
  const builtin =
    role === "expert"
      ? (BUILTIN_TOOL_CONFIG_BY_NAME[name] ?? BUILTIN_TOOL_CONFIG.expert!)
      : (BUILTIN_TOOL_CONFIG[role] ?? BUILTIN_TOOL_CONFIG._default!);
  return [...sys, ...builtin];
}

function agentManifest(name: string): string {
  return JSON.stringify(
    {
      role: roleForName(name),
      parent: name === "principal" ? null : "principal",
      allowedTools: allowedToolsForName(name),
    },
    null,
    2,
  );
}

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

/**
 * Default `mcp_servers.json` written into `bp_template/` (§11A.2).
 *
 * Ships BrainPilot's three built-in remote MCP services (knowledge base, skills,
 * paper search) over streamable-http. Edit or remove these entries to point at
 * your own deployment; an entry whose `url` is blanked out is treated as an
 * unconfigured placeholder and skipped at startup.
 */
const TEMPLATE_MCP_DEFAULT = JSON.stringify(
  {
    mcpServers: {
      bp_KB: {
        type: "http",
        url: "http://8.145.42.208:8005/mcp",
      },
      bp_skills: {
        type: "http",
        url: "http://8.145.42.208:8006/mcp",
      },
      bp_papersearch: {
        type: "http",
        url: "http://8.145.42.208:8007/mcp",
      },
    },
  },
  null,
  2,
);

/**
 * Annotated `mcp_servers.example.json` — shows every supported transport
 * (stdio / streamable-http / sse) with a filled-in shape to copy from.
 */
const TEMPLATE_MCP_EXAMPLE = JSON.stringify(
  {
    mcpServers: {
      "fs-stdio": {
        type: "stdio",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/dir"],
        env: {},
      },
      "remote-http": {
        type: "http",
        url: "https://your-mcp-host.example.com/mcp",
        headers: { Authorization: "Bearer <token>" },
      },
      "remote-sse": {
        type: "sse",
        url: "https://your-mcp-host.example.com/sse",
        headers: { Authorization: "Bearer <token>" },
      },
    },
  },
  null,
  2,
);

/**
 * README for `bp_template/skills/` — explains the app-controlled skill dir.
 * BrainPilot loads skills ONLY from this template dir (shared by every session)
 * and each session's own `.bp/<id>/skills/`; the host-global `~/.pi/agent/skills`
 * is intentionally NOT loaded (`noSkills: true`), so agent behaviour stays
 * reproducible across machines.
 */
const SKILLS_README = `# BrainPilot skills

Drop Agent Skills here to extend what the agents can do. Everything in this
folder is shared by **every session** in this data dir.

Two ways to add a skill:

1. A single Markdown file — \`my-skill.md\` (loaded as one skill).
2. A folder containing \`SKILL.md\` — \`my-skill/SKILL.md\` (the folder is the
   skill root; supporting files can live alongside it).

Each skill starts with YAML frontmatter:

\`\`\`markdown
---
name: my-skill
description: One line telling the model when to use this skill.
# disable-model-invocation: true   # hide from the prompt; only /skill:my-skill
---

Instructions the agent follows when this skill is invoked.
\`\`\`

Notes:
- Skills without \`disable-model-invocation\` are injected into the system prompt,
  so the model can invoke them autonomously.
- Per-session overrides go in \`.bp/<session-id>/skills/\` (same rules).
- The host's global \`~/.pi/agent/skills\` is **not** loaded — only this dir.
`;

/** A disabled-by-default example skill so the template dir is self-documenting. */
const EXAMPLE_SKILL = `---
name: example
description: Example skill template. Replace with your own; remove disable-model-invocation to let the model use it.
disable-model-invocation: true
---

# Example skill

This is a placeholder skill shipped with BrainPilot's scaffold. It is hidden
from the model (\`disable-model-invocation: true\`) so it never affects real runs.

To create your own skill, copy this file, rename it, write a clear
\`description:\` (the model reads it to decide when to use the skill), drop the
\`disable-model-invocation\` line, and put the instructions below the frontmatter.
`;

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
  await mkdir(p.dataDir, { recursive: true });
  await mkdir(p.bpTemplateAgents, { recursive: true });
  await mkdir(p.bpTemplateSkills, { recursive: true });
  await mkdir(p.bp, { recursive: true });
  await mkdir(p.workspaces, { recursive: true });
  await mkdir(p.logsDir, { recursive: true });

  // ② Default bp_template/agents/<name>/* for every built-in agent
  //    (user-editable; the runtime loads prompt.md when present, else falls
  //    back to the same built-in persona this is sourced from).
  const writes: Array<[string, string]> = [];
  for (const name of BUILTIN_PERSONA_NAMES) {
    const dir = join(p.bpTemplateAgents, name);
    await mkdir(dir, { recursive: true });
    writes.push([join(dir, "prompt.md"), AGENT_PROMPTS[name]!]);
    writes.push([join(dir, "manifest.json"), agentManifest(name)]);
    // Only the principal carries provider/model defaults; experts inherit the
    // session-level template settings.
    if (name === "principal") {
      writes.push([join(dir, "settings.json"), PRINCIPAL_SETTINGS]);
    }
  }

  writes.push(
    // ③ session-level template defaults.
    [p.bpTemplateSettings, TEMPLATE_SETTINGS_EXAMPLE],
    [join(p.bpTemplate, "settings.example.json"), TEMPLATE_SETTINGS_EXAMPLE],
    [p.bpTemplateMcpServers, TEMPLATE_MCP_DEFAULT],
    [join(p.bpTemplate, "mcp_servers.example.json"), TEMPLATE_MCP_EXAMPLE],
    // ③a app-controlled skills (loaded instead of host-global ~/.pi/agent/skills).
    [join(p.bpTemplateSkills, "README.md"), SKILLS_README],
    [join(p.bpTemplateSkills, "example.md"), EXAMPLE_SKILL],
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
  );

  for (const [path, content] of writes) {
    if (await writeIfAbsent(path, content)) created.push(path);
  }

  return { paths: p, created };
}

/** Whether the data dir already has a `bp_template/` (used by `up` to decide). */
export async function isScaffolded(dataDir: string): Promise<boolean> {
  return exists(dataPaths(dataDir).bpTemplate);
}
