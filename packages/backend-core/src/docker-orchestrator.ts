/**
 * DockerOrchestrator — `docker run` the `brainpilot-sandbox` image over the mapped host port.
 * dockerode is loaded lazily via dynamic import (免 Docker install never pulls dockerode + gRPC/protobuf); the public API uses the local DockerLike, not dockerode types.
 */
import type {
  EnsureRuntimeOptions,
  Orchestrator,
  RuntimeHandle,
} from "./orchestrator.js";

/** Minimal container surface we use from dockerode. */
export interface DockerContainerLike {
  start(): Promise<unknown>;
  stop(opts?: { t?: number }): Promise<unknown>;
  remove(opts?: { force?: boolean }): Promise<unknown>;
}

/** Minimal dockerode surface we use. */
export interface DockerLike {
  createContainer(spec: unknown): Promise<DockerContainerLike>;
  pull(
    image: string,
    cb: (err: Error | null, stream: NodeJS.ReadableStream | undefined) => void,
  ): void;
  modem: {
    followProgress(
      stream: NodeJS.ReadableStream,
      onFinished: (err: Error | null) => void,
    ): void;
  };
}

/** Lazily import dockerode and return its default constructor. */
export type DockerLoader = () => Promise<{ default: new () => DockerLike }>;

const defaultDockerLoader: DockerLoader = async () => {
  const mod = await import("dockerode");
  return { default: mod.default as unknown as new () => DockerLike };
};

export interface DockerOrchestratorOptions {
  /** Image to run. Default `brainpilot-sandbox:latest`. */
  image?: string;
  /** Container-internal runtime port. Default 8081. */
  containerPort?: number;
  /** Host port to map to. Default = containerPort. */
  hostPort?: number;
  host?: string;
  /** Host data dir bind-mounted to the container's BP_DATA_DIR. */
  dataDir?: string;
  /** Container path BP_DATA_DIR points at. Default `/root/.bp-root`. */
  containerDataDir?: string;
  /** Injectable dockerode-like instance (for tests / advanced callers). */
  docker?: DockerLike;
  /** Injectable lazy loader (for tests). Defaults to dynamic import("dockerode"). */
  dockerLoader?: DockerLoader;
  /** Extra env passed to the container. */
  env?: Record<string, string>;
  healthProbe?: (baseUrl: string) => Promise<boolean>;
  healthTimeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

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

/** True when a dockerode error signals the image is not present locally. */
function isNoSuchImage(err: unknown): boolean {
  const e = err as { statusCode?: number; message?: string };
  return e?.statusCode === 404 || /no such image/i.test(e?.message ?? "");
}

export class DockerOrchestrator implements Orchestrator {
  private docker: DockerLike | null;
  private readonly dockerLoader: DockerLoader;
  private readonly image: string;
  private readonly containerPort: number;
  private readonly hostPort: number;
  private readonly host: string;
  private readonly containerDataDir: string;
  private readonly healthProbe: (baseUrl: string) => Promise<boolean>;
  private readonly healthTimeoutMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private dataDir?: string;
  private env: Record<string, string>;
  private container: DockerContainerLike | null = null;

  constructor(options: DockerOrchestratorOptions = {}) {
    this.docker = options.docker ?? null;
    this.dockerLoader = options.dockerLoader ?? defaultDockerLoader;
    this.image = options.image ?? "brainpilot-sandbox:latest";
    this.containerPort = options.containerPort ?? 8081;
    this.hostPort = options.hostPort ?? this.containerPort;
    this.host = options.host ?? "127.0.0.1";
    this.containerDataDir = options.containerDataDir ?? "/root/.bp-root";
    this.dataDir = options.dataDir;
    this.env = options.env ?? {};
    this.healthProbe = options.healthProbe ?? defaultHealthProbe;
    this.healthTimeoutMs = options.healthTimeoutMs ?? 30_000;
    this.sleep = options.sleep ?? sleepDefault;
  }

  /** Resolve a dockerode-like instance, loading dockerode lazily on first use. */
  private async getDocker(): Promise<DockerLike> {
    if (this.docker) return this.docker;
    let loaded: { default: new () => DockerLike };
    try {
      loaded = await this.dockerLoader();
    } catch {
      throw new Error(
        "Docker/dynamic mode requires 'dockerode'. Install it (npm i dockerode) " +
          "or use the local/static orchestrator.",
      );
    }
    this.docker = new loaded.default();
    return this.docker;
  }

  get baseUrl(): string {
    return `http://${this.host}:${this.hostPort}`;
  }

  async ensureRuntime(opts?: EnsureRuntimeOptions): Promise<RuntimeHandle> {
    if (opts?.dataDir) this.dataDir = opts.dataDir;
    if (opts?.env) this.env = { ...this.env, ...opts.env };

    if (this.container && (await this.health())) {
      return { baseUrl: this.baseUrl };
    }

    const portKey = `${this.containerPort}/tcp`;
    const envList = Object.entries({
      BP_DATA_DIR: this.containerDataDir,
      PORT: String(this.containerPort),
      AGENT_RUNTIME_PORT: String(this.containerPort),
      ...this.env,
    }).map(([k, v]) => `${k}=${v}`);

    const createSpec = {
      Image: this.image,
      Env: envList,
      ExposedPorts: { [portKey]: {} },
      HostConfig: {
        PortBindings: { [portKey]: [{ HostPort: String(this.hostPort) }] },
        // Cross-platform (#1): the legacy `Binds: ["src:dst:mode"]` colon-
        // delimited form is unparseable when `src` is a Windows path that
        // already contains a colon after the drive letter
        // (`C:\Users\foo\bp` → `C:\Users\foo\bp:/root/...:rw`), causing
        // dockerode/Docker Engine to mis-split the spec and either 422 the
        // container create or mount a host directory named just `C`. Use the
        // structured `Mounts` API (Docker Engine ≥1.25) instead — Source /
        // Target / ReadOnly are separate fields, so Engine's own
        // Windows-aware path translation does the right thing.
        ...(this.dataDir
          ? {
              Mounts: [
                {
                  Type: "bind",
                  Source: this.dataDir,
                  Target: this.containerDataDir,
                  ReadOnly: false,
                },
              ],
            }
          : {}),
      },
    };

    // `docker run` auto-pulls a missing image; dockerode's createContainer does
    // NOT — it 404s. Mirror the CLI: on "no such image", pull then retry once.
    const docker = await this.getDocker();
    let container: DockerContainerLike;
    try {
      container = await docker.createContainer(createSpec);
    } catch (err) {
      if (isNoSuchImage(err) && typeof docker.pull === "function") {
        await this.pullImage(docker);
        container = await docker.createContainer(createSpec);
      } else {
        throw err;
      }
    }
    await container.start();
    this.container = container;

    await this.waitForHealth();
    return { baseUrl: this.baseUrl };
  }

  /** Pull `this.image`, resolving once the pull stream finishes. */
  private pullImage(docker: DockerLike): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      docker.pull(this.image, (err: Error | null, stream: NodeJS.ReadableStream | undefined) => {
        if (err || !stream) return reject(err ?? new Error(`failed to pull ${this.image}`));
        docker.modem.followProgress(stream, (done: Error | null) =>
          done ? reject(done) : resolve(),
        );
      });
    });
  }

  async health(): Promise<boolean> {
    if (!this.container) return false;
    return this.healthProbe(this.baseUrl);
  }

  async stopRuntime(): Promise<void> {
    const container = this.container;
    this.container = null;
    if (!container) return;
    try {
      await container.stop({ t: 5 });
    } catch {
      /* already stopped */
    }
    try {
      await container.remove({ force: true });
    } catch {
      /* already gone */
    }
  }

  private async waitForHealth(): Promise<void> {
    const deadline = Date.now() + this.healthTimeoutMs;
    for (;;) {
      if (await this.healthProbe(this.baseUrl)) return;
      if (Date.now() >= deadline) {
        throw new Error(
          `docker runtime did not become healthy at ${this.baseUrl} within ` +
            `${this.healthTimeoutMs}ms`,
        );
      }
      await this.sleep(250);
    }
  }
}
