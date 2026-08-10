import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

export interface SubagentProfile {
  name: string;
  description: string;
  allowedParents: string[];
  builtinTools: string[];
  systemTools: string[];
  mcp: boolean;
  modelId?: string;
  timeoutMs?: number;
  prompt: string;
}

const BASE = `You are a leaf subagent inside BrainPilot. Work only on the assigned task.
You have a fresh conversation and must not assume knowledge that is not present in the task,
context, or input manifest. Your working directory is the shared session workspace unless the
task explicitly selects isolation. The prompt names a private scratch directory for temporary
fixtures and logs. Shared edits are immediately visible to every agent: preserve unrelated work,
write temporary files under scratch, and report every modified path. Input references are read-only
unless the task explicitly asks you to modify them.
You cannot contact the user or other agents and cannot delegate further.
Call submit_result exactly once. Use outcome=blocked when required inputs or checks are unavailable;
otherwise use outcome=completed and list the paths inspected and commands actually run.`;

const BUILTINS: Record<string, SubagentProfile> = {
  "literature-scout": {
    name: "literature-scout",
    description: "Finds and evaluates literature and source evidence.",
    allowedParents: ["librarian", "experimentalist"],
    builtinTools: ["read", "write", "edit", "grep", "find", "glob", "ls"],
    systemTools: ["skill_search", "get_domain_knowledge_local", "search_papers_local"],
    mcp: true,
    prompt: `${BASE}\n\nFocus on source quality, direct evidence, disagreements, and citation details.`,
  },
  "evidence-extractor": {
    name: "evidence-extractor",
    description: "Extracts structured evidence from supplied material.",
    allowedParents: ["librarian", "experimentalist", "writer", "auditor"],
    builtinTools: ["read", "write", "edit", "grep", "find", "glob", "ls"],
    systemTools: ["skill_search", "get_domain_knowledge_local", "search_papers_local"],
    mcp: false,
    prompt: `${BASE}\n\nExtract only claims supported by the supplied material and identify missing evidence.`,
  },
  "code-runner": {
    name: "code-runner",
    description: "Implements or validates code in an isolated scratch workspace.",
    allowedParents: ["engineer", "experimentalist"],
    builtinTools: ["read", "write", "edit", "bash", "grep", "find", "glob", "ls"],
    systemTools: ["skill_search", "get_domain_knowledge_local"],
    mcp: false,
    prompt: `${BASE}\n\nRun the relevant checks. Report exact commands, observed results, and produced files.`,
  },
  "method-reviewer": {
    name: "method-reviewer",
    description: "Reviews scientific or engineering methods against evidence and constraints.",
    allowedParents: ["experimentalist", "engineer", "auditor"],
    builtinTools: ["read", "grep", "find", "glob"],
    systemTools: ["skill_search", "get_domain_knowledge_local", "search_papers_local"],
    mcp: false,
    prompt: `${BASE}\n\nReview assumptions, validity threats, reproducibility, and concrete corrective actions.`,
  },
  "repo-scout": {
    name: "repo-scout",
    description: "Rapidly maps a codebase and returns source-linked architecture findings.",
    allowedParents: ["engineer", "experimentalist", "auditor"],
    builtinTools: ["read", "grep", "find", "glob", "ls"],
    systemTools: ["skill_search"],
    mcp: false,
    prompt: `${BASE}

Explore the supplied codebase read-only. Use broad pattern searches, follow imports and call sites,
and read only the relevant ranges. If a search is empty, try at least one broader or alternate query.
Report the key files, symbols, tests, and how the pieces connect so the parent does not need to
repeat the exploration. Never modify files or run state-changing commands.`,
  },
  "api-librarian": {
    name: "api-librarian",
    description: "Researches external libraries and APIs from versioned source and official documentation.",
    allowedParents: ["librarian", "engineer", "experimentalist"],
    builtinTools: ["read", "write", "edit", "grep", "find", "glob", "ls"],
    systemTools: ["skill_search", "get_domain_knowledge_local"],
    mcp: true,
    prompt: `${BASE}

Answer questions about external libraries and APIs from source code or official documentation,
never memory alone. Establish the exact version, inspect types and implementation, and cross-check
tests or examples. Report exact API signatures, source paths or URLs, relevant excerpts, defaults,
breaking changes, and caveats. Modify the shared workspace only when the task explicitly requests
a deliverable there.`,
  },
  "code-reviewer": {
    name: "code-reviewer",
    description: "Reviews supplied code or patches for concrete correctness and integration defects.",
    allowedParents: ["engineer", "auditor"],
    builtinTools: ["read", "write", "bash", "grep", "find", "glob", "ls"],
    systemTools: ["skill_search", "get_domain_knowledge_local"],
    mcp: false,
    prompt: `${BASE}

Review the supplied code or patch without modifying the implementation. Report only concrete,
actionable defects with a provable trigger and impact. Trace values across producer and consumer
boundaries and inspect nearby tests. When behavior depends on indexing, shape, ordering,
serialization, or another executable invariant, run a bounded deterministic reference test. Build
the oracle independently, use asymmetric dimensions and index-distinct values when applicable, and
compare values rather than shapes alone. Write fixtures only under scratch. Do not install packages,
use the network, train models, or generate performance evidence. Report exact commands and distinguish
introduced defects from pre-existing behavior. For every finding, include severity, confidence,
file path, tight line range, trigger, impact, and remediation.`,
  },
};

const ParentNameSchema = z.enum(["librarian", "engineer", "experimentalist", "writer", "auditor"]);
const ProfileFieldsSchema = z.object({
  version: z.literal(1),
  description: z.string().min(1).optional(),
  allowedParents: z.array(ParentNameSchema).min(1).optional(),
  builtinTools: z.array(z.string().min(1)).optional(),
  systemTools: z.array(z.string().min(1)).optional(),
  mcp: z.boolean().optional(),
  modelId: z.string().min(1).optional(),
  timeoutMs: z.number().int().positive().max(3_600_000).optional(),
}).strict();

const CustomProfileSchema = ProfileFieldsSchema.extend({
  description: z.string().min(1),
  allowedParents: z.array(ParentNameSchema).min(1),
  builtinTools: z.array(z.string().min(1)).default([]),
  systemTools: z.array(z.string().min(1)).default([]),
  mcp: z.boolean().default(false),
}).strict();

export const SUBAGENT_FORBIDDEN_TOOL_NAMES = new Set([
  "spawn_subagent", "wait_subagent", "get_subagent", "cancel_subagent", "list_subagent_profiles", "submit_result", "send_message", "ask_user",
  "create_agent", "destroy_agent", "record_trace", "create_trace_node",
  "update_trace_node", "add_trace_relation", "propose_trace_dependency",
  "create_trace_episode", "rename_trace_episode", "merge_trace_episodes",
  "split_trace_episode", "assign_trace_episode", "get_trace_graph",
  "get_trace_node", "get_trace_neighborhood", "search_trace",
]);
const BUILTIN_TOOL_NAMES = new Set(["read", "write", "edit", "bash", "grep", "find", "glob", "ls"]);
const SYSTEM_TOOL_NAMES = new Set(["skill_search", "get_domain_knowledge_local", "search_papers_local"]);

export function builtinSubagentProfiles(): SubagentProfile[] {
  return Object.values(BUILTINS).map((profile) => ({ ...profile, allowedParents: [...profile.allowedParents], builtinTools: [...profile.builtinTools], systemTools: [...profile.systemTools] }));
}

/** Serializable official templates used by the CLI scaffold. */
export function builtinSubagentTemplateFiles(): Array<{ name: string; prompt: string; profileJson: string }> {
  return builtinSubagentProfiles().map(({ name, prompt, ...profile }) => ({
    name,
    prompt: `${prompt.trim()}\n`,
    profileJson: `${JSON.stringify({ version: 1, ...profile }, null, 2)}\n`,
  }));
}

function assertProfileName(name: string): void {
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(name)) throw new Error(`invalid subagent profile name: ${name}`);
}

function validateTools(profile: SubagentProfile): SubagentProfile {
  profile.builtinTools = profile.builtinTools.filter((tool) => !SUBAGENT_FORBIDDEN_TOOL_NAMES.has(tool));
  profile.systemTools = profile.systemTools.filter((tool) => !SUBAGENT_FORBIDDEN_TOOL_NAMES.has(tool));
  const unknownBuiltin = profile.builtinTools.find((tool) => !BUILTIN_TOOL_NAMES.has(tool));
  const unknownSystem = profile.systemTools.find((tool) => !SYSTEM_TOOL_NAMES.has(tool));
  if (unknownBuiltin || unknownSystem) {
    throw new Error(`invalid subagent profile ${profile.name}: unknown tool ${unknownBuiltin ?? unknownSystem}`);
  }
  return profile;
}

export async function loadSubagentProfile(dataRoot: string, name: string): Promise<SubagentProfile | undefined> {
  assertProfileName(name);
  const builtin = BUILTINS[name];
  const dir = join(dataRoot, "bp_template", "subagents", name);
  let rawConfig: unknown;
  try {
    rawConfig = JSON.parse(await readFile(join(dir, "profile.json"), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error(`invalid subagent profile ${name}: ${(error as Error).message}`);
    if (!builtin) return undefined;
  }
  let prompt = builtin?.prompt;
  try {
    const custom = (await readFile(join(dir, "prompt.md"), "utf8")).trim();
    if (custom) prompt = custom;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (builtin) {
    let override: z.infer<typeof ProfileFieldsSchema> | undefined;
    try {
      if (rawConfig !== undefined) override = ProfileFieldsSchema.parse(rawConfig);
    } catch (error) {
      throw new Error(`invalid subagent profile ${name}: ${(error as Error).message}`);
    }
    return validateTools({ ...builtin, ...override, name, prompt: prompt ?? builtin.prompt });
  }
  if (!prompt) throw new Error(`invalid subagent profile ${name}: prompt.md is required`);
  let config: z.infer<typeof CustomProfileSchema>;
  try {
    config = CustomProfileSchema.parse(rawConfig);
  } catch (error) {
    throw new Error(`invalid subagent profile ${name}: ${(error as Error).message}`);
  }
  return validateTools({ ...config, name, prompt });
}

export async function allowedSubagentProfiles(dataRoot: string, parentAgent: string): Promise<SubagentProfile[]> {
  const names = new Set(Object.keys(BUILTINS));
  try {
    const entries = await readdir(join(dataRoot, "bp_template", "subagents"), { withFileTypes: true });
    for (const entry of entries) if (entry.isDirectory() && /^[a-z][a-z0-9-]{0,63}$/.test(entry.name)) names.add(entry.name);
  } catch { /* optional deployment directory */ }
  const settled = await Promise.allSettled([...names].sort().map((name) => loadSubagentProfile(dataRoot, name)));
  return settled.flatMap((item) => item.status === "fulfilled" && item.value?.allowedParents.includes(parentAgent) ? [item.value] : []);
}
