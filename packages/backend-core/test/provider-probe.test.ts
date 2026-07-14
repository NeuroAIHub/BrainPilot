import { describe, expect, it, vi } from "vitest";
import { probeProvider } from "../src/provider-probe.js";

describe("probeProvider — protocol-aware model test", () => {
  it("probes Anthropic Messages with Anthropic headers", async () => {
    const fetchFn = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe("https://api.anthropic.com/v1/messages");
      expect((init.headers as Record<string, string>)["x-api-key"]).toBe("sk-ant");
      expect(JSON.parse(String(init.body))).toMatchObject({ model: "claude", max_tokens: 1 });
      return new Response("{}", { status: 200 });
    });
    const result = await probeProvider(
      {
        baseUrl: "https://api.anthropic.com",
        apiKey: "sk-ant",
        model: "claude",
        api: "anthropic-messages",
      },
      { fetchFn: fetchFn as never },
    );
    expect(result.status).toBe("healthy");
  });

  it("probes OpenAI Completions at the configured version root", async () => {
    const fetchFn = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe("https://open.bigmodel.cn/api/paas/v4/chat/completions");
      expect((init.headers as Record<string, string>).authorization).toBe("Bearer sk-oai");
      expect(JSON.parse(String(init.body))).toHaveProperty("messages");
      return new Response("{}", { status: 200 });
    });
    await probeProvider(
      {
        baseUrl: "https://open.bigmodel.cn/api/paas/v4",
        apiKey: "sk-oai",
        model: "glm",
        api: "openai-completions",
      },
      { fetchFn: fetchFn as never },
    );
  });

  it("probes OpenAI Responses with store:false", async () => {
    const fetchFn = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe("https://api.openai.com/v1/responses");
      expect((init.headers as Record<string, string>).authorization).toBe("Bearer sk-resp");
      expect(JSON.parse(String(init.body))).toMatchObject({
        model: "gpt-test",
        input: "ping",
        store: false,
      });
      return new Response("{}", { status: 200 });
    });
    await probeProvider(
      {
        baseUrl: "https://api.openai.com/v1",
        apiKey: "sk-resp",
        model: "gpt-test",
        api: "openai-responses",
      },
      { fetchFn: fetchFn as never },
    );
  });

  it("probes Azure OpenAI Responses with normalized resource URL and api-key", async () => {
    const fetchFn = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe("https://research.openai.azure.com/openai/v1/responses?api-version=v1");
      expect((init.headers as Record<string, string>)["api-key"]).toBe("azure-key");
      expect(JSON.parse(String(init.body))).toMatchObject({ model: "deployment-name", store: false });
      return new Response("{}", { status: 200 });
    });
    await probeProvider(
      {
        baseUrl: "https://research.openai.azure.com",
        apiKey: "azure-key",
        model: "deployment-name",
        api: "azure-openai-responses",
      },
      { fetchFn: fetchFn as never },
    );
  });

  it("defaults legacy profiles to Anthropic Messages", async () => {
    const fetchFn = vi.fn(async (url: string) => {
      expect(url).toBe("https://gw.example.com/v1/messages");
      return new Response("{}", { status: 200 });
    });
    await probeProvider(
      { baseUrl: "https://gw.example.com", apiKey: "sk", model: "m" },
      { fetchFn: fetchFn as never },
    );
  });

  it("reports unavailable when the gateway is unreachable", async () => {
    const fetchFn = vi.fn(async () => {
      throw new TypeError("fetch failed: ENOTFOUND example.invalid");
    });
    const result = await probeProvider(
      { baseUrl: "https://example.invalid", apiKey: "sk", model: "m" },
      { fetchFn: fetchFn as never },
    );
    expect(result.status).toBe("unavailable");
    expect(result.message).toContain("ENOTFOUND");
  });

  it("reports unavailable on timeout", async () => {
    const fetchFn = vi.fn((_url: string, init: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        const signal = init.signal as AbortSignal;
        signal.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        });
      });
    });
    const result = await probeProvider(
      { baseUrl: "https://slow.example.com", apiKey: "sk", model: "m" },
      { fetchFn: fetchFn as never, timeoutMs: 10 },
    );
    expect(result.status).toBe("unavailable");
    expect(result.message).toMatch(/timed out/i);
  });

  it("reports protocol/model HTTP failures instead of false healthy", async () => {
    const fetchFn = vi.fn(async () => new Response("wrong endpoint", { status: 404 }));
    const result = await probeProvider(
      {
        baseUrl: "https://gw.example.com/v1",
        apiKey: "sk",
        model: "m",
        api: "openai-responses",
      },
      { fetchFn: fetchFn as never },
    );
    expect(result.status).toBe("error");
    expect(result.message).toContain("HTTP 404");
    expect(result.message).toContain("wrong endpoint");
  });

  it("returns configuration errors without calling fetch", async () => {
    const fetchFn = vi.fn();
    const noUrl = await probeProvider(
      { baseUrl: "", apiKey: "sk", model: "m" },
      { fetchFn: fetchFn as never },
    );
    const noModel = await probeProvider(
      { baseUrl: "https://gw.example.com", apiKey: "sk" },
      { fetchFn: fetchFn as never },
    );
    expect(noUrl.status).toBe("error");
    expect(noModel.status).toBe("error");
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("redacts native and POSIX node_modules paths from errors", async () => {
    for (const message of [
      "boom at /home/u/app/node_modules/undici/lib/x.js:1",
      "boom at C:\\Users\\alice\\npm\\node_modules\\undici\\lib\\x.js:1",
    ]) {
      const result = await probeProvider(
        { baseUrl: "https://gw.example.com", apiKey: "sk", model: "m" },
        { fetchFn: vi.fn(async () => { throw new Error(message); }) as never },
      );
      expect(result.message).not.toMatch(/node_modules/);
      expect(result.message).not.toMatch(/alice/);
    }
  });
});
