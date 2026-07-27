/**
 * #377 — "Bring your own key" card for a platform-managed (preset) MCP server.
 *
 * Hosted deployments inject preset MCP servers (e.g. `tavily`) that are metered by
 * an API key. The platform ships a shared fallback key; this card lets a user
 * register their own so usage bills to them. The preset's transport shape stays
 * read-only — the card exposes exactly one field, the credential — which is the
 * whole point of the `byok` annotation over "let users edit the preset URL".
 *
 * Persistence lives entirely on the hosted side: PUT/DELETE
 * `/api/mcp-servers/byok/:kind`. The hosted layer rewrites the preset URL with the
 * user's key when it regenerates `mcp_servers.json`, so the key never round-trips
 * back to this component — `configured` is the only state we can read back, and
 * the input is always cleared after a successful save.
 *
 * Self-hosted builds have no BYOK endpoint, so SettingsDialog never renders this.
 */
import { useState, type FormEvent } from "react";
import { Loader2, KeyRound } from "lucide-react";
import { api } from "../../utils/api";
import { useT } from "../../i18n/useT";

interface McpByokCardProps {
  kind: string;
  /** Whether the user already has a key on file for this `kind`. */
  configured: boolean;
  /** Re-probe `GET /api/mcp-servers/byok` so `configured` reflects the write. */
  onChanged: () => void | Promise<void>;
}

export function McpByokCard({ kind, configured, onChanged }: McpByokCardProps) {
  const t = useT();
  const [apiKey, setApiKey] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = apiKey.trim();
    if (!trimmed) return;
    setIsBusy(true);
    setError(null);
    setStatus(null);
    try {
      await api.mcpByok.save(kind, trimmed);
      // Never keep the secret in component state once it's persisted.
      setApiKey("");
      setStatus(t("settings.mcp.byok.saved"));
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("settings.mcp.byok.saveFailed"));
    } finally {
      setIsBusy(false);
    }
  };

  const clear = async () => {
    setIsBusy(true);
    setError(null);
    setStatus(null);
    try {
      await api.mcpByok.clear(kind);
      setApiKey("");
      setStatus(t("settings.mcp.byok.cleared"));
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("settings.mcp.byok.clearFailed"));
    } finally {
      setIsBusy(false);
    }
  };

  const inputId = `mcp-byok-${kind}`;

  return (
    <form className="mcp-byok" onSubmit={save}>
      <div className="mcp-byok__head">
        <KeyRound size={14} />
        <strong>{t("settings.mcp.byok.title")}</strong>
        {configured ? <span className="mcp-byok__badge">{t("settings.mcp.byok.configured")}</span> : null}
      </div>
      <p className="mcp-byok__desc">
        {configured ? t("settings.mcp.byok.descConfigured") : t("settings.mcp.byok.desc")}
      </p>
      <div className="mcp-byok__row">
        <label className="mcp-byok__field" htmlFor={inputId}>
          <span className="mcp-byok__label">{t("settings.mcp.byok.keyLabel")}</span>
          <input
            autoComplete="off"
            disabled={isBusy}
            id={inputId}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder={configured ? t("settings.mcp.byok.placeholderReplace") : t("settings.mcp.byok.placeholder")}
            type="password"
            value={apiKey}
          />
        </label>
        <div className="mcp-byok__actions">
          <button className="settings-button" disabled={isBusy || !apiKey.trim()} type="submit">
            {isBusy ? <Loader2 aria-hidden className="spin" size={14} /> : null}
            {configured ? t("settings.mcp.byok.replace") : t("settings.mcp.byok.save")}
          </button>
          {configured ? (
            <button
              className="settings-button settings-button--ghost"
              disabled={isBusy}
              onClick={() => void clear()}
              type="button"
            >
              {t("settings.mcp.byok.clear")}
            </button>
          ) : null}
        </div>
      </div>
      {error ? (
        <p className="mcp-byok__msg mcp-byok__msg--error" role="alert">
          {error}
        </p>
      ) : status ? (
        <p className="mcp-byok__msg" role="status">
          {status}
        </p>
      ) : null}
    </form>
  );
}
