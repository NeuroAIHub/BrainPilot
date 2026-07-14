/**
 * Protocol-aware provider probe for Settings → Providers → Test.
 *
 * The probe sends one minimal request using the same four wire protocols the
 * runtime accepts. This catches endpoint/protocol/model mismatches that a
 * generic GET /models connectivity check cannot detect.
 */
import type { ProviderApi } from "@brainpilot/protocol";

export type ProbeStatus = "healthy" | "unavailable" | "error";

export interface ProbeResult {
  status: ProbeStatus;
  /** Human-readable detail for the UI; redacted, never leaks internal paths. */
  message?: string;
  latencyMs?: number;
}

export interface ProbeInput {
  baseUrl: string;
  apiKey: string;
  model?: string;
  /** Legacy profiles may omit this; the historical default is Anthropic Messages. */
  api?: ProviderApi;
}

/** Strip absolute node_modules paths from any error text before surfacing it. */
function redact(text: string): string {
  return text
    .replace(/(?:[A-Za-z]:)?(?:[\\/][^\s:]*)?node_modules[\\/][^\s)]*/g, "<path>")
    .replace(/\s+/g, " ")
    .trim();
}

/** OpenAI SDK appends resource paths directly to the configured base URL. */
function appendEndpoint(baseUrl: string, endpoint: string): string {
  const root = baseUrl.trim().replace(/\/+$/, "");
  new URL(root);
  return `${root}/${endpoint}`;
}

function anthropicMessagesEndpoint(baseUrl: string): string {
  const root = baseUrl.trim().replace(/\/+$/, "");
  const path = new URL(root).pathname.replace(/\/+$/, "");
  return `${root}${path.endsWith("/v1") ? "" : "/v1"}/messages`;
}

/** Match the Azure base-URL normalization used by Pi's Azure Responses transport. */
function azureResponsesEndpoint(baseUrl: string): string {
  const url = new URL(baseUrl.trim().replace(/\/+$/, ""));
  const isAzureHost =
    url.hostname.endsWith(".openai.azure.com") ||
    url.hostname.endsWith(".cognitiveservices.azure.com");
  const path = url.pathname.replace(/\/+$/, "");
  if (isAzureHost && (path === "" || path === "/" || path === "/openai")) {
    url.pathname = "/openai/v1";
  }
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/responses`;
  if (!url.searchParams.has("api-version")) url.searchParams.set("api-version", "v1");
  return url.toString();
}

function buildRequest(input: ProbeInput): {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
} {
  const api = input.api ?? "anthropic-messages";
  const model = input.model?.trim();
  if (!model) throw new Error("No model configured for this provider.");

  switch (api) {
    case "anthropic-messages":
      return {
        url: anthropicMessagesEndpoint(input.baseUrl),
        headers: {
          "x-api-key": input.apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: {
          model,
          max_tokens: 1,
          messages: [{ role: "user", content: "ping" }],
        },
      };
    case "openai-completions":
      return {
        url: appendEndpoint(input.baseUrl, "chat/completions"),
        headers: {
          authorization: `Bearer ${input.apiKey}`,
          "content-type": "application/json",
        },
        body: {
          model,
          messages: [{ role: "user", content: "Reply with OK." }],
        },
      };
    case "openai-responses":
      return {
        url: appendEndpoint(input.baseUrl, "responses"),
        headers: {
          authorization: `Bearer ${input.apiKey}`,
          "content-type": "application/json",
        },
        body: { model, input: "ping", max_output_tokens: 16, store: false },
      };
    case "azure-openai-responses":
      return {
        url: azureResponsesEndpoint(input.baseUrl),
        headers: { "api-key": input.apiKey, "content-type": "application/json" },
        body: { model, input: "ping", max_output_tokens: 16, store: false },
      };
  }
}

/** Probe a provider with its selected wire protocol. Never throws. */
export async function probeProvider(
  input: ProbeInput,
  opts: { fetchFn?: typeof fetch; timeoutMs?: number } = {},
): Promise<ProbeResult> {
  if (!input.baseUrl?.trim()) {
    return { status: "error", message: "No base URL configured for this provider." };
  }

  let request: ReturnType<typeof buildRequest>;
  try {
    request = buildRequest(input);
  } catch (e) {
    return { status: "error", message: redact((e as Error).message) };
  }

  const fetchFn = opts.fetchFn ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 5000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  try {
    const response = await fetchFn(request.url, {
      method: "POST",
      headers: request.headers,
      body: JSON.stringify(request.body),
      signal: controller.signal,
    });
    const latencyMs = Date.now() - startedAt;
    if (response.ok) return { status: "healthy", latencyMs };

    let detail = "";
    try {
      detail = redact((await response.text()).slice(0, 300));
    } catch {
      // The status code still provides a useful error when the body is unreadable.
    }
    const authHint =
      response.status === 401 || response.status === 403 ? " Check the API key." : "";
    return {
      status: "error",
      message: `Provider request failed (HTTP ${response.status}).${authHint}${detail ? ` ${detail}` : ""}`,
      latencyMs,
    };
  } catch (err) {
    const latencyMs = Date.now() - startedAt;
    const raw =
      (err as Error)?.name === "AbortError"
        ? `Timed out after ${timeoutMs}ms.`
        : (err as Error)?.message ?? String(err);
    return { status: "unavailable", message: redact(raw), latencyMs };
  } finally {
    clearTimeout(timer);
  }
}
