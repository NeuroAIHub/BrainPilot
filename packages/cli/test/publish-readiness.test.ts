import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function readPkg(relativeFromTestFile: string): Record<string, any> {
  const url = new URL(relativeFromTestFile, import.meta.url);
  return JSON.parse(readFileSync(url, "utf8"));
}

const PUBLIC = ["protocol", "runtime", "backend-core", "web", "cli"] as const;

const PKG_PATH: Record<(typeof PUBLIC)[number], string> = {
  protocol: "../../protocol/package.json",
  runtime: "../../runtime/package.json",
  "backend-core": "../../backend-core/package.json",
  web: "../../web/package.json",
  cli: "../package.json",
};

describe.each(PUBLIC)("public package %s is publish-ready", (shortName) => {
  const pkg = readPkg(PKG_PATH[shortName]);

  it("is not private", () => {
    expect(pkg.private === undefined || pkg.private === false).toBe(true);
  });

  it("publishes the dist directory via files", () => {
    expect(Array.isArray(pkg.files)).toBe(true);
    expect(pkg.files).toContain("dist");
  });

  it("is licensed Apache-2.0", () => {
    expect(pkg.license).toBe("Apache-2.0");
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
});
