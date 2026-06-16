/**
 * commands/init.ts — scaffold the launch dir + optionally persist a provider
 * key, without starting anything (TS_PI_REFACTOR_DESIGN §11A.4).
 */
import pc from "picocolors";
import {
  writeLocalSettings,
  describeProviderConfig,
  formatProviderGuidance,
} from "@brainpilot/backend-core";
import { resolveDataDir } from "../paths.js";
import { scaffold } from "../scaffold.js";

export interface InitOptions {
  dir?: string;
  port?: number;
  /** Optional API key to persist into bp_template/settings.json. */
  apiKey?: string;
  /** Optional base URL (gateway) to persist. */
  baseUrl?: string;
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
  if (options.apiKey || options.baseUrl || options.model) {
    const writeSettings = deps.writeSettings ?? writeLocalSettings;
    await writeSettings(dataDir, {
      ...(options.apiKey ? { apiKey: options.apiKey } : {}),
      ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}),
      ...(options.model ? { model: options.model } : {}),
    });
    keyPersisted = Boolean(options.apiKey);
    log(pc.green("Provider settings saved to bp_template/settings.json."));
  }

  // Always end with an accurate picture of the resolved provider config, so
  // "already initialized" never hides the fact that no key is set yet, and the
  // user always sees where url/key/model can be configured (file, env, or UI).
  const report = await describeProviderConfig({ dataDir, env: deps.env });
  for (const line of formatProviderGuidance(report)) {
    log(report.hasKey ? pc.green(line) : pc.dim(line));
  }

  return { dataDir, created, keyPersisted };
}
