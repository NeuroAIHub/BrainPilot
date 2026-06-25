/**
 * #55: real provider connectivity probe for the Settings → Providers "Test"
 * button. Previously the /test route only echoed the stored profile with
 * health_status:"unknown", so even an unreachable gateway looked "tested".
 *
 * Strategy (kept deliberately generic so it works across OpenAI-compatible and
 * Anthropic-compatible gateways without hardcoding a vendor):
 *   - best-effort GET {baseUrl}/models with the API key as a Bearer token;
 *   - a 2xx ⇒ healthy (connected + authenticated);
 *   - 401/403 ⇒ error (reachable but auth rejected);
 *   - other 4xx/5xx ⇒ reachable, so still "healthy" at the connectivity level —
 *     many Anthropic-style gateways have no /models endpoint and answer 404, and
 *     that does NOT mean the gateway is down;
 *   - a network/DNS/timeout failure ⇒ unavailable.
 *
 * Error messages are redacted (no absolute node_modules paths) consistent with
 * the #45 hardening.
 */

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
}

/**
 * Strip absolute node_modules paths from any error text before surfacing it.
 *
 * Cross-platform (#157): accept BOTH `/` and `\` separators, plus an optional
 * Windows drive prefix. A native Windows path like
 * `C:\Users\<user>\…\node_modules\@pkg\file.md` previously slipped through
 * unredacted, leaking the username into the Test-button error toast.
 */
function redact(text: string): string {
  return text
    .replace(/(?:[A-Za-z]:)?(?:[\\/][^\s:]*)?node_modules[\\/][^\s)]*/g, "<path>")
    .replace(/\s+/g, " ")
    .trim();
}

function joinUrl(base: string, path: string): string {
  const b = base.replace(/\/+$/, "");
  const p = path.replace(/^\/+/, "");
  return `${b}/${p}`;
}

/**
 * Probe a provider gateway. `fetchFn`/`timeoutMs` are injectable for tests.
 * Never throws — always resolves to a ProbeResult.
 */
export async function probeProvider(
  input: ProbeInput,
  opts: { fetchFn?: typeof fetch; timeoutMs?: number } = {},
): Promise<ProbeResult> {
  const fetchFn = opts.fetchFn ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 5000;

  const base = (input.baseUrl ?? "").trim();
  if (!base) {
    return { status: "error", message: "No base URL configured for this provider." };
  }
  let url: string;
  try {
    url = joinUrl(base, "models");
    // validate it parses as a URL
    new URL(url);
  } catch {
    return { status: "error", message: "Invalid base URL." };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  try {
    const headers: Record<string, string> = { accept: "application/json" };
    if (input.apiKey) headers.authorization = `Bearer ${input.apiKey}`;
    const res = await fetchFn(url, { method: "GET", headers, signal: controller.signal });
    const latencyMs = Date.now() - startedAt;

    if (res.ok) {
      return { status: "healthy", latencyMs };
    }
    if (res.status === 401 || res.status === 403) {
      return {
        status: "error",
        message: `Authentication rejected (HTTP ${res.status}). Check the API key.`,
        latencyMs,
      };
    }
    // Reachable but the endpoint answered non-2xx (e.g. an Anthropic gateway
    // with no /models route). Connectivity is fine, so report healthy.
    return {
      status: "healthy",
      message: `Reached gateway (HTTP ${res.status}); /models probe not supported.`,
      latencyMs,
    };
  } catch (err) {
    const latencyMs = Date.now() - startedAt;
    const raw = (err as Error)?.name === "AbortError"
      ? `Timed out after ${timeoutMs}ms.`
      : (err as Error)?.message ?? String(err);
    return { status: "unavailable", message: redact(raw), latencyMs };
  } finally {
    clearTimeout(timer);
  }
}
