#!/usr/bin/env node
/** Regenerate @brainpilot/pi-sdk from the verified Pi 0.84.2 npm tarball. */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync,
  mkdirSync, statSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = join(repoRoot, "packages/pi-sdk");
const upstreamTarball = join(output, "vendor/upstream-0.84.2.tgz");
const upstreamSha512 = "97813e07b8605ca59d751a3c6c2fde4ae7b669666312027dc48a5fe69d0e83e96af1ad9302b0b02741c2a023c281a04ffed378cdb607ff03b0bf1f6926978b08";
const licenseSha256 = "0457f5bcec3b3b211605dfb5d1a49042fd638f3686a410fe099c24a25af13c48";
const version = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")).version;
const fixes = {
  undici: {
    old: "8.9.0", version: "8.10.2",
    resolved: "https://registry.npmjs.org/undici/-/undici-8.10.2.tgz",
    integrity: "sha512-/y4/bH9YNU5hi9NIrpOuvGXFcxrj3CMrV+/AYpowAYTpHn8gX/XPFjNy766FPoYY0miQhdW977JFWKGNhBdwyQ==",
  },
  "brace-expansion": {
    old: "5.0.9", version: "5.0.12",
    resolved: "https://registry.npmjs.org/brace-expansion/-/brace-expansion-5.0.12.tgz",
    integrity: "sha512-YovQ3rzhaLMIrDjNDMkNS01tea93qhEhG5xy8f6+R0l+dw3Ki+5sCoIoI942iuLZTHWogWktgwVDhU09iNEimQ==",
  },
};
const formatJson = (value) => Buffer.from(`${JSON.stringify(value, null, "\t")}\n`);
const hash = (algorithm, bytes) => createHash(algorithm).update(bytes).digest("hex");

function sourceFiles(dir, root = dir, found = new Map()) {
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    const absolute = join(dir, item.name);
    if (item.isDirectory()) sourceFiles(absolute, root, found);
    else if (item.isFile()) found.set(relative(root, absolute).split("\\").join("/"), {
      bytes: readFileSync(absolute), mode: statSync(absolute).mode & 0o777,
    });
    else throw new Error(`Unexpected upstream Pi entry: ${absolute}`);
  }
  return found;
}

function build() {
  const archive = readFileSync(upstreamTarball);
  if (hash("sha512", archive) !== upstreamSha512) throw new Error("Official Pi 0.84.2 npm integrity mismatch");
  const temporary = mkdtempSync(join(tmpdir(), "brainpilot-pi-source-"));
  try {
    execFileSync("tar", ["-xzf", upstreamTarball, "-C", temporary], { stdio: "pipe" });
    const files = sourceFiles(join(temporary, "package"));
    const manifest = JSON.parse(files.get("package.json").bytes);
    const shrinkwrap = JSON.parse(files.get("npm-shrinkwrap.json").bytes);
    if (manifest.name !== "@earendil-works/pi-coding-agent" || manifest.version !== "0.84.2" || shrinkwrap.version !== "0.84.2") {
      throw new Error("Unexpected upstream Pi package identity");
    }
    for (const [name, fixed] of Object.entries(fixes)) {
      const node = shrinkwrap.packages[`node_modules/${name}`];
      if (node.version !== fixed.old) throw new Error(`Unexpected upstream ${name} version: ${node.version}`);
      node.version = fixed.version;
      node.resolved = fixed.resolved;
      node.integrity = fixed.integrity;
      if (name === "undici") {
        if (manifest.dependencies.undici !== fixed.old) throw new Error("Unexpected upstream undici dependency");
        manifest.dependencies.undici = fixed.version;
        shrinkwrap.packages[""].dependencies.undici = fixed.version;
      }
    }
    manifest.name = "@brainpilot/pi-sdk";
    manifest.version = version;
    manifest.description = "BrainPilot's pinned Pi 0.84.2 SDK with audited dependency backports";
    // npm workspaces can ignore a dependency's shrinkwrap and otherwise float
    // Pi siblings to 0.84.4 while published consumers use shrinkwrapped 0.84.2.
    for (const name of ["pi-agent-core", "pi-ai", "pi-client", "pi-protocol", "pi-tui"]) {
      const dependency = `@earendil-works/${name}`;
      if (manifest.dependencies[dependency] !== "^0.84.2") throw new Error(`Unexpected upstream range for ${dependency}`);
      manifest.dependencies[dependency] = "0.84.2";
    }
    manifest.dependencies["@earendil-works/pi-telemetry"] = "0.84.2";
    manifest.scripts = {
      build: "node ../../scripts/build-pi-sdk.mjs --check",
      prepack: "node ../../scripts/build-pi-sdk.mjs --check",
    };
    delete manifest.devDependencies;
    manifest.repository = {
      type: "git", url: "git+https://github.com/NeuroAIHub/BrainPilot.git", directory: "packages/pi-sdk",
    };
    manifest.publishConfig = { access: "public" };
    manifest.files = [...manifest.files, "LICENSE", "UPSTREAM.md"];
    shrinkwrap.name = "@brainpilot/pi-sdk";
    shrinkwrap.version = version;
    shrinkwrap.packages[""].name = "@brainpilot/pi-sdk";
    shrinkwrap.packages[""].version = version;
    shrinkwrap.packages[""].dependencies = manifest.dependencies;
    const license = readFileSync(join(output, "LICENSE"));
    if (hash("sha256", license) !== licenseSha256) throw new Error("Upstream Pi MIT license differs from pinned source commit");
    files.set("package.json", { bytes: formatJson(manifest), mode: 0o644 });
    files.set("npm-shrinkwrap.json", { bytes: formatJson(shrinkwrap), mode: 0o644 });
    files.set("LICENSE", { bytes: license, mode: 0o644 });
    return files;
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

const files = build();
for (const managedRoot of ["dist", "docs", "examples"]) {
  const dir = join(output, managedRoot);
  if (!existsSync(dir)) continue;
  for (const name of sourceFiles(dir).keys()) {
    if (!files.has(`${managedRoot}/${name}`)) throw new Error(`Unexpected generated Pi file: ${managedRoot}/${name}`);
  }
}
const check = process.argv.includes("--check");
const protectedFiles = new Set(["package.json", "npm-shrinkwrap.json", "LICENSE"]);
let changed = 0;
for (const [name, { bytes, mode }] of files) {
  const target = join(output, name);
  if (existsSync(target) && readFileSync(target).equals(bytes)) continue;
  changed++;
  if (protectedFiles.has(name)) throw new Error(`Tracked Pi metadata differs from verified backport: ${name}`);
  if (!check) {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, bytes);
    chmodSync(target, mode);
  }
}
if (check && changed) throw new Error(`Pi workspace differs from verified backport: ${changed} generated files`);
console.log(`${output}: ${files.size} generated files, ${changed} changed`);
