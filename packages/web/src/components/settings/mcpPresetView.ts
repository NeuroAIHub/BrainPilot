/**
 * #377 — pure view logic for the Settings → MCP list.
 *
 * Hosted deployments inject platform-managed preset servers into the same
 * `mcp_servers.json` the user's own entries live in. Two annotations drive how a
 * row renders: `readOnly` (no Edit / Delete, no raw URL) and `byok` (offer a
 * "bring your own key" card). Keeping the decision here — rather than inline in
 * SettingsDialog's JSX — makes it testable without a DOM, which this package has
 * no harness for (vitest runs in the `node` environment).
 */
import type { McpByokStatus, McpServerEntry } from "../../contracts/backend";

export interface McpEntryView {
  /** Platform-managed: hide Edit / Delete and show the "managed" note instead. */
  managed: boolean;
  /**
   * The BYOK row to render a card for, or null. Non-null requires *both* a `byok`
   * annotation on the entry and a matching `kind` advertised by the deployment —
   * a self-hosted backend has no BYOK endpoint, so no card can work there.
   */
  byok: McpByokStatus | null;
  /**
   * Subtitle text, or null when it must be replaced by the localized
   * "endpoint managed by the platform" string. A managed entry's URL can carry the
   * platform's shared API key, so we render its host and never the query string.
   */
  subtitle: string | null;
}

function hostOf(url: string): string | null {
  try {
    const host = new URL(url).host;
    return host || null;
  } catch {
    return null;
  }
}

export function resolveMcpEntryView(
  server: McpServerEntry,
  /** `null` = deployment has no BYOK endpoint (self-hosted). */
  byokStatus: McpByokStatus[] | null,
): McpEntryView {
  const managed = server.readOnly === true;
  const byok =
    server.byok && byokStatus ? byokStatus.find((row) => row.kind === server.byok!.kind) ?? null : null;

  let subtitle: string | null;
  if (server.type === "stdio") {
    subtitle = [server.command, ...(server.args || [])].filter(Boolean).join(" ");
  } else if (!server.url) {
    // A managed preset with no url at all is the same situation as an unparseable
    // one: there is nothing safe to show, so hand the UI null and let it render the
    // localized "endpoint managed by the platform" stand-in rather than a blank row.
    subtitle = managed ? null : "";
  } else if (!managed) {
    subtitle = server.url;
  } else {
    subtitle = hostOf(server.url);
  }

  return { managed, byok, subtitle };
}
