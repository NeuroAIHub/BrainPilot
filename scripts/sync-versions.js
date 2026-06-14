#!/usr/bin/env node
/**
 * sync-versions.js — keep every workspace package on a single version.
 *
 * The root package.json `version` is the SINGLE SOURCE OF TRUTH. This script
 * rewrites each workspace package so that:
 *   1. its own `version` equals the root version, and
 *   2. every `@brainpilot/*` entry in its dependencies / devDependencies /
 *      peerDependencies uses the range `^<rootVersion>`.
 *
 * A `"*"` range (used by private, never-published packages like client-cli) is
 * left untouched — it resolves through the workspace and must not be pinned.
 *
 * Usage:
 *   node scripts/sync-versions.js          # rewrite files to match root version
 *   node scripts/sync-versions.js --check  # verify only; exit 1 if out of sync
 *
 * Release flow: bump the root package.json `version` (the only manual edit),
 * then `npm run release` runs this script first so nothing can drift.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEP_FIELDS = ["dependencies", "devDependencies", "peerDependencies"];
const SCOPE = "@brainpilot/";

const check = process.argv.includes("--check");

/** Read + parse a package.json, returning { path, json, raw }. */
function readPkg(path) {
  const raw = readFileSync(path, "utf8");
  return { path, json: JSON.parse(raw), raw };
}

const rootPkg = readPkg(join(repoRoot, "package.json"));
const version = rootPkg.json.version;
if (!version) {
  console.error("[sync-versions] root package.json has no version field.");
  process.exit(2);
}

const workspaces = rootPkg.json.workspaces ?? [];
const pkgPaths = workspaces.map((w) => join(repoRoot, w, "package.json"));

const drift = []; // human-readable list of mismatches (for --check)

for (const pkgPath of pkgPaths) {
  let pkg;
  try {
    pkg = readPkg(pkgPath);
  } catch {
    console.error(`[sync-versions] cannot read ${pkgPath}; skipping.`);
    continue;
  }
  const { json } = pkg;
  let changed = false;

  // 1. own version
  if (json.version !== version) {
    drift.push(`${json.name}: version ${json.version} -> ${version}`);
    json.version = version;
    changed = true;
  }

  // 2. internal @brainpilot/* dependency ranges
  for (const field of DEP_FIELDS) {
    const deps = json[field];
    if (!deps) continue;
    for (const name of Object.keys(deps)) {
      if (!name.startsWith(SCOPE)) continue;
      const range = deps[name];
      if (range === "*") continue; // workspace wildcard — leave as-is
      const want = `^${version}`;
      if (range !== want) {
        drift.push(`${json.name}: ${field}.${name} ${range} -> ${want}`);
        deps[name] = want;
        changed = true;
      }
    }
  }

  if (changed && !check) {
    writeFileSync(pkgPath, JSON.stringify(json, null, 2) + "\n", "utf8");
  }
}

if (check) {
  if (drift.length > 0) {
    console.error(
      `[sync-versions] OUT OF SYNC with root version ${version}:\n  ` +
        drift.join("\n  ") +
        "\n\nRun `node scripts/sync-versions.js` to fix.",
    );
    process.exit(1);
  }
  console.log(`[sync-versions] all packages aligned at ${version}.`);
} else if (drift.length > 0) {
  console.log(
    `[sync-versions] synced ${drift.length} field(s) to ${version}:\n  ` +
      drift.join("\n  "),
  );
} else {
  console.log(`[sync-versions] already aligned at ${version}; nothing to do.`);
}
