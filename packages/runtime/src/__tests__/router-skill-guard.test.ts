/**
 * #309 — router-skill-guard extension blocks tool_call events under the
 * disabled router library.
 */
import { describe, expect, it } from "vitest";
import { join, resolve } from "node:path";
import { makeRouterSkillGuardExt } from "../extensions/router-skill-guard.js";
import { denyRouterSkillsReason } from "../router-skill-access.js";

const router = resolve("/data/bp_template/skills-router");
const alwaysOn = resolve("/data/bp_template/skills");
const cwd = resolve("/data/workspaces/s1");

type ToolCallHandler = (e: {
  toolName: string;
  input: Record<string, unknown>;
}) => { block?: boolean; reason?: string } | void;

function install(enforce: boolean): ToolCallHandler | null {
  let handler: ToolCallHandler | null = null;
  const ext = makeRouterSkillGuardExt({
    routerSkillsDir: router,
    cwd,
    enforce,
  });
  ext({
    on(_event, h) {
      handler = h as ToolCallHandler;
    },
  });
  return handler;
}

describe("makeRouterSkillGuardExt", () => {
  it("registers nothing when enforce is false", () => {
    expect(install(false)).toBeNull();
  });

  it("blocks read of router paths and allows always-on", () => {
    const handler = install(true);
    expect(handler).toBeTruthy();

    expect(
      handler!({
        toolName: "read",
        input: { path: join(router, "02_EEG", "x", "SKILL.md") },
      }),
    ).toEqual({ block: true, reason: denyRouterSkillsReason() });

    expect(
      handler!({
        toolName: "read",
        input: { path: join(alwaysOn, "01_Meta-Skills", "x", "SKILL.md") },
      }),
    ).toBeUndefined();
  });

  it("blocks find/ls/grep on the router root", () => {
    const handler = install(true)!;
    for (const toolName of ["find", "ls", "grep"]) {
      expect(
        handler({ toolName, input: { path: router } }),
        toolName,
      ).toEqual({ block: true, reason: denyRouterSkillsReason() });
    }
  });

  it("best-effort blocks bash that embeds the router path", () => {
    const handler = install(true)!;
    expect(
      handler({
        toolName: "bash",
        input: { command: `cat ${router}/SKILL.md` },
      }),
    ).toEqual({ block: true, reason: denyRouterSkillsReason() });
    expect(
      handler({ toolName: "bash", input: { command: "pwd" } }),
    ).toBeUndefined();
  });
});
