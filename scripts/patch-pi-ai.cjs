#!/usr/bin/env node
"use strict";
/*
 * Post-install patch for @earendil-works/pi-ai's Responses converter.
 *
 * Azure OpenAI Responses (api "azure-openai-responses") runs store:false, so the
 * server persists nothing between turns. The shared converter replays a captured
 * reasoning item verbatim; when that item carries only its server-side `rs_` id
 * (no encrypted_content) the next request 400s:
 *
 *   Item with id 'rs_...' not found. Items are not persisted when store is set to
 *   false. Try again with store set to true, or remove this item from your input.
 *
 * Fix (azure only): drop reasoning items that have no encrypted_content, and strip
 * the server-side `rs_`/`fc_` ids from the items we do replay — encrypted_content is
 * the stateless carrier. Non-azure Responses providers (openai / openai-codex /
 * opencode) are left exactly as-is.
 *
 * Why a hand-rolled patcher instead of patch-package: pi-coding-agent ships an
 * npm-shrinkwrap that nests pi-ai, and npm installs that whole tree under a
 * workspace's node_modules. The package is therefore NOT at the repo-root
 * node_modules path patch-package resolves, and patch-package refuses to run from
 * a workspace dir (no lockfile there). This script locates the file wherever npm
 * put it, is idempotent, and throws on pattern drift so an SDK bump fails loudly.
 */

const fs = require("node:fs");
const path = require("node:path");

const MARKER = "bp-azure-stateless-reasoning";
const REPO_ROOT = path.resolve(__dirname, "..");

/** Roots under which a node_modules tree may live: repo root + each workspace. */
function searchRoots() {
	const roots = [REPO_ROOT];
	const pkgsDir = path.join(REPO_ROOT, "packages");
	if (fs.existsSync(pkgsDir)) {
		for (const name of fs.readdirSync(pkgsDir)) {
			roots.push(path.join(pkgsDir, name));
		}
	}
	return roots;
}

/** Every plausible install layout for pi-ai's converter, hoisted or nested. */
function converterCandidates() {
	const mids = ["", path.join("@earendil-works", "pi-coding-agent", "node_modules")];
	const subs = ["api", "providers"]; // 0.80.x moved providers/ -> api/
	const found = new Set();
	for (const root of searchRoots()) {
		for (const mid of mids) {
			for (const sub of subs) {
				const file = path.join(
					root,
					"node_modules",
					mid,
					"@earendil-works",
					"pi-ai",
					"dist",
					sub,
					"openai-responses-shared.js",
				);
				if (fs.existsSync(file)) found.add(file);
			}
		}
	}
	return [...found];
}

function piCodingAgentInstalled() {
	return searchRoots().some((root) =>
		fs.existsSync(path.join(root, "node_modules", "@earendil-works", "pi-coding-agent")),
	);
}

function patchFile(file) {
	const original = fs.readFileSync(file, "utf8");
	if (original.includes(MARKER)) return "already-patched";

	// 1) Reasoning replay: make azure store:false safe.
	const replay = /const reasoningItem = JSON\.parse\(block\.thinkingSignature\);\s*\n\s*output\.push\(reasoningItem\);/;
	if (!replay.test(original)) {
		throw new Error(`[patch-pi-ai] reasoning-replay pattern not found in ${file} (pi-ai changed?)`);
	}
	let out = original.replace(
		replay,
		[
			`const reasoningItem = JSON.parse(block.thinkingSignature); /* ${MARKER} */`,
			`                        if (model.api !== "azure-openai-responses") {`,
			`                            output.push(reasoningItem);`,
			`                        }`,
			`                        else if (reasoningItem.encrypted_content) {`,
			`                            delete reasoningItem.id;`,
			`                            output.push(reasoningItem);`,
			`                        }`,
		].join("\n"),
	);

	// 2) Tool-call item id: omit the fc_ server id for azure too (store:false).
	const fcNeedle = 'if (isDifferentModel && itemId?.startsWith("fc_")) {';
	const fcRepl =
		'if ((isDifferentModel || model.api === "azure-openai-responses") && itemId?.startsWith("fc_")) {';
	if (!out.includes(fcNeedle)) {
		throw new Error(`[patch-pi-ai] tool-call-id pattern not found in ${file} (pi-ai changed?)`);
	}
	out = out.replace(fcNeedle, fcRepl);

	if (out === original || !out.includes(MARKER)) {
		throw new Error(`[patch-pi-ai] patch produced no change in ${file}`);
	}
	fs.writeFileSync(file, out);
	return "patched";
}

function main() {
	const files = converterCandidates();
	if (files.length === 0) {
		if (piCodingAgentInstalled()) {
			throw new Error(
				"[patch-pi-ai] @earendil-works/pi-coding-agent is installed but its pi-ai converter " +
					"was not found in any known layout; the Azure store:false fix did NOT apply. " +
					"Update scripts/patch-pi-ai.cjs for the new layout.",
			);
		}
		console.log("[patch-pi-ai] pi-ai not installed; nothing to patch.");
		return;
	}
	for (const file of files) {
		const status = patchFile(file);
		console.log(`[patch-pi-ai] ${status}: ${path.relative(REPO_ROOT, file)}`);
	}
}

main();
