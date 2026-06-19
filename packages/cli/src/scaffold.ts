/**
 * scaffold.ts — materialize the `./brainpilot/` launch directory tree
 * (TS_PI_REFACTOR_DESIGN §11A.2).
 *
 * What gets written (idempotent — existing files are never overwritten):
 *   - directory skeleton (bp_template/, bp_template/agents/, bp_template/skills/,
 *     .bp/, workspaces/, .runtime/logs/)
 *   - providers.json + providers.example.json
 *   - mcp_servers.json + mcp_servers.example.json
 *   - skills/README.md + skills/example.md
 *   - brainpilot.config.json
 *
 * What is INTENTIONALLY NOT written (#102 fix):
 *   - Per-agent prompt.md / manifest.json / settings.json under
 *     bp_template/agents/<name>/. These used to be scaffolded as
 *     user-editable copies of the built-in PERSONAS, but the writeIfAbsent
 *     guard meant they never picked up upstream prompt updates after a user
 *     ran `init` once — anyone who pulled new code kept silently running on
 *     stale prompts. The runtime's `loadPersona` already falls back to the
 *     in-code PERSONAS when the on-disk file is absent, so leaving the dir
 *     empty by default is the correct behaviour. Users who want to override
 *     a prompt can materialise one with `brainpilot template reset <agent>`.
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

/** Empty provider registry (the SSOT). Users add profiles via the Settings UI
 * or `brainpilot init --api-key …`. An empty registry is valid: resolveProvider
 * falls back to env until a profile exists. */
const TEMPLATE_PROVIDERS_DEFAULT = JSON.stringify({ profiles: [] }, null, 2);

/** Annotated example showing a filled-in provider profile to copy from. */
const TEMPLATE_PROVIDERS_EXAMPLE = JSON.stringify(
  {
    profiles: [
      {
        id: "example",
        name: "Example Gateway",
        baseUrl: "https://your-gateway.example.com",
        apiKey: "sk-...",
        models: ["claude-sonnet-4-6"],
      },
    ],
    selectedProfileId: "example",
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

/**
 * README dropped into the empty `bp_template/agents/` dir so users understand
 * why it isn't pre-populated — and how to materialise an override when they
 * actually want one.
 */
const AGENTS_README = `# Agent prompt overrides

This directory is intentionally **empty by default** — BrainPilot loads agent
system prompts from its built-in \`PERSONAS\` registry that ships with the
runtime package, so a fresh install always uses the latest prompts after
\`git pull\` without any extra step.

Drop a file at \`agents/<name>/prompt.md\` to **override** a built-in agent's
prompt. The runtime reads the on-disk file first and falls back to the built-in
when the file is absent or empty.

Easiest way to start customising an agent: materialise the current built-in
prompt as a starting point, then edit it.

\`\`\`bash
npm run bp -- template reset <agent>      # writes built-in prompt to disk
# now edit bp_template/agents/<agent>/prompt.md
\`\`\`

Other useful subcommands:

\`\`\`bash
npm run bp -- template list               # show drift status for every agent
npm run bp -- template diff [<agent>]     # show local vs built-in diff
npm run bp -- template reset [<agent>]    # overwrite local with built-in (backs up)
\`\`\`

Built-in agent names: principal, librarian, experimentalist, engineer, writer,
auditor, trace.
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

  // ① Directory skeleton — bp_template/agents/ is created (empty) so users
  //    have an obvious place to drop overrides; see AGENTS_README below.
  await mkdir(p.dataDir, { recursive: true });
  await mkdir(p.bpTemplateAgents, { recursive: true });
  await mkdir(p.bpTemplateSkills, { recursive: true });
  await mkdir(p.bp, { recursive: true });
  await mkdir(p.workspaces, { recursive: true });
  await mkdir(p.logsDir, { recursive: true });

  const writes: Array<[string, string]> = [
    // ② provider registry (SSOT) + an annotated example to copy from.
    [p.bpTemplateProviders, TEMPLATE_PROVIDERS_DEFAULT],
    [join(p.bpTemplate, "providers.example.json"), TEMPLATE_PROVIDERS_EXAMPLE],
    [p.bpTemplateMcpServers, TEMPLATE_MCP_DEFAULT],
    [join(p.bpTemplate, "mcp_servers.example.json"), TEMPLATE_MCP_EXAMPLE],
    // ③ app-controlled skills (loaded instead of host-global ~/.pi/agent/skills).
    [join(p.bpTemplateSkills, "README.md"), SKILLS_README],
    [join(p.bpTemplateSkills, "example.md"), EXAMPLE_SKILL],
    // ④ agents dir README — empty by design (#102 fix).
    [join(p.bpTemplateAgents, "README.md"), AGENTS_README],
    // ⑤ CLI global config.
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
