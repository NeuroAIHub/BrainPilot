import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  resolveGatewayModel,
  resolveSessionModel,
  resolveCompactionSettings,
  GATEWAY_PROVIDER,
  type PiProviderSdk,
} from "../pi-provider.js";

/** Fake Pi SDK that records the models.json path it was created against. */
function fakeSdk(): { sdk: PiProviderSdk; lastPath: () => string | undefined } {
  let modelsPath: string | undefined;
  const sdk: PiProviderSdk = {
    ModelRuntime: {
      create: async ({ modelsPath: path }) => {
        modelsPath = path;
        return {
          getError: () => undefined,
          // Resolve only the gateway provider + the id present in models.json.
          getModel: (provider, modelId) => {
            if (provider !== GATEWAY_PROVIDER || !path) return undefined;
            const cfg = JSON.parse(readFileSync(path, "utf8"));
            const ids = cfg.providers[GATEWAY_PROVIDER].models.map((m: { id: string }) => m.id);
            return ids.includes(modelId) ? { provider, id: modelId } : undefined;
          },
          setRuntimeApiKey: async () => {},
        };
      },
    },
  };
  return { sdk, lastPath: () => modelsPath };
}

const ENV_KEYS = [
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_MODEL",
  "ANTHROPIC_CONTEXT_WINDOW",
  "ANTHROPIC_MAX_TOKENS",
  "BP_MODELS_JSON",
  "BP_MODEL_PROVIDER",
] as const;

describe("resolveGatewayModel", () => {
  let agentDir: string;
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    agentDir = mkdtempSync(join(tmpdir(), "bp-agentdir-"));
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });
  afterEach(() => {
    rmSync(agentDir, { recursive: true, force: true });
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("returns {} when no custom gateway env is set (default endpoint)", async () => {
    const { sdk } = fakeSdk();
    await expect(resolveGatewayModel(sdk, agentDir)).resolves.toEqual({});
  });

  it("returns {} when only base url is set (model id missing)", async () => {
    process.env.ANTHROPIC_BASE_URL = "https://gw.example/api";
    const { sdk } = fakeSdk();
    await expect(resolveGatewayModel(sdk, agentDir)).resolves.toEqual({});
  });

  it("writes models.json and resolves the gateway model when both are set", async () => {
    process.env.ANTHROPIC_BASE_URL = "https://gw.example/api";
    process.env.ANTHROPIC_MODEL = "kimi-k2.6";
    const { sdk, lastPath } = fakeSdk();

    const { model, modelRuntime } = await resolveGatewayModel(sdk, agentDir);

    expect(model).toEqual({ provider: GATEWAY_PROVIDER, id: "kimi-k2.6" });
    expect(modelRuntime).toBeTruthy();
    const path = lastPath()!;
    expect(existsSync(path)).toBe(true);
    const cfg = JSON.parse(readFileSync(path, "utf8"));
    expect(cfg.providers[GATEWAY_PROVIDER].baseUrl).toBe("https://gw.example/api");
    expect(cfg.providers[GATEWAY_PROVIDER].api).toBe("anthropic-messages");
    // Key is referenced by env interpolation, never inlined.
    expect(cfg.providers[GATEWAY_PROVIDER].apiKey).toBe("$ANTHROPIC_API_KEY");
    expect(cfg.providers[GATEWAY_PROVIDER].models[0].reasoning).toBe(true);
  });

  it("removes a trailing /v1 from the Anthropic gateway base URL (#416)", async () => {
    process.env.ANTHROPIC_BASE_URL = "https://gw.example/proxy/v1/";
    process.env.ANTHROPIC_MODEL = "claude-x";
    const { sdk, lastPath } = fakeSdk();

    await resolveGatewayModel(sdk, agentDir);

    const cfg = JSON.parse(readFileSync(lastPath()!, "utf8"));
    expect(cfg.providers[GATEWAY_PROVIDER].baseUrl).toBe("https://gw.example/proxy");
  });

  it("applies default context/token limits when env is unset", async () => {
    process.env.ANTHROPIC_BASE_URL = "https://gw.example/api";
    process.env.ANTHROPIC_MODEL = "kimi-k2.6";
    const { sdk, lastPath } = fakeSdk();

    await resolveGatewayModel(sdk, agentDir);

    const cfg = JSON.parse(readFileSync(lastPath()!, "utf8"));
    const m = cfg.providers[GATEWAY_PROVIDER].models[0];
    expect(m.contextWindow).toBe(200_000);
    // #293: default raised to 32_768 so long tool-call arguments (write/edit/
    // dispatch_task content) don't get truncated mid-stream.
    expect(m.maxTokens).toBe(32_768);
  });

  it("honours ANTHROPIC_CONTEXT_WINDOW / ANTHROPIC_MAX_TOKENS overrides", async () => {
    process.env.ANTHROPIC_BASE_URL = "https://gw.example/api";
    process.env.ANTHROPIC_MODEL = "small-model";
    process.env.ANTHROPIC_CONTEXT_WINDOW = "32768";
    process.env.ANTHROPIC_MAX_TOKENS = "4096";
    const { sdk, lastPath } = fakeSdk();

    await resolveGatewayModel(sdk, agentDir);

    const cfg = JSON.parse(readFileSync(lastPath()!, "utf8"));
    const m = cfg.providers[GATEWAY_PROVIDER].models[0];
    expect(m.contextWindow).toBe(32768);
    expect(m.maxTokens).toBe(4096);
  });

  it("ignores a non-positive context-window override (keeps default)", async () => {
    process.env.ANTHROPIC_BASE_URL = "https://gw.example/api";
    process.env.ANTHROPIC_MODEL = "kimi-k2.6";
    process.env.ANTHROPIC_CONTEXT_WINDOW = "not-a-number";
    const { sdk, lastPath } = fakeSdk();

    await resolveGatewayModel(sdk, agentDir);

    const cfg = JSON.parse(readFileSync(lastPath()!, "utf8"));
    expect(cfg.providers[GATEWAY_PROVIDER].models[0].contextWindow).toBe(200_000);
  });

  it("tier 3: uses a user-supplied models.json verbatim (first provider)", async () => {
    const userModels = join(agentDir, "my-models.json");
    writeFileSync(
      userModels,
      JSON.stringify({
        providers: {
          "my-proxy": {
            baseUrl: "https://proxy.example/v1",
            api: "anthropic-messages",
            apiKey: "$ANTHROPIC_API_KEY",
            models: [{ id: "claude-x" }],
          },
        },
      }),
    );
    process.env.BP_MODELS_JSON = userModels;
    process.env.ANTHROPIC_MODEL = "claude-x";
    // find() resolves any provider/id pair present in the file.
    const sdk: PiProviderSdk = {
      ModelRuntime: {
        create: async ({ modelsPath: path }) => ({
          getError: () => undefined,
          getModel: (provider, id) => {
            const cfg = JSON.parse(readFileSync(path!, "utf8"));
            const p = cfg.providers[provider];
            return p?.models.some((m: { id: string }) => m.id === id)
              ? { provider, id }
              : undefined;
          },
          setRuntimeApiKey: async () => {},
        }),
      },
    };

    const { model } = await resolveGatewayModel(sdk, agentDir);
    expect(model).toEqual({ provider: "my-proxy", id: "claude-x" });
  });

  it("tier 3: BP_MODEL_PROVIDER selects among multiple providers", async () => {
    const userModels = join(agentDir, "multi.json");
    writeFileSync(
      userModels,
      JSON.stringify({
        providers: {
          "first": { models: [{ id: "a" }] },
          "second": { models: [{ id: "b" }] },
        },
      }),
    );
    process.env.BP_MODELS_JSON = userModels;
    process.env.BP_MODEL_PROVIDER = "second";
    process.env.ANTHROPIC_MODEL = "b";
    const sdk: PiProviderSdk = {
      ModelRuntime: {
        create: async ({ modelsPath: path }) => ({
          getError: () => undefined,
          getModel: (provider, id) => {
            const cfg = JSON.parse(readFileSync(path!, "utf8"));
            return cfg.providers[provider]?.models.some((m: { id: string }) => m.id === id)
              ? { provider, id }
              : undefined;
          },
          setRuntimeApiKey: async () => {},
        }),
      },
    };

    const { model } = await resolveGatewayModel(sdk, agentDir);
    expect(model).toEqual({ provider: "second", id: "b" });
  });

  it("tier 3: returns {} when BP_MODELS_JSON set but no model id", async () => {
    process.env.BP_MODELS_JSON = join(agentDir, "whatever.json");
    const { sdk } = fakeSdk();
    await expect(resolveGatewayModel(sdk, agentDir)).resolves.toEqual({});
  });

  it("throws when the configured model id cannot be resolved", async () => {
    process.env.ANTHROPIC_BASE_URL = "https://gw.example/api";
    process.env.ANTHROPIC_MODEL = "kimi-k2.6";
    const badSdk: PiProviderSdk = {
      ModelRuntime: {
        create: async () => ({
          getError: () => undefined,
          getModel: () => undefined,
          setRuntimeApiKey: async () => {},
        }),
      },
    };
    await expect(resolveGatewayModel(badSdk, agentDir)).rejects.toThrow(/model not found/);
  });
});

describe("resolveSessionModel (#63 per-session provider protocol)", () => {
  let agentDir: string;
  beforeEach(() => {
    agentDir = mkdtempSync(join(tmpdir(), "bp-session-prov-"));
  });
  afterEach(() => {
    rmSync(agentDir, { recursive: true, force: true });
  });

  /** Fake SDK that records the models.json path and resolves any present model. */
  function sessionSdk(): { sdk: PiProviderSdk; lastPath: () => string | undefined } {
    let modelsPath: string | undefined;
    const sdk: PiProviderSdk = {
      ModelRuntime: {
        create: async ({ modelsPath: path }) => {
          modelsPath = path;
          return {
            getError: () => undefined,
            getModel: (provider, id) => {
              if (!path) return undefined;
              const cfg = JSON.parse(readFileSync(path, "utf8"));
              return cfg.providers[provider]?.models.some((m: { id: string }) => m.id === id)
                ? { provider, id }
                : undefined;
            },
            setRuntimeApiKey: async () => {},
          };
        },
      },
    };
    return { sdk, lastPath: () => modelsPath };
  }

  it("returns {} when key/baseUrl/modelId are incomplete", async () => {
    const { sdk } = sessionSdk();
    await expect(
      resolveSessionModel(sdk, agentDir, { providerId: "p", apiKey: "" }),
    ).resolves.toEqual({});
    await expect(
      resolveSessionModel(sdk, agentDir, { providerId: "p", apiKey: "k", baseUrl: "https://x" }),
    ).resolves.toEqual({}); // modelId missing
  });

  it("writes the selected api into models.json (azure-openai-responses)", async () => {
    const { sdk, lastPath } = sessionSdk();
    const { model } = await resolveSessionModel(sdk, agentDir, {
      providerId: "azure-openai",
      baseUrl: "https://my-res.openai.azure.com/openai",
      api: "azure-openai-responses",
      apiKey: "sk-azure",
      modelId: "gpt-5.5",
    });
    expect(model).toEqual({ provider: "azure-openai", id: "gpt-5.5" });
    const cfg = JSON.parse(readFileSync(lastPath()!, "utf8"));
    expect(cfg.providers["azure-openai"].api).toBe("azure-openai-responses");
    expect(cfg.providers["azure-openai"].baseUrl).toBe("https://my-res.openai.azure.com/openai");
  });

  it("uses the provider context window instead of the environment default", async () => {
    process.env.ANTHROPIC_CONTEXT_WINDOW = "200000";
    const { sdk, lastPath } = sessionSdk();
    await resolveSessionModel(sdk, agentDir, {
      providerId: "long",
      baseUrl: "https://gw.example",
      apiKey: "sk-long",
      modelId: "model-1m",
      contextWindow: 1_000_000,
    });
    const cfg = JSON.parse(readFileSync(lastPath()!, "utf8"));
    expect(cfg.providers.long.models[0].contextWindow).toBe(1_000_000);
    delete process.env.ANTHROPIC_CONTEXT_WINDOW;
  });

  it("writes openai-responses when selected", async () => {
    const { sdk, lastPath } = sessionSdk();
    await resolveSessionModel(sdk, agentDir, {
      providerId: "oai",
      baseUrl: "https://api.openai.com/v1",
      api: "openai-responses",
      apiKey: "sk-oai",
      modelId: "gpt-x",
    });
    const cfg = JSON.parse(readFileSync(lastPath()!, "utf8"));
    expect(cfg.providers["oai"].api).toBe("openai-responses");
  });

  it("defaults to anthropic-messages when api is omitted (back-compat)", async () => {
    const { sdk, lastPath } = sessionSdk();
    await resolveSessionModel(sdk, agentDir, {
      providerId: "legacy",
      baseUrl: "https://gw.example/api",
      apiKey: "sk-legacy",
      modelId: "claude-x",
    });
    const cfg = JSON.parse(readFileSync(lastPath()!, "utf8"));
    expect(cfg.providers["legacy"].api).toBe("anthropic-messages");
  });

  it("normalizes /v1 only for anthropic-messages (#416)", async () => {
    const { sdk, lastPath } = sessionSdk();
    await resolveSessionModel(sdk, agentDir, {
      providerId: "ant",
      baseUrl: "https://gateway.example/v1/",
      api: "anthropic-messages",
      apiKey: "sk-ant",
      modelId: "claude-x",
    });
    let cfg = JSON.parse(readFileSync(lastPath()!, "utf8"));
    expect(cfg.providers.ant.baseUrl).toBe("https://gateway.example");

    await resolveSessionModel(sdk, agentDir, {
      providerId: "oai-v1",
      baseUrl: "https://gateway.example/v1/",
      api: "openai-completions",
      apiKey: "sk-oai",
      modelId: "gpt-x",
    });
    cfg = JSON.parse(readFileSync(lastPath()!, "utf8"));
    expect(cfg.providers["oai-v1"].baseUrl).toBe("https://gateway.example/v1/");
  });

  // #68: when api is unset, the precise wire value is derived from the coarse
  // adapter family. Explicit api still wins.
  it("derives api from the adapter when api is unset (#68)", async () => {
    const { sdk, lastPath } = sessionSdk();
    await resolveSessionModel(sdk, agentDir, {
      providerId: "oai",
      baseUrl: "https://api.openai.com/v1",
      adapter: "openai",
      apiKey: "sk-oai",
      modelId: "gpt-x",
    });
    expect(JSON.parse(readFileSync(lastPath()!, "utf8")).providers["oai"].api).toBe("openai-completions");
  });

  it("adapter=anthropic derives anthropic-messages (#68)", async () => {
    const { sdk, lastPath } = sessionSdk();
    await resolveSessionModel(sdk, agentDir, {
      providerId: "ant",
      baseUrl: "https://gw/api",
      adapter: "anthropic",
      apiKey: "sk-a",
      modelId: "claude-x",
    });
    expect(JSON.parse(readFileSync(lastPath()!, "utf8")).providers["ant"].api).toBe("anthropic-messages");
  });

  it("adapter=auto falls back to the default api (#68)", async () => {
    const { sdk, lastPath } = sessionSdk();
    await resolveSessionModel(sdk, agentDir, {
      providerId: "autop",
      baseUrl: "https://gw/api",
      adapter: "auto",
      apiKey: "sk-x",
      modelId: "m",
    });
    expect(JSON.parse(readFileSync(lastPath()!, "utf8")).providers["autop"].api).toBe("anthropic-messages");
  });

  it("explicit api wins over adapter (#68)", async () => {
    const { sdk, lastPath } = sessionSdk();
    await resolveSessionModel(sdk, agentDir, {
      providerId: "mix",
      baseUrl: "https://gw/api",
      api: "openai-responses",
      adapter: "anthropic",
      apiKey: "sk-x",
      modelId: "m",
    });
    expect(JSON.parse(readFileSync(lastPath()!, "utf8")).providers["mix"].api).toBe("openai-responses");
  });
});

describe("resolveCompactionSettings", () => {
  it("uses a 90% trigger and preserves 64K recent tokens for 1M contexts", () => {
    expect(resolveCompactionSettings(1_000_000)).toEqual({
      enabled: true,
      reserveTokens: 100_000,
      keepRecentTokens: 64_000,
    });
  });

  it("leaves auto and 256K profiles on Pi defaults", () => {
    expect(resolveCompactionSettings(undefined)).toBeUndefined();
    expect(resolveCompactionSettings(262_144)).toBeUndefined();
  });
});
