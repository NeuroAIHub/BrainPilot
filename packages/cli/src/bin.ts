#!/usr/bin/env node
/**
 * bin.ts — the `brainpilot` / `bnpt` executable entry. Thin: delegates to the
 * commander program and maps thrown errors to a non-zero exit (§11A.4).
 */
import { run } from "./program.js";
import { assertRepoCwd } from "./repo-mode.js";

assertRepoCwd({ argv: process.argv.slice(2) });

run(process.argv.slice(2)).catch(() => {
  process.exitCode = 1;
});
