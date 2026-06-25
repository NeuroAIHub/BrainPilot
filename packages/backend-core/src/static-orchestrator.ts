/**
 * StaticRuntimeOrchestrator — static sandbox 模式 (docker-deploy spec §4.1).
 *
 * The runtime container is started by docker-compose, NOT by the backend. This
 * orchestrator therefore creates nothing: it only health-probes a pre-provisioned
 * `BP_RUNTIME_URL` and hands the backend that URL. `stopRuntime` is a no-op —
 * compose owns the container lifecycle.
 *
 * Same `Orchestrator` surface as Local/Docker so app.ts / runtime-client are
 * agnostic to deployment mode.
 */
import type {
  EnsureRuntimeOptions,
  Orchestrator,
  RuntimeHandle,
} from "./orchestrator.js";

async function defaultHealthProbe(baseUrl: string): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/health`);
    return res.ok;
  } catch {
    return false;
  }
}

const sleepDefault = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export interface StaticOrchestratorOptions {
  /** Pre-provisioned runtime URL (BP_RUNTIME_URL). Trailing slash is stripped. */
  baseUrl: string;
  /** Injectable health probe (for tests). Defaults to fetch GET /health. */
  healthProbe?: (baseUrl: string) => Promise<boolean>;
  /** Max ms to wait for the runtime to become healthy. Default 30_000. */
  healthTimeoutMs?: number;
  /** Poll interval in ms. Default 250. */
  pollMs?: number;
  /** Injectable sleep (for tests). */
  sleep?: (ms: number) => Promise<void>;
}

export class StaticRuntimeOrchestrator implements Orchestrator {
  private readonly url: string;
  private readonly healthProbe: (baseUrl: string) => Promise<boolean>;
  private readonly healthTimeoutMs: number;
  private readonly pollMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: StaticOrchestratorOptions) {
    if (!options.baseUrl || options.baseUrl.trim() === "") {
      throw new Error("StaticRuntimeOrchestrator: baseUrl is required");
    }
    this.url = options.baseUrl.replace(/\/+$/, "");
    this.healthProbe = options.healthProbe ?? defaultHealthProbe;
    this.healthTimeoutMs = options.healthTimeoutMs ?? 30_000;
    this.pollMs = options.pollMs ?? 250;
    this.sleep = options.sleep ?? sleepDefault;
  }

  get baseUrl(): string {
    return this.url;
  }

  async ensureRuntime(_opts?: EnsureRuntimeOptions): Promise<RuntimeHandle> {
    const deadline = Date.now() + this.healthTimeoutMs;
    for (;;) {
      if (await this.healthProbe(this.url)) return { baseUrl: this.url };
      if (Date.now() >= deadline) {
        throw new Error(
          `static runtime did not become healthy at ${this.url} within ` +
            `${this.healthTimeoutMs}ms.\n` +
            `  This is STATIC (sandbox) mode: the backend is trying to reach a ` +
            `pre-started runtime container at BP_RUNTIME_URL.\n` +
            `  • If you meant to run a Docker deployment: check it is up ` +
            `(\`docker compose logs sandbox\`) and that BP_RUNTIME_URL is correct.\n` +
            `  • If you meant to run from source: you likely have a stray ` +
            `BP_RUNTIME_URL/BP_ORCHESTRATOR in your environment. Run ` +
            `\`brainpilot up --mode local\` (or \`unset BP_RUNTIME_URL BP_ORCHESTRATOR\`).`,
        );
      }
      await this.sleep(this.pollMs);
    }
  }

  async health(): Promise<boolean> {
    return this.healthProbe(this.url);
  }

  async stopRuntime(): Promise<void> {
    // No-op: the sandbox container is owned by docker-compose.
  }
}
