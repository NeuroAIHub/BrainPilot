import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { MarketplaceEntry, MarketplaceRelease, PluginManifest } from "@brainpilot/plugin-sdk";
import { createApp } from "../src/app.js";
import {
  installPlugin,
  listInstalledPlugins,
  loadMarketplaceSources,
  rollbackPlugin,
  setPluginEnabled,
  uninstallPlugin,
  updatePlugin,
} from "../src/plugins.js";
import type { Orchestrator, RuntimeHandle } from "../src/orchestrator.js";

function orchestrator(): Orchestrator {
  return {
    ensureRuntime: async (): Promise<RuntimeHandle> => ({ baseUrl: "http://runtime.test" }),
    health: async () => true,
    stopRuntime: async () => {},
  };
}

function manifest(id: string, version: string, dependencies?: PluginManifest["dependencies"]): PluginManifest {
  return {
    id,
    version,
    apiVersion: "1",
    displayName: id,
    description: `Fixture ${id}@${version}`,
    categories: ["other"],
    engines: { brainpilot: ">=0.1.2 <0.2.0" },
    ...(dependencies ? { dependencies } : {}),
    contributes: { panels: [{ id: "main", title: "Fixture", entry: "ui/index.html" }] },
  };
}

function bundle(value: PluginManifest, body: string): Buffer {
  return Buffer.from(JSON.stringify({
    manifest: value,
    files: [{ path: "ui/index.html", contentBase64: Buffer.from(body).toString("base64") }],
  }));
}

function artifact(bytes: Buffer, url: string): { url: string; sha256: string } {
  return { url, sha256: createHash("sha256").update(bytes).digest("hex") };
}

async function writeLocalCatalogue(dataDir: string, entries: MarketplaceEntry[], bundles: Record<string, Buffer>): Promise<void> {
  const root = path.join(dataDir, "plugins");
  await mkdir(root, { recursive: true });
  for (const [name, bytes] of Object.entries(bundles)) await writeFile(path.join(root, name), bytes);
  await writeFile(path.join(root, "marketplace.json"), JSON.stringify({ plugins: entries }));
}

describe("plugin marketplace control plane", () => {
  it("loads a decoupled HTTPS catalogue source", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "bp-market-source-"));
    await mkdir(path.join(dataDir, "plugins"), { recursive: true });
    await writeFile(path.join(dataDir, "plugins", "marketplace-sources.json"), JSON.stringify({
      sources: [{ id: "community", type: "https", url: "https://plugins.example.test/index.json" }],
    }));
    const remote = manifest("org.example.remote", "1.0.0");
    const fakeFetch = async () => Response.json({
      plugins: [{ manifest: remote, publisher: "Example", artifact: { url: "./remote.bundle.json", sha256: "a".repeat(64) } }],
    });
    const loaded = await loadMarketplaceSources(dataDir, fakeFetch as typeof fetch);
    expect(loaded.entries[0]).toEqual(expect.objectContaining({
      source: { id: "community", type: "https" },
      artifact: expect.objectContaining({ url: "https://plugins.example.test/remote.bundle.json" }),
    }));
    expect(loaded.sources).toContainEqual(expect.objectContaining({ id: "community", status: "ready", pluginCount: 1 }));
  });

  it("installs, enables, lists, and uninstalls through the HTTP API", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "bp-plugin-http-"));
    const value = manifest("org.example.lifecycle", "1.0.0");
    const bytes = bundle(value, "lifecycle");
    await writeLocalCatalogue(dataDir, [{
      manifest: value,
      publisher: "Example",
      verified: true,
      artifact: artifact(bytes, "lifecycle.bundle.json"),
    }], { "lifecycle.bundle.json": bytes });
    const app = createApp({ orchestrator: orchestrator(), dataDir, serveWeb: false });

    expect((await app.request("/api/plugins/marketplace")).status).toBe(200);
    const installed = await app.request("/api/plugins/install", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: value.id }),
    });
    expect(installed.status).toBe(201);
    expect(await installed.json()).toEqual(expect.objectContaining({ enabled: false, verified: true }));

    const enabled = await app.request(`/api/plugins/${value.id}/enabled`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: true }),
    });
    expect(enabled.status).toBe(200);
    expect(await enabled.json()).toEqual(expect.objectContaining({ enabled: true }));
    expect(await readFile(path.join(dataDir, "plugins", "installed", value.id, value.version, "ui", "index.html"), "utf8")).toBe("lifecycle");

    expect((await app.request(`/api/plugins/${value.id}`, { method: "DELETE" })).status).toBe(204);
    expect(await (await app.request("/api/plugins/installed")).json()).toEqual([]);
  });

  it("updates and rolls back genuinely distinct immutable bundles", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "bp-plugin-update-"));
    const id = "org.example.versioned";
    const v1 = manifest(id, "1.0.0");
    const v2 = manifest(id, "1.1.0");
    const b1 = bundle(v1, "actual-v1");
    const b2 = bundle(v2, "actual-v2");
    const releases: MarketplaceRelease[] = [
      { version: v2.version, manifest: v2, artifact: artifact(b2, "v2.bundle.json"), publishedAt: "2026-08-02T00:00:00.000Z", releaseNotes: "v2" },
      { version: v1.version, manifest: v1, artifact: artifact(b1, "v1.bundle.json"), publishedAt: "2026-08-01T00:00:00.000Z", releaseNotes: "v1" },
    ];
    await writeLocalCatalogue(dataDir, [{ manifest: v2, publisher: "Example", artifact: releases[0]!.artifact, releases }], {
      "v1.bundle.json": b1,
      "v2.bundle.json": b2,
    });

    expect((await installPlugin(dataDir, id, "1.0.0"))?.activeVersion).toBe("1.0.0");
    await setPluginEnabled(dataDir, id, true);
    expect((await updatePlugin(dataDir, id))?.activeVersion).toBe("1.1.0");
    expect(await readFile(path.join(dataDir, "plugins", "installed", id, "1.1.0", "ui", "index.html"), "utf8")).toBe("actual-v2");
    expect((await rollbackPlugin(dataDir, id))?.activeVersion).toBe("1.0.0");
    expect(await readFile(path.join(dataDir, "plugins", "installed", id, "1.0.0", "ui", "index.html"), "utf8")).toBe("actual-v1");
  });

  it("serializes concurrent registry mutations without losing installations", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "bp-plugin-concurrent-"));
    const one = manifest("org.example.one", "1.0.0");
    const two = manifest("org.example.two", "1.0.0");
    const oneBytes = bundle(one, "one");
    const twoBytes = bundle(two, "two");
    await writeLocalCatalogue(dataDir, [
      { manifest: one, publisher: "Example", artifact: artifact(oneBytes, "one.bundle.json") },
      { manifest: two, publisher: "Example", artifact: artifact(twoBytes, "two.bundle.json") },
    ], { "one.bundle.json": oneBytes, "two.bundle.json": twoBytes });

    await Promise.all([installPlugin(dataDir, one.id), installPlugin(dataDir, two.id)]);
    expect((await listInstalledPlugins(dataDir)).map((item) => item.manifest.id).sort()).toEqual([one.id, two.id]);
  });

  it("prevents disabling a required dependency of an enabled plugin", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "bp-plugin-dependency-"));
    const base = manifest("org.example.base", "1.0.0");
    const dependent = manifest("org.example.dependent", "1.0.0", [{ id: base.id, version: "^1.0.0" }]);
    const baseBytes = bundle(base, "base");
    const dependentBytes = bundle(dependent, "dependent");
    await writeLocalCatalogue(dataDir, [
      { manifest: base, publisher: "Example", artifact: artifact(baseBytes, "base.bundle.json") },
      { manifest: dependent, publisher: "Example", artifact: artifact(dependentBytes, "dependent.bundle.json") },
    ], { "base.bundle.json": baseBytes, "dependent.bundle.json": dependentBytes });

    await installPlugin(dataDir, base.id);
    await setPluginEnabled(dataDir, base.id, true);
    await installPlugin(dataDir, dependent.id);
    await setPluginEnabled(dataDir, dependent.id, true);
    await expect(setPluginEnabled(dataDir, base.id, false)).rejects.toThrow(/dependency.*disabled/i);
    expect((await listInstalledPlugins(dataDir)).find((item) => item.manifest.id === base.id)?.enabled).toBe(true);
    await expect(uninstallPlugin(dataDir, base.id)).rejects.toThrow(/not installed/i);
  });

  it("keeps incompatible persisted plugins installed but refuses activation", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "bp-plugin-incompatible-"));
    const future = { ...manifest("org.example.future", "1.0.0"), engines: { brainpilot: ">=9.0.0" } };
    await mkdir(path.join(dataDir, "plugins"), { recursive: true });
    await writeFile(path.join(dataDir, "plugins", "registry.json"), JSON.stringify({
      plugins: {
        [future.id]: {
          manifest: future,
          publisher: "Example",
          verified: false,
          enabled: false,
          installedAt: new Date().toISOString(),
          activeVersion: future.version,
        },
      },
    }));
    const app = createApp({ orchestrator: orchestrator(), dataDir, serveWeb: false });
    const installed = await (await app.request("/api/plugins/installed")).json() as Array<{ compatibility: { compatible: boolean } }>;
    expect(installed[0]?.compatibility.compatible).toBe(false);
    expect((await app.request(`/api/plugins/${future.id}/enabled`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: true }),
    })).status).toBe(400);
    const preflightResponse = await app.request("/api/plugins/compatibility?brainpilotVersion=9.1.0");
    expect(preflightResponse.status).toBe(200);
    const preflight = await preflightResponse.json() as Array<{ compatibility: { compatible: boolean } }>;
    expect(preflight[0]?.compatibility.compatible).toBe(true);
  });
});
