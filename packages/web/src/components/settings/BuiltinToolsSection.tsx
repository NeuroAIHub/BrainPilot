/**
 * On/off toggles for the three user-controllable Pi-native SystemTools:
 *   - skill_search
 *   - get_domain_knowledge_local
 *   - search_papers_local
 *
 * Rendered as a section at the top of the "工具" (formerly "MCP") tab in
 * SettingsDialog, above the MCP servers list. Independent from MCP —
 * these are Pi-native tools, not MCP transports.
 *
 * Persistence model: each toggle flip immediately PUTs {name: bool} to
 * /api/tool-toggles (partial-merge write). The runtime lazy-reads the file
 * once per process, so a change here only affects newly-created sessions.
 * A running-backend restart applies the change to all sessions. This is
 * spelled out in the panel via `settings.builtinTools.restartHint`.
 */
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { api } from "../../utils/api";
import { useT } from "../../i18n/useT";
import {
  TOGGLEABLE_TOOL_NAMES,
  type ToggleableToolName,
  type ToolToggles,
} from "../../contracts/backend";

// `undefined` in the state means "not yet loaded" (initial mount); once the
// GET resolves we swap in the fetched partial object (missing keys = enabled).
type ToggleState = ToolToggles | null | undefined;

export function BuiltinToolsSection() {
  const t = useT();
  const [state, setState] = useState<ToggleState>(undefined);
  const [savingName, setSavingName] = useState<ToggleableToolName | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Initial fetch. Mount effect deliberately naive — no polling; this rarely
  // changes and the fetch is cheap.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await api.toolToggles.get();
        if (!cancelled) setState(data);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : t("settings.builtinTools.loadFailed"));
          setState(null); // stop showing the spinner
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [t]);

  const isEnabled = (name: ToggleableToolName): boolean => {
    if (!state) return true; // pre-load: assume default-on so the UI matches
    return state[name] !== false;
  };

  const handleToggle = async (name: ToggleableToolName, next: boolean) => {
    setError(null);
    setSavingName(name);
    // Optimistic update — the PUT is idempotent so we can flip the UI
    // immediately and revert on failure.
    const prev = state;
    setState((current) => ({ ...(current ?? {}), [name]: next }));
    try {
      const merged = await api.toolToggles.update({ [name]: next });
      setState(merged);
    } catch (err) {
      // Rollback on failure. Surface the reason so the user knows the flip
      // didn't persist.
      setState(prev);
      setError(
        t("settings.builtinTools.saveFailed", {
          message: err instanceof Error ? err.message : String(err),
        }),
      );
    } finally {
      setSavingName(null);
    }
  };

  return (
    <section className="settings-section">
      <div className="settings-section__header">
        <div>
          <h3>{t("settings.builtinTools.title")}</h3>
          <p>{t("settings.builtinTools.desc")}</p>
        </div>
      </div>

      <div className="settings-group">
        {TOGGLEABLE_TOOL_NAMES.map((name) => {
          const enabled = isEnabled(name);
          const isSaving = savingName === name;
          return (
            <label
              className="settings-toggle-row"
              key={name}
              aria-busy={isSaving || undefined}
            >
              <span className="settings-toggle-row__text">
                <span>{t(`settings.builtinTools.tool.${name}.title`)}</span>
                <small>{t(`settings.builtinTools.tool.${name}.desc`)}</small>
                <small style={{ opacity: 0.6, fontFamily: "var(--font-mono, monospace)" }}>
                  {name}
                </small>
              </span>
              {isSaving ? (
                <Loader2 size={16} className="spin" aria-hidden />
              ) : (
                <input
                  type="checkbox"
                  checked={enabled}
                  disabled={state === undefined}
                  onChange={(e) => void handleToggle(name, e.target.checked)}
                />
              )}
            </label>
          );
        })}
      </div>

      <p className="kb-field-hint" style={{ marginTop: 12 }}>
        {t("settings.builtinTools.restartHint")}
      </p>

      {error ? (
        <p
          className="settings-note settings-note--error"
          role="alert"
          style={{ marginTop: 8 }}
        >
          {error}
        </p>
      ) : null}
    </section>
  );
}
