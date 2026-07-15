/** Per-session domain-resource isolation and content-free usage classification. */
import { basename, dirname } from "node:path";
import type { DomainResources, DomainResourceUsageValue } from "@brainpilot/protocol";
import type { ToolToggles } from "./tool-toggles.js";

export const DOMAIN_TOOL_NAMES = [
  "get_domain_knowledge_local",
  "search_papers_local",
] as const;

/** Only omission means the backward-compatible full mode; bad values fail. */
export function resolveDomainResources(value: unknown): DomainResources {
  if (value === undefined || value === "full") return "full";
  if (value === "base") return "base";
  throw new Error(`invalid domainResources: ${String(value)}`);
}

/** Base always wins over global defaults without mutating the shared table. */
export function toolTogglesForDomainResources(
  mode: DomainResources,
  toggles: ToolToggles | null,
): ToolToggles | null {
  if (mode === "full") return toggles;
  return {
    ...(toggles ?? {}),
    skill_search: false,
    get_domain_knowledge_local: false,
    search_papers_local: false,
  };
}

/**
 * Remove complete Markdown sections whose H2 heading advertises skills or the
 * router. Built-in personas keep all orchestration/safety instructions while
 * base sessions receive none of the unavailable-resource guidance.
 */
export function withoutDomainResourceInstructions(persona: string): string {
  const lines = persona.split("\n");
  const kept: string[] = [];
  let skipping = false;
  for (const line of lines) {
    const heading = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (heading && heading[1]!.length <= 2) {
      const isResourceSection = /(?:^|\W)(?:skills?|router)(?:\W|$)/i.test(heading[2]!);
      if (isResourceSection) {
        skipping = true;
        continue;
      }
      skipping = false;
    }
    if (!skipping) kept.push(line);
  }
  return kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * #309: when only `skill_search` is off (always-on Meta-Skills still load),
 * strip router-library teaching from the persona while keeping always-on skill
 * guidance. Applies to built-in and on-disk `prompt.md` copies.
 *
 * Rules (deterministic, unit-tested):
 *  1. Drop H1/H2 sections whose title matches "router skill library".
 *  2. Drop numbered/bulleted list items that introduce the **Router** library.
 *  3. Drop any remaining line that references the `skill_search` tool.
 */
export function withoutRouterSkillInstructions(persona: string): string {
  const lines = persona.split("\n");
  const kept: string[] = [];
  let skippingSection = false;
  let skippingRouterItem = false;

  for (const line of lines) {
    const heading = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (heading && heading[1]!.length <= 2) {
      skippingSection = /router\s+skill\s+library/i.test(heading[2]!);
      skippingRouterItem = false;
      if (skippingSection) continue;
    }
    if (skippingSection) continue;

    // List item that introduces the Router library (e.g. "2. **Router** — ...").
    if (/^\s*(?:\d+\.\s+)?(?:[-*]\s+)?\*{0,2}Router\*{0,2}\b/i.test(line)) {
      skippingRouterItem = true;
      continue;
    }
    if (skippingRouterItem) {
      // End the dropped item at the next sibling list entry or blank line.
      if (/^\s*$/.test(line) || /^\s*(?:\d+\.\s+|[-*]\s+)/.test(line)) {
        skippingRouterItem = false;
        // Re-process the line as a potential new item / blank.
        if (/^\s*(?:\d+\.\s+)?(?:[-*]\s+)?\*{0,2}Router\*{0,2}\b/i.test(line)) {
          skippingRouterItem = true;
          continue;
        }
        if (/^\s*$/.test(line)) {
          kept.push(line);
          continue;
        }
        // Fall through to normal handling for a new non-Router list item.
      } else {
        continue;
      }
    }

    // Any leftover skill_search call / mention (tool is not registered).
    if (/\bskill_search\b/i.test(line)) continue;

    kept.push(line);
  }

  return kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function safeSkillName(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const name = value.trim();
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(name) ? name : undefined;
}

function skillNameFromPath(value: unknown): string | undefined {
  if (typeof value !== "string" || !/(?:^|[\\/])SKILL\.md$/i.test(value)) return undefined;
  return safeSkillName(basename(dirname(value))) ?? "unknown";
}

/** Count attempts at the moment the provider starts the tool call. */
export function domainResourceUsageOnStart(
  toolName: string,
  args: Record<string, unknown>,
): DomainResourceUsageValue | null {
  if (toolName === "get_domain_knowledge_local" || toolName === "search_papers_local") {
    return { schemaVersion: "1.0", kind: "domain_tool_call", toolName, source: "system_tool" };
  }
  if (
    toolName === "skill_search" &&
    args.mode === "query" &&
    typeof args.keywords === "string" &&
    args.keywords.trim().length > 0
  ) {
    return { schemaVersion: "1.0", kind: "skill_search", toolName, source: "router" };
  }
  return null;
}

/** Count a skill load only after the tool reports success. */
export function domainResourceUsageOnSuccess(
  toolName: string,
  args: Record<string, unknown>,
  isError: boolean,
  result?: unknown,
): DomainResourceUsageValue | null {
  if (isError) return null;
  let resultText = "";
  try { resultText = typeof result === "string" ? result : JSON.stringify(result ?? ""); }
  catch { return null; } // opaque/cyclic results are not evidence of a full load
  if (!resultText.trim()) return null;
  const details =
    typeof result === "object" && result !== null
      ? (result as { details?: { truncation?: { truncated?: boolean } } }).details
      : undefined;
  if (
    details?.truncation?.truncated === true ||
    /\[(?:Showing lines|Truncated:|⚠️ 结果已截断)/.test(resultText)
  ) return null;
  if (toolName === "skill_search") {
    const direct = args.mode === "query" ? safeSkillName(args.skill_name) : undefined;
    const browsed = args.mode === "browse" ? skillNameFromPath(args.relative_path) : undefined;
    const skillName = direct ?? browsed;
    return skillName
      ? { schemaVersion: "1.0", kind: "skill_load", skillName, source: "router" }
      : null;
  }
  if (toolName === "read" && args.offset === undefined && args.limit === undefined) {
    const skillName = skillNameFromPath(args.path ?? args.file_path);
    return skillName
      ? { schemaVersion: "1.0", kind: "skill_load", skillName, source: "builtin_read" }
      : null;
  }
  return null;
}
