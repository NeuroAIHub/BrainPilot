/**
 * agent-error.ts — normalize raw agent/SDK error messages before they reach
 * the user-facing event stream and events.jsonl (issue #45).
 *
 * Two jobs:
 *  1. Recognize the "no provider / no API key" case and replace the raw Pi SDK
 *     guidance (which points at `/login` and absolute node_modules doc paths)
 *     with a product-level message that points at BrainPilot's own Settings →
 *     Providers flow.
 *  2. Redact local filesystem leakage (absolute node_modules paths, `/login`
 *     hints) from any other error, so we never persist or display internal
 *     install paths.
 *
 * Language follows the existing runtime system_message convention (Chinese).
 */

/** Product-level recovery message for a missing provider/key. */
const NO_PROVIDER_MESSAGE =
  "未配置任何 provider。请打开 设置 → Providers 添加一个 provider。";

/** Heuristics for the "no key / no provider configured" class of error. */
function isNoProviderError(raw: string): boolean {
  return /no api key|no provider|api key found|api key for the selected model/i.test(
    raw,
  );
}

/**
 * Strip local-path / `/login` leakage from an arbitrary error string while
 * keeping its semantic content. Best-effort — drops lines that are purely an
 * absolute node_modules doc path or a `/login` hint, and scrubs any inline
 * absolute path that reaches into node_modules.
 */
function redact(raw: string): string {
  return raw
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      if (/use \/login/i.test(t)) return false;
      // A line that is just an absolute path into node_modules (doc pointer).
      if (/^\/?\S*node_modules\/\S+$/.test(t)) return false;
      return true;
    })
    .map((line) =>
      // Scrub any remaining inline absolute node_modules path.
      line.replace(/\/\S*node_modules\/\S+/g, "").trimEnd(),
    )
    .join("\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

/**
 * Normalize a raw agent error message for user display + persistence.
 * - No-provider/no-key errors → a product-level Settings → Providers message.
 * - Everything else → the original message with local paths / `/login` redacted.
 */
export function normalizeAgentError(raw: string): string {
  if (!raw) return raw;
  if (isNoProviderError(raw)) return NO_PROVIDER_MESSAGE;
  return redact(raw);
}
