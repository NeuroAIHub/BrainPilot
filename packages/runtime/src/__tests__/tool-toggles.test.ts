/**
 * Tests for the disk loader that parses
 * `<dataRoot>/bp_template/tool_toggles.json`.
 *
 * Invariants under test:
 *   - Missing file / missing dir / unparseable JSON → `null` (caller treats
 *     as "all enabled"). No throw, ever.
 *   - Only the three known keys are surfaced; unknown keys are silently
 *     dropped so a hand-edited typo can't accidentally disable a built-in.
 *   - Non-boolean values are ignored (fall back to default-on), matching
 *     the "malformed config never breaks the runtime" philosophy.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadToolToggles,
  isToolEnabled,
  TOGGLEABLE_TOOL_NAMES,
} from "../tool-toggles.js";

describe("tool-toggles loader", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "bp-toggles-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function writeToggles(content: string): Promise<void> {
    const dir = join(root, "bp_template");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "tool_toggles.json"), content, "utf8");
  }

  it("returns null when the file is absent (default-on)", async () => {
    const result = await loadToolToggles(root);
    expect(result).toBeNull();
    // And the default-on invariant: every known tool reads as enabled.
    for (const name of TOGGLEABLE_TOOL_NAMES) {
      expect(isToolEnabled(result, name)).toBe(true);
    }
  });

  it("returns null on unparseable JSON (never throws)", async () => {
    await writeToggles("this is not JSON");
    const result = await loadToolToggles(root);
    expect(result).toBeNull();
  });

  it("returns null when the top level is not an object", async () => {
    await writeToggles("[true, false]");
    expect(await loadToolToggles(root)).toBeNull();
    await writeToggles("42");
    expect(await loadToolToggles(root)).toBeNull();
    await writeToggles("null");
    expect(await loadToolToggles(root)).toBeNull();
  });

  it("parses the three known boolean fields", async () => {
    await writeToggles(JSON.stringify({
      skill_search: false,
      get_domain_knowledge_local: true,
      search_papers_local: false,
    }));
    const result = await loadToolToggles(root);
    expect(result).toEqual({
      skill_search: false,
      get_domain_knowledge_local: true,
      search_papers_local: false,
    });
    expect(isToolEnabled(result, "skill_search")).toBe(false);
    expect(isToolEnabled(result, "search_papers_local")).toBe(false);
    expect(isToolEnabled(result, "get_domain_knowledge_local")).toBe(true);
  });

  it("missing fields fall back to enabled (partial patch semantics)", async () => {
    // A one-off patch that only writes one field must NOT surprise-disable
    // the other two. isToolEnabled defaults missing keys to `true`.
    await writeToggles(JSON.stringify({ skill_search: false }));
    const result = await loadToolToggles(root);
    expect(result).toEqual({ skill_search: false });
    expect(isToolEnabled(result, "skill_search")).toBe(false);
    expect(isToolEnabled(result, "get_domain_knowledge_local")).toBe(true);
    expect(isToolEnabled(result, "search_papers_local")).toBe(true);
  });

  it("silently drops unknown keys (a typo can't disable a built-in)", async () => {
    // A hand-edit that misspells `skil_search` or names a real always-on
    // tool like `dispatch_task` must not cause the loader to expose that key.
    await writeToggles(JSON.stringify({
      skil_search: false,        // typo
      dispatch_task: false,      // not toggleable
      skill_search: true,
    }));
    const result = await loadToolToggles(root);
    expect(result).toEqual({ skill_search: true });
    // Verify the always-on lookup is unaffected — `isToolEnabled` only
    // accepts the strict union, so the caller can't ask about dispatch_task
    // (typescript blocks it), but we can still assert the object shape.
    expect(result).not.toHaveProperty("dispatch_task");
  });

  it("non-boolean values are dropped (default-on fallback)", async () => {
    // `"off"`, `1`, `null` — none of these are booleans and must not be
    // interpreted as "disabled". Only explicit `false` disables.
    await writeToggles(JSON.stringify({
      skill_search: "off",
      get_domain_knowledge_local: 1,
      search_papers_local: null,
    }));
    const result = await loadToolToggles(root);
    // Nothing survived the boolean filter.
    expect(result).toEqual({});
    for (const name of TOGGLEABLE_TOOL_NAMES) {
      expect(isToolEnabled(result, name)).toBe(true);
    }
  });

  it("explicit true and explicit false are both preserved", async () => {
    await writeToggles(JSON.stringify({
      skill_search: true,
      get_domain_knowledge_local: false,
    }));
    const result = await loadToolToggles(root);
    expect(result?.skill_search).toBe(true);
    expect(result?.get_domain_knowledge_local).toBe(false);
    expect(result).not.toHaveProperty("search_papers_local");
  });
});
