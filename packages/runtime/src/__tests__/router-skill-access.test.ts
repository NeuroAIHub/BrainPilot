/**
 * #309 — path boundary helpers for the disabled-router skill library.
 */
import { describe, expect, it } from "vitest";
import { join, resolve } from "node:path";
import {
  bashTouchesRouterSkills,
  denyRouterSkillsReason,
  isUnderRouterSkillsDir,
  pathsFromToolCall,
  shouldBlockToolCall,
} from "../router-skill-access.js";

const router = resolve("/data/bp_template/skills-router");
const alwaysOn = resolve("/data/bp_template/skills");
const cwd = resolve("/data/workspaces/s1");

describe("isUnderRouterSkillsDir", () => {
  it("denies paths at or under the router root", () => {
    expect(isUnderRouterSkillsDir(router, router)).toBe(true);
    expect(
      isUnderRouterSkillsDir(join(router, "02_EEG", "x", "SKILL.md"), router),
    ).toBe(true);
  });

  it("allows always-on skills and unrelated paths", () => {
    expect(
      isUnderRouterSkillsDir(join(alwaysOn, "01_Meta-Skills", "x", "SKILL.md"), router),
    ).toBe(false);
    expect(isUnderRouterSkillsDir(join(cwd, "notes.md"), router)).toBe(false);
    expect(isUnderRouterSkillsDir("/etc/passwd", router)).toBe(false);
  });

  it("resolves relative paths against cwd and blocks traversal into router", () => {
    // From workspaces/s1, climb to data root then into skills-router.
    const rel = join("..", "..", "bp_template", "skills-router", "cat", "SKILL.md");
    expect(isUnderRouterSkillsDir(rel, router, cwd)).toBe(true);
    expect(isUnderRouterSkillsDir("notes.md", router, cwd)).toBe(false);
  });

  it("does not match a sibling folder that merely contains the same name as a substring", () => {
    // A workspace path that includes the string but is not under the absolute root.
    expect(
      isUnderRouterSkillsDir(join(cwd, "skills-router-notes.md"), router, cwd),
    ).toBe(false);
  });
});

describe("pathsFromToolCall", () => {
  it("extracts path / file_path from structured file tools", () => {
    expect(pathsFromToolCall("read", { path: "/a/b" }, cwd)).toEqual(["/a/b"]);
    expect(pathsFromToolCall("edit", { file_path: "/a/c" }, cwd)).toEqual(["/a/c"]);
    expect(pathsFromToolCall("ls", { path: "." }, cwd)).toEqual(["."]);
    expect(pathsFromToolCall("find", { pattern: "*.md", path: router }, cwd)).toEqual([
      router,
    ]);
    expect(pathsFromToolCall("grep", { pattern: "x", path: alwaysOn }, cwd)).toEqual([
      alwaysOn,
    ]);
  });

  it("returns no paths for bash / skill_search / empty input", () => {
    expect(pathsFromToolCall("bash", { command: "ls" }, cwd)).toEqual([]);
    expect(pathsFromToolCall("skill_search", { mode: "browse" }, cwd)).toEqual([]);
    expect(pathsFromToolCall("read", null, cwd)).toEqual([]);
    expect(pathsFromToolCall("ls", {}, cwd)).toEqual([]);
  });
});

describe("bashTouchesRouterSkills", () => {
  it("flags commands that embed the absolute router path or stable relative tail", () => {
    expect(bashTouchesRouterSkills(`cat ${router}/x/SKILL.md`, router)).toBe(true);
    expect(
      bashTouchesRouterSkills("find bp_template/skills-router -name SKILL.md", router),
    ).toBe(true);
  });

  it("allows ordinary workspace commands", () => {
    expect(bashTouchesRouterSkills("ls -la", router)).toBe(false);
    expect(bashTouchesRouterSkills("cat notes.md", router)).toBe(false);
    expect(bashTouchesRouterSkills(`cat ${alwaysOn}/x/SKILL.md`, router)).toBe(false);
  });
});

describe("shouldBlockToolCall", () => {
  it("blocks read of router SKILL.md and allows always-on", () => {
    expect(
      shouldBlockToolCall({
        toolName: "read",
        input: { path: join(router, "cat", "SKILL.md") },
        routerSkillsDir: router,
        cwd,
      }),
    ).toBe(denyRouterSkillsReason());

    expect(
      shouldBlockToolCall({
        toolName: "read",
        input: { path: join(alwaysOn, "01_Meta-Skills", "x", "SKILL.md") },
        routerSkillsDir: router,
        cwd,
      }),
    ).toBeNull();
  });

  it("blocks find/ls/grep aimed at the router root", () => {
    for (const toolName of ["find", "ls", "grep"] as const) {
      expect(
        shouldBlockToolCall({
          toolName,
          input: { path: router, pattern: ".*" },
          routerSkillsDir: router,
          cwd,
        }),
        toolName,
      ).toBe(denyRouterSkillsReason());
    }
  });

  it("blocks bash that references the router path", () => {
    expect(
      shouldBlockToolCall({
        toolName: "bash",
        input: { command: `cat ${router}/x/SKILL.md` },
        routerSkillsDir: router,
        cwd,
      }),
    ).toBe(denyRouterSkillsReason());
    expect(
      shouldBlockToolCall({
        toolName: "bash",
        input: { command: "echo hello" },
        routerSkillsDir: router,
        cwd,
      }),
    ).toBeNull();
  });
});
