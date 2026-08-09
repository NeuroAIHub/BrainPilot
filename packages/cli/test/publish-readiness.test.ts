import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function readPkg(relativeFromTestFile: string): Record<string, any> {
  const url = new URL(relativeFromTestFile, import.meta.url);
  return JSON.parse(readFileSync(url, "utf8"));
}

const PUBLIC = ["protocol", "skills", "runtime", "backend-core", "web", "cli"] as const;

const PKG_PATH: Record<(typeof PUBLIC)[number], string> = {
  protocol: "../../protocol/package.json",
  skills: "../../skills/package.json",
  runtime: "../../runtime/package.json",
  "backend-core": "../../backend-core/package.json",
  web: "../../web/package.json",
  cli: "../package.json",
};

// License + version are standardized across the monorepo. The root package.json
// is the single source of truth (versions kept in lockstep by
// scripts/sync-versions.js; license must match the repo-root LICENSE file).
const ROOT = readPkg("../../../package.json");
const EXPECTED_LICENSE = "AGPL-3.0-only";

describe.each(PUBLIC)("public package %s is publish-ready", (shortName) => {
  const pkg = readPkg(PKG_PATH[shortName]);

  it("is not private", () => {
    expect(pkg.private === undefined || pkg.private === false).toBe(true);
  });

  it("publishes the dist directory via files", () => {
    expect(Array.isArray(pkg.files)).toBe(true);
    expect(pkg.files).toContain("dist");
  });

  // License is standardized to AGPL-3.0-only (matches the repo-root LICENSE
  // and the root package.json). Every published package must agree — a drift
  // back to Apache-2.0 (or anything else) fails CI here.
  it(`is licensed ${EXPECTED_LICENSE}`, () => {
    expect(pkg.license).toBe(EXPECTED_LICENSE);
  });

  // Versions are kept in lockstep with the root by scripts/sync-versions.js.
  it("version matches the root package.json (single source of truth)", () => {
    expect(pkg.version).toBe(ROOT.version);
  });

  it("has public publishConfig access", () => {
    expect(pkg.publishConfig?.access).toBe("public");
  });

  it("declares repository.directory matching its package path", () => {
    expect(pkg.repository?.directory).toBe(`packages/${shortName}`);
  });

  // #56: every published package must declare the documented Node engine range
  // so installs on Node < 22 get an early npm warning.
  it("declares engines.node >=22 (#56)", () => {
    expect(pkg.engines?.node).toBe(">=22");
  });

  it("pins internal @brainpilot/* dependencies (not '*')", () => {
    const deps: Record<string, string> = pkg.dependencies ?? {};
    for (const [name, range] of Object.entries(deps)) {
      if (name.startsWith("@brainpilot/")) {
        expect(range, `${name} in ${shortName}`).not.toBe("*");
        expect(range, `${name} in ${shortName}`).toMatch(/^\^/);
      }
    }
  });
});

describe("targeted publish guards", () => {
  it("client-cli stays private (not published)", () => {
    const pkg = readPkg("../../client-cli/package.json");
    expect(pkg.private).toBe(true);
  });

  // #52: the @brainpilot/app package must ship a README (npm page + tarball).
  it("cli ships a README in files and on disk (#52)", () => {
    const pkg = readPkg("../package.json");
    expect(pkg.files).toContain("README.md");
    const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
    expect(readme).toMatch(/@brainpilot\/app/);
    expect(readme.length).toBeGreaterThan(200);
  });

  it("web declares no exports (so SPA dist is located via require.resolve)", () => {
    const pkg = readPkg("../../web/package.json");
    expect(pkg.exports).toBeUndefined();
  });

  // #139/#140: the built-in skills must ship and be resolvable in npm + Docker.
  it("skills package ships the skills/ content dir via files", () => {
    const pkg = readPkg("../../skills/package.json");
    expect(pkg.files).toContain("skills");
  });

  it("skills package is no longer an MCP server (no mcp dep / bin)", () => {
    const pkg = readPkg("../../skills/package.json");
    expect(pkg.name).toBe("@brainpilot/skills");
    expect(pkg.bin).toBeUndefined();
    expect(Object.keys(pkg.dependencies ?? {})).not.toContain("@modelcontextprotocol/sdk");
  });

  it("runtime depends on @brainpilot/skills (so it installs + builds in Docker)", () => {
    const pkg = readPkg("../../runtime/package.json");
    expect(pkg.dependencies?.["@brainpilot/skills"]).toMatch(/^\^/);
  });

  it("runtime references @brainpilot/skills as a TS project (Docker tsc -b builds it)", () => {
    const tsconfig = readPkg("../../runtime/tsconfig.json");
    const refs: Array<{ path: string }> = tsconfig.references ?? [];
    expect(refs.some((r) => r.path === "../skills")).toBe(true);
  });

  it("ships the Auditor system plugin as a pinned Runtime dependency", () => {
    const runtime = readPkg("../../runtime/package.json");
    const plugin = readPkg("../../plugin-auditor/package.json");
    const manifest = readPkg("../../plugin-auditor/manifest.json");
    expect(runtime.dependencies?.["@brainpilot/plugin-auditor"]).toMatch(/^\^/);
    expect(plugin.files).toEqual(expect.arrayContaining(["manifest.json", "prompts", "skills"]));
    expect(plugin.version).toBe(ROOT.version);
    expect(manifest.version).toBe(plugin.version);
    expect(manifest.id).toBe("org.brainpilot.auditor");
  });

  it("ships the GoT system plugin as a pinned Runtime dependency", () => {
    const runtime = readPkg("../../runtime/package.json");
    const plugin = readPkg("../../plugin-got/package.json");
    const manifest = readPkg("../../plugin-got/manifest.json");
    expect(runtime.dependencies?.["@brainpilot/plugin-got"]).toMatch(/^\^/);
    expect(plugin.files).toEqual(expect.arrayContaining(["manifest.json", "skills"]));
    expect(plugin.version).toBe(ROOT.version);
    expect(manifest.version).toBe(plugin.version);
    expect(manifest.id).toBe("org.brainpilot.got");
  });

  it("ships the Research system plugin as a pinned Runtime dependency", () => {
    const runtime = readPkg("../../runtime/package.json");
    const plugin = readPkg("../../plugin-research/package.json");
    const manifest = readPkg("../../plugin-research/manifest.json");
    expect(runtime.dependencies?.["@brainpilot/plugin-research"]).toMatch(/^\^/);
    expect(plugin.files).toEqual(expect.arrayContaining(["manifest.json", "skills"]));
    expect(plugin.version).toBe(ROOT.version);
    expect(manifest.version).toBe(plugin.version);
    expect(manifest.id).toBe("org.brainpilot.research");
  });
});

describe("license is consistent across the repo", () => {
  it(`root package.json is ${EXPECTED_LICENSE}`, () => {
    expect(ROOT.license).toBe(EXPECTED_LICENSE);
  });

  // The declared SPDX license must match the actual LICENSE file text, so the
  // metadata can never silently diverge from the legal terms we ship.
  it("the LICENSE file is the AGPL-3.0 text", () => {
    const license = readFileSync(new URL("../../../LICENSE", import.meta.url), "utf8");
    expect(license).toMatch(/GNU AFFERO GENERAL PUBLIC LICENSE/);
    expect(license).toMatch(/Version 3/);
  });
});

describe("root scripts", () => {
  const pkg = readPkg("../../../package.json");

  it("defines a bp script", () => {
    expect(typeof pkg.scripts?.bp).toBe("string");
  });

  it("defines a release script", () => {
    expect(pkg.scripts?.release).toBeDefined();
  });

  it("defines a release:dry script", () => {
    expect(pkg.scripts?.["release:dry"]).toBeDefined();
  });

  it("does not publish client-cli in release", () => {
    expect(pkg.scripts?.release).not.toContain("client-cli");
  });

  // #139: skills package must be published, else runtime's dependency on it
  // (and require.resolve at materialize time) breaks for npm installs.
  it("publishes @brainpilot/skills in release", () => {
    expect(pkg.scripts?.release).toContain("@brainpilot/skills");
  });

  it("publishes @brainpilot/plugin-auditor in release", () => {
    expect(pkg.scripts?.release).toContain("@brainpilot/plugin-auditor");
  });

  it("publishes @brainpilot/plugin-got in release", () => {
    expect(pkg.scripts?.release).toContain("@brainpilot/plugin-got");
  });

  it("publishes @brainpilot/plugin-research in release", () => {
    expect(pkg.scripts?.release).toContain("@brainpilot/plugin-research");
  });
});
