import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  capabilitiesForMarketplaceEntry,
  categoryForMarketplaceEntry,
  categoryForPluginKind,
  executesLocalCodeForMarketplaceEntry,
  findMcpRestartReturnFocus,
  matchesMarketplaceQuery,
  matchesMarketplaceSource,
  marketplacePluginOffersRuntimeRefresh,
  mcpRuntimeSummaryForPlugin,
  restartPromptForMcpMutation,
  shouldDismissMcpRestartPrompt,
  sourceFormatForMarketplaceEntry,
} from "../components/plugins/PluginMarketplace";
import { pluginMarketplaceSurface } from "../components/plugins/pluginMarketplaceAvailability";

const entry = {
  manifest: {
    id: "org.brainpilot.nifti-viewer",
    displayName: "NIfTI Viewer",
    description: "Central-slice neuroscience preview",
    version: "0.1.0",
    kind: "previewer",
  },
  publisher: "BrainPilot",
  verified: true,
} as Parameters<typeof matchesMarketplaceQuery>[0];

describe("plugin marketplace catalogue model", () => {
  it("keeps the catalogue local and shows an unavailable state in Cloud", () => {
    expect(pluginMarketplaceSurface(true)).toBe("marketplace");
    expect(pluginMarketplaceSurface(false)).toBe("cloud-unavailable");
  });

  it("maps plugin contribution kinds into their marketplace panels", () => {
    expect(categoryForPluginKind("skill-pack")).toBe("skills");
    expect(categoryForPluginKind("knowledge-base")).toBe("knowledge");
    expect(categoryForPluginKind("literature-provider")).toBe("knowledge");
    expect(categoryForPluginKind("previewer")).toBe("plugins");
    expect(categoryForPluginKind("workflow")).toBe("plugins");
    expect(categoryForMarketplaceEntry({
      ...entry,
      manifest: { ...entry.manifest, kind: undefined, categories: ["skills"], contributes: { skills: [{ id: "method", title: "Method", entry: "SKILL.md" }] } },
    })).toBe("skills");
  });

  it("searches names, descriptions, ids, kinds, and publishers case-insensitively", () => {
    expect(matchesMarketplaceQuery(entry, "nifti")).toBe(true);
    expect(matchesMarketplaceQuery(entry, "NEUROSCIENCE")).toBe(true);
    expect(matchesMarketplaceQuery(entry, "brainpilot")).toBe(true);
    expect(matchesMarketplaceQuery(entry, "previewer")).toBe(true);
    expect(matchesMarketplaceQuery(entry, "atlas")).toBe(false);
  });

  it("defaults legacy entries to BrainPilot and filters explicit ecosystem sources", () => {
    expect(sourceFormatForMarketplaceEntry(entry)).toBe("brainpilot");
    expect(matchesMarketplaceSource(entry, "brainpilot")).toBe(true);
    expect(matchesMarketplaceSource({ ...entry, sourceFormat: "claude-code" }, "claude-code")).toBe(true);
    expect(matchesMarketplaceSource({ ...entry, sourceFormat: "claude-code" }, "codex")).toBe(false);
    expect(matchesMarketplaceSource(entry, "verified")).toBe(true);
  });

  it("uses explicit compact capabilities and derives legacy Skills", () => {
    expect(capabilitiesForMarketplaceEntry({ ...entry, capabilities: ["mcp", "hooks"] })).toEqual(["mcp", "hooks"]);
    expect(capabilitiesForMarketplaceEntry({
      ...entry,
      manifest: { ...entry.manifest, contributes: { skills: [{ id: "method", title: "Method", entry: "SKILL.md" }] } },
    })).toEqual(["skills"]);
  });

  it("uses explicit local-code metadata and falls back to executable capabilities", () => {
    expect(executesLocalCodeForMarketplaceEntry({ executesLocalCode: false, capabilities: ["hooks"] })).toBe(false);
    expect(executesLocalCodeForMarketplaceEntry({ capabilities: ["mcp"] })).toBe(true);
    expect(executesLocalCodeForMarketplaceEntry({ capabilities: ["skills"] })).toBe(false);
  });

  it("offers an optional runtime refresh only for MCP-capable marketplace plugins", () => {
    expect(marketplacePluginOffersRuntimeRefresh({ ...entry, capabilities: ["mcp"] })).toBe(true);
    expect(marketplacePluginOffersRuntimeRefresh({ ...entry, capabilities: ["skills", "hooks"] })).toBe(false);
  });

  it("offers an optional refresh for mutations of enabled MCP plugins", () => {
    const mcpEntry = {
      ...entry,
      capabilities: ["mcp"],
    } as Parameters<typeof restartPromptForMcpMutation>[0];
    expect(restartPromptForMcpMutation(mcpEntry, true, "reload")).toEqual({
      pluginId: "org.brainpilot.nifti-viewer",
      pluginName: "NIfTI Viewer",
      enabled: true,
    });
    expect(restartPromptForMcpMutation(mcpEntry, true, "remove")).toEqual({
      pluginId: "org.brainpilot.nifti-viewer",
      pluginName: "NIfTI Viewer",
      enabled: false,
    });
    expect(restartPromptForMcpMutation(mcpEntry, false, "reload")).toBeNull();
  });

  it("summarizes runtime-observed MCP health per plugin", () => {
    expect(mcpRuntimeSummaryForPlugin({ state: "degraded", servers: [
      { name: "browser", pluginId: "plugin-a", state: "ready" },
      { name: "memory", pluginId: "plugin-a", state: "failed", error: "connection closed" },
      { name: "global", state: "ready" },
    ] }, "plugin-a")).toEqual({ state: "degraded", errors: ["memory: connection closed"] });
    expect(mcpRuntimeSummaryForPlugin({ state: "ready", servers: [{ name: "global", state: "ready" }] }, "plugin-a")).toBeNull();
  });

  it("dismisses the runtime prompt with Escape only while idle", () => {
    expect(shouldDismissMcpRestartPrompt("Escape", false)).toBe(true);
    expect(shouldDismissMcpRestartPrompt("Esc", false)).toBe(true);
    expect(shouldDismissMcpRestartPrompt("Escape", true)).toBe(false);
    expect(shouldDismissMcpRestartPrompt("Enter", false)).toBe(false);
  });

  it("returns focus to a replacement plugin toggle after async rerender", () => {
    const connected = { isConnected: true, tabIndex: 0, dataset: {} } as unknown as HTMLElement;
    const pageRoot = { isConnected: true, tabIndex: -1, dataset: {} } as unknown as HTMLElement;
    const removed = { isConnected: false, tabIndex: 0, dataset: {} } as unknown as HTMLElement;
    const replacement = { isConnected: true, tabIndex: 0, dataset: { pluginToggleId: "plugin-a" } } as unknown as HTMLElement;
    expect(findMcpRestartReturnFocus(connected, "plugin-a", [replacement])).toBe(connected);
    expect(findMcpRestartReturnFocus(pageRoot, "plugin-a", [replacement])).toBe(replacement);
    expect(findMcpRestartReturnFocus(removed, "plugin-a", [replacement])).toBe(replacement);
    expect(findMcpRestartReturnFocus(removed, "plugin-b", [replacement])).toBeNull();
  });

  it("keeps the marketplace background inert while the runtime prompt is open", () => {
    const source = readFileSync(new URL("../components/plugins/PluginMarketplace.tsx", import.meta.url), "utf8");
    expect(source).toContain('surface.setAttribute("inert", "")');
    expect(source).toContain('surface.removeAttribute("inert")');
    expect(source).toContain("aria-hidden={restartPrompt ? true : undefined}");
    expect(source).toContain("trapFocusKeyDown(dialog, event)");
    expect(source).toContain("ref={restartDismissRef}");
    expect(source).toContain("data-plugin-toggle-id={entry.manifest.id}");
  });
});
