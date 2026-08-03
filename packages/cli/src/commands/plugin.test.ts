import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { pluginCreate, pluginTest } from "./plugin.js";

describe("plugin conformance command", () => {
  it("tests a generated range-preview plugin through the SDK testing entry", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "bp-cli-plugin-test-"));
    const messages: string[] = [];
    await pluginCreate({ dir: root, id: "org.example.range-preview" }, (message) => messages.push(message));
    await pluginTest({ dir: root, environment: "local" }, (message) => messages.push(message));
    expect(messages).toContain("Plugin conformance: passed");
    await rm(root, { recursive: true, force: true });
  });
});
