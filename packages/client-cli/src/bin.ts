#!/usr/bin/env node
/**
 * bin.ts — the `bp-client` executable. A headless verification client that
 * drives a BrainPilot session over HTTP+SSE (no web UI), printing AG-UI events
 * until RUN_FINISHED / command_complete (TS_PI_REFACTOR_DESIGN §15.4).
 */
import { Command } from "commander";
import { run, DEFAULT_BASE_URL } from "./index.js";

const program = new Command();

program
  .name("bp-client")
  .description("BrainPilot headless verification client (dev/CI)")
  .version("0.1.0")
  .argument("<message>", "message to send to the session")
  .option(
    "-u, --base-url <url>",
    `base URL (backend default ${DEFAULT_BASE_URL}, runtime e.g. http://localhost:8081)`,
    DEFAULT_BASE_URL,
  )
  .option("-s, --session <id>", "reuse an existing session id")
  .option("-a, --agent <name>", "target agent (default principal)")
  .option(
    "-n, --max-events <n>",
    "stop after N events (safety bound)",
    (v) => parseInt(v, 10),
  )
  .option("--mock", "print events but do not require a live server", false)
  .action(async (message: string, opts) => {
    try {
      const result = await run({
        baseUrl: opts.baseUrl,
        message,
        agent: opts.agent,
        sessionId: opts.session,
        maxEvents: opts.maxEvents,
        mock: opts.mock,
      });
      // Exit 0 on a clean terminal/command_complete; 2 if the stream just ended.
      process.exitCode =
        result.reason === "terminal" || result.reason === "command_complete"
          ? 0
          : 2;
    } catch (err) {
      console.error((err as Error).message);
      process.exitCode = 1;
    }
  });

program.parseAsync(process.argv).catch((err) => {
  console.error((err as Error).message);
  process.exitCode = 1;
});
