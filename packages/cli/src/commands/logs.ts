/**
 * commands/logs.ts — tail the backend/runtime logs under `.runtime/logs/`
 * (TS_PI_REFACTOR_DESIGN §11A.4 / §11A.5).
 */
import { readFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { watch } from "node:fs";
import pc from "picocolors";
import { resolveDataDir, dataPaths } from "../paths.js";

export interface LogsOptions {
  dir?: string;
  /** Which log to read. Default `backend`. */
  which?: "backend" | "runtime";
  /** Number of trailing lines to print. Default 200. */
  lines?: number;
  /** Follow (`tail -f`). Default false. */
  follow?: boolean;
}

export interface LogsDeps {
  env?: Record<string, string | undefined>;
  cwd?: string;
  log?: (msg: string) => void;
}

/** Read the last `n` lines of a file; returns "" if the file is missing. */
export async function tailFile(path: string, n: number): Promise<string> {
  let content: string;
  try {
    content = await readFile(path, "utf8");
  } catch {
    return "";
  }
  const lines = content.split(/\r?\n/);
  // Drop a trailing empty element from a final newline.
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines.slice(-n).join("\n");
}

export async function logs(
  options: LogsOptions = {},
  deps: LogsDeps = {},
): Promise<string> {
  const log = deps.log ?? ((m: string) => console.log(m));
  const dataDir = resolveDataDir({ dir: options.dir, env: deps.env, cwd: deps.cwd });
  const p = dataPaths(dataDir);
  const which = options.which ?? "backend";
  const file = which === "runtime" ? p.runtimeLog : p.backendLog;
  const lines = options.lines ?? 200;

  const tail = await tailFile(file, lines);
  if (tail === "") {
    log(pc.yellow(`No ${which} log at ${file}.`));
  } else {
    log(tail);
  }

  if (options.follow) {
    await followFile(file, log);
  }
  return tail;
}

/** Follow a file, emitting appended bytes. Runs until the process exits. */
async function followFile(
  file: string,
  emit: (msg: string) => void,
): Promise<void> {
  let pos = (await safeSize(file)) ?? 0;
  await new Promise<void>(() => {
    const watcher = watch(file, { persistent: true }, async () => {
      const size = (await safeSize(file)) ?? pos;
      if (size < pos) pos = 0; // truncated/rotated
      if (size > pos) {
        const stream = createReadStream(file, { start: pos, end: size - 1, encoding: "utf8" });
        let chunk = "";
        for await (const part of stream) chunk += part;
        if (chunk) emit(chunk.replace(/\n$/, ""));
        pos = size;
      }
    });
    // never resolves — Ctrl-C ends the process; ensure cleanup on signals.
    process.once("SIGINT", () => {
      watcher.close();
      process.exit(0);
    });
  });
}

async function safeSize(file: string): Promise<number | null> {
  try {
    const { stat } = await import("node:fs/promises");
    return (await stat(file)).size;
  } catch {
    return null;
  }
}
