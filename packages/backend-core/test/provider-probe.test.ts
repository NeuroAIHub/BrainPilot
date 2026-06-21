import { describe, expect, it, vi } from "vitest";
import { probeProvider } from "../src/provider-probe.js";

describe("probeProvider (#55)", () => {
  it("reports healthy on a 2xx /models response", async () => {
    const fetchFn = vi.fn(async (url: string) => {
      expect(url).toBe("https://gw.example.com/api/models");
      return new Response('{"data":[]}', { status: 200 });
    });
    const r = await probeProvider(
      { baseUrl: "https://gw.example.com/api", apiKey: "sk-x" },
      { fetchFn: fetchFn as never },
    );
    expect(r.status).toBe("healthy");
  });

  it("sends the API key as a Bearer token", async () => {
    const fetchFn = vi.fn(async (_url: string, init: RequestInit) => {
      const headers = init.headers as Record<string, string>;
      expect(headers.authorization).toBe("Bearer sk-secret");
      return new Response("{}", { status: 200 });
    });
    await probeProvider(
      { baseUrl: "https://gw/api", apiKey: "sk-secret" },
      { fetchFn: fetchFn as never },
    );
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("reports unavailable when the gateway is unreachable (network error)", async () => {
    const fetchFn = vi.fn(async () => {
      throw new TypeError("fetch failed: ENOTFOUND example.invalid");
    });
    const r = await probeProvider(
      { baseUrl: "https://example.invalid/api", apiKey: "sk" },
      { fetchFn: fetchFn as never },
    );
    expect(r.status).toBe("unavailable");
    expect(r.message).toContain("ENOTFOUND");
  });

  it("reports unavailable on timeout", async () => {
    const fetchFn = vi.fn((_url: string, init: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        const signal = init.signal as AbortSignal;
        signal?.addEventListener("abort", () => {
          const e = new Error("aborted");
          e.name = "AbortError";
          reject(e);
        });
      });
    });
    const r = await probeProvider(
      { baseUrl: "https://slow/api", apiKey: "sk" },
      { fetchFn: fetchFn as never, timeoutMs: 10 },
    );
    expect(r.status).toBe("unavailable");
    expect(r.message).toMatch(/timed out/i);
  });

  it("reports error on 401/403 (auth rejected)", async () => {
    const fetchFn = vi.fn(async () => new Response("nope", { status: 401 }));
    const r = await probeProvider(
      { baseUrl: "https://gw/api", apiKey: "bad" },
      { fetchFn: fetchFn as never },
    );
    expect(r.status).toBe("error");
    expect(r.message).toMatch(/auth/i);
  });

  it("treats a non-2xx, non-auth response (e.g. 404 no /models) as healthy connectivity", async () => {
    const fetchFn = vi.fn(async () => new Response("not found", { status: 404 }));
    const r = await probeProvider(
      { baseUrl: "https://anthropic-gw/api", apiKey: "sk" },
      { fetchFn: fetchFn as never },
    );
    expect(r.status).toBe("healthy");
  });

  it("errors on an empty base URL without calling fetch", async () => {
    const fetchFn = vi.fn();
    const r = await probeProvider({ baseUrl: "", apiKey: "sk" }, { fetchFn: fetchFn as never });
    expect(r.status).toBe("error");
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("redacts node_modules paths from error messages", async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error("boom at /home/u/app/node_modules/undici/lib/x.js:1");
    });
    const r = await probeProvider(
      { baseUrl: "https://gw/api", apiKey: "sk" },
      { fetchFn: fetchFn as never },
    );
    expect(r.message).not.toMatch(/node_modules/);
  });
});
