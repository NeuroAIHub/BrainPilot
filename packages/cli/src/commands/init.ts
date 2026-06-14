/**
 * commands/init.ts — scaffold the launch dir + optionally persist a provider
 * key, without starting anything (TS_PI_REFACTOR_DESIGN §11A.4).
 */
import pc from "picocolors";
import { writeLocalSettings } from "@brainpilot/backend-core";
import { resolveDataDir } from "../paths.js";
import { scaffold } from "../scaffold.js";

export interface InitOptions {
  dir?: string;
  port?: number;
  /** Optional API key to persist into bp_template/settings.json. */
  apiKey?: string;
  /** Optional model id to persist. */
  model?: string;
}

export interface InitDeps {
  env?: Record<string, string | undefined>;
  cwd?: string;
  log?: (msg: string) => void;
  /** Injectable settings writer (defaults to backend-core writeLocalSettings). */
  writeSettings?: typeof writeLocalSettings;
}

export interface InitResult {
  dataDir: string;
  created: string[];
  keyPersisted: boolean;
}

export async function init(
  options: InitOptions = {},
  deps: InitDeps = {},
): Promise<InitResult> {
  const log = deps.log ?? ((m: string) => console.log(m));
  const dataDir = resolveDataDir({ dir: options.dir, env: deps.env, cwd: deps.cwd });

  const { created } = await scaffold(dataDir, { port: options.port });
  log(
    created.length > 0
      ? pc.green(`Initialized ${dataDir} (${created.length} files created).`)
      : pc.dim(`${dataDir} already initialized — nothing to do.`),
  );

  let keyPersisted = false;
  if (options.apiKey || options.model) {
    const writeSettings = deps.writeSettings ?? writeLocalSettings;
    await writeSettings(dataDir, {
      ...(options.apiKey ? { apiKey: options.apiKey } : {}),
      ...(options.model ? { model: options.model } : {}),
    });
    keyPersisted = Boolean(options.apiKey);
    log(pc.green("Provider settings saved to bp_template/settings.json."));
  } else {
    log(
      pc.dim(
        "No --api-key given. Set ANTHROPIC_API_KEY in your env, " +
          "or re-run `brainpilot init --api-key <key>`.",
      ),
    );
  }

  return { dataDir, created, keyPersisted };
}
