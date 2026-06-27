import { describe, it, expect } from "vitest";
import { normalizeAgentError, classifyAgentError } from "../agent-error.js";

describe("normalizeAgentError (#45)", () => {
  const noKeyRaw = [
    "No API key found for the selected model.",
    "",
    "Use /login to log into a provider via OAuth or API key. See:",
    "  /home/u/app/node_modules/@earendil-works/pi-coding-agent/docs/providers.md",
    "  /home/u/app/node_modules/@earendil-works/pi-coding-agent/docs/models.md",
  ].join("\n");

  it("replaces the no-key SDK error with a Settings → Providers message", () => {
    const out = normalizeAgentError(noKeyRaw);
    expect(out.message).toContain("设置 → Providers");
  });

  it("never leaks /login or node_modules paths for the no-key case", () => {
    const out = normalizeAgentError(noKeyRaw);
    expect(out.message).not.toMatch(/\/login/i);
    expect(out.message).not.toMatch(/node_modules/);
    expect(out.details).toBeUndefined();
  });

  it("does not mention the BP_MOCK test switch", () => {
    const out = normalizeAgentError(noKeyRaw);
    expect(out.message).not.toMatch(/BP_MOCK/i);
  });

  it("redacts paths/login from other errors while keeping the message", () => {
    const raw =
      "Tool failed: cannot read config.\nUse /login first.\n/srv/app/node_modules/pkg/docs/x.md";
    const out = normalizeAgentError(raw);
    expect(out.message).toContain("Tool failed: cannot read config.");
    expect(out.message).not.toMatch(/\/login/i);
    expect(out.message).not.toMatch(/node_modules/);
  });

  it("leaves a clean error untouched", () => {
    const raw = "Rate limit exceeded, retry in 30s.";
    expect(normalizeAgentError(raw).message).toBe(raw);
  });

  it("handles empty input", () => {
    expect(normalizeAgentError("").message).toBe("");
  });

  // #157 — the original two regexes hardcoded forward slashes, so a Windows
  // absolute path (which carries the user's username under `C:\Users\<u>\…`)
  // slipped through redact() verbatim and leaked into the chat error bubble
  // and events.jsonl.
  describe("Windows path leakage (#157)", () => {
    const winNoKeyRaw = [
      "No model selected.",
      "  C:\\Users\\alice\\AppData\\Roaming\\npm\\node_modules\\@earendil-works\\pi-coding-agent\\docs\\providers.md",
    ].join("\n");

    it("does not leak a Windows absolute node_modules path in the message", () => {
      const out = normalizeAgentError(winNoKeyRaw);
      expect(out.message).not.toMatch(/node_modules/);
      expect(out.message).not.toMatch(/\.md/);
    });

    it("does not leak the Windows username (privacy)", () => {
      const out = normalizeAgentError(winNoKeyRaw);
      expect(out.message).not.toMatch(/alice/);
      expect(out.message).not.toMatch(/C:\\Users/i);
    });

    it("keeps the semantic head of the error", () => {
      const out = normalizeAgentError(winNoKeyRaw);
      expect(out.message).toContain("No model selected.");
    });

    it("drops a Windows-only path line just like the POSIX case", () => {
      const raw =
        "Tool failed: cannot read config.\nC:\\Users\\bob\\proj\\node_modules\\pkg\\docs\\x.md";
      const out = normalizeAgentError(raw);
      expect(out.message).toContain("Tool failed: cannot read config.");
      expect(out.message).not.toMatch(/node_modules/);
      expect(out.message).not.toMatch(/bob/);
    });
  });
});

describe("normalizeAgentError — provider HTTP errors (#97)", () => {
  const raw401 =
    '401 {"error":{"message":"invalid api key (request id: req_abc123)","type":"authentication_error"}}';

  it("produces a concise localized headline, not the raw blob", () => {
    const out = normalizeAgentError(raw401);
    expect(out.message).toContain("401");
    expect(out.message).toContain("invalid api key");
    // The primary message must not be the full escaped JSON dump.
    expect(out.message).not.toContain('{"error"');
  });

  it("keeps the full raw error (incl. request id) in details", () => {
    const out = normalizeAgentError(raw401);
    expect(out.details).toBe(raw401);
    expect(out.details).toContain("request id: req_abc123");
  });

  it("falls back to a code-only headline when no message is extractable", () => {
    const raw = "429 {}";
    const out = normalizeAgentError(raw);
    expect(out.message).toContain("429");
    expect(out.details).toBe(raw);
  });

  it("handles a 5xx with a string error field", () => {
    const raw = '503 {"error":"service unavailable"}';
    const out = normalizeAgentError(raw);
    expect(out.message).toContain("503");
    expect(out.message).toContain("service unavailable");
    expect(out.details).toBe(raw);
  });

  it("does not echo a JSON-shaped extracted message into the headline", () => {
    // Nested/odd shape where the naive pick would still contain braces.
    const raw = '400 {"error":{"detail":{"x":1}}}';
    const out = normalizeAgentError(raw);
    expect(out.message).not.toMatch(/[{}]/);
    expect(out.message).toContain("400");
  });
});

describe("classifyAgentError (#97)", () => {
  it("classifies auth/401/403 as fatal", () => {
    expect(classifyAgentError('401 {"error":{"message":"invalid api key"}}')).toBe("fatal");
    expect(classifyAgentError("403 forbidden")).toBe("fatal");
    expect(classifyAgentError("No API key found for the selected model.")).toBe("fatal");
    expect(classifyAgentError("authentication failed")).toBe("fatal");
    expect(classifyAgentError("permission denied")).toBe("fatal");
  });

  it("classifies rate-limit / 5xx / timeout / network as retryable", () => {
    expect(classifyAgentError("429 too many requests")).toBe("retryable");
    expect(classifyAgentError('503 {"error":"service unavailable"}')).toBe("retryable");
    expect(classifyAgentError("request timed out")).toBe("retryable");
    expect(classifyAgentError("model is overloaded")).toBe("retryable");
    expect(classifyAgentError("ECONNRESET")).toBe("retryable");
    expect(classifyAgentError("fetch failed")).toBe("retryable");
  });

  it("treats fatal patterns as fatal even when a retryable word co-occurs", () => {
    // A 401 blob that also mentions a rate limit must stay fatal (no point
    // retrying a bad key).
    expect(classifyAgentError("401 unauthorized — also rate limited")).toBe("fatal");
  });

  it("defaults unknown and empty errors to retryable", () => {
    expect(classifyAgentError("something weird happened")).toBe("retryable");
    expect(classifyAgentError("")).toBe("retryable");
  });
});
