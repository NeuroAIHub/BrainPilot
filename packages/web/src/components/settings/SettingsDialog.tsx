import { FormEvent, useEffect, useRef, useState } from "react";
import { Check, Database, Eye, EyeOff, Loader2, Plug, Plus, Settings, SlidersHorizontal, Trash2, UserRound, Wrench, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { McpByokStatus, McpServerEntry, ProviderProfile, ProviderApi } from "../../contracts/backend";
import { useAuth } from "../../contexts/AuthContext";
import { usePreferences } from "../../contexts/PreferencesContext";
import { useT } from "../../i18n/useT";
import { api } from "../../utils/api";
import { runtimeConfig } from "../../config";
import { EXAMPLE_MODEL } from "@brainpilot/protocol";
import { CustomSelect } from "../primitives/CustomSelect";
import { IconButton } from "../primitives/IconButton";
import { KnowledgeBasePanel } from "./KnowledgeBasePanel";
import { BuiltinToolsSection } from "./BuiltinToolsSection";
import { McpByokCard } from "./McpByokCard";
import { resolveMcpEntryView } from "./mcpPresetView";
import {
  canSubmitProviderForm,
  providerFieldErrorKey,
  validateProviderForm,
  type ProviderFormErrors,
} from "./providerFormValidation";
import { listFocusable, resolveEscapeLayer, trapFocusKeyDown } from "./settingsModalStack";

export type SettingsTab = "account" | "providers" | "mcp" | "knowledgeBase" | "preferences";

type SettingsDialogProps = {
  isOpen: boolean;
  onClose: () => void;
  /** Deep-link target: when opening, jump straight to this tab (e.g. the
   *  no-provider banner opens directly to "providers"). */
  initialTab?: SettingsTab;
};

const ALL_TABS: Array<{ id: SettingsTab; labelKey: string; icon: LucideIcon }> = [
  { id: "account", labelKey: "settings.tab.account", icon: UserRound },
  { id: "providers", labelKey: "settings.tab.providers", icon: SlidersHorizontal },
  // "工具" tab: hosts both the built-in tool toggles (BuiltinToolsSection at
  // the top) and the MCP servers CRUD (below). Kept as tab id "mcp" for URL
  // stability; the label + icon shift to a generic tool motif since the tab
  // now covers more than MCP.
  { id: "mcp", labelKey: "settings.tab.mcp", icon: Wrench },
  { id: "knowledgeBase", labelKey: "settings.tab.knowledgeBase", icon: Database },
  { id: "preferences", labelKey: "settings.tab.preferences", icon: Settings },
];

type SettingsTabConfig = Pick<
  typeof runtimeConfig,
  "localMode" | "knowledgeBaseSettingsEnabled"
>;

/** Apply deployment capabilities to the Settings navigation. */
export function getSettingsTabs(config: SettingsTabConfig) {
  return ALL_TABS.filter((tab) => {
    // Local single-user mode has no host-managed identity — the account tab
    // would only show placeholder "local / local / 1970" values.
    if (config.localMode && tab.id === "account") return false;
    // Managed deployments may ship a pre-provisioned knowledge base and hide
    // the local build/configuration surface while retaining retrieval tools.
    if (!config.knowledgeBaseSettingsEnabled && tab.id === "knowledgeBase") return false;
    return true;
  });
}

const tabs = getSettingsTabs(runtimeConfig);

const DEFAULT_PROVIDER_FORM = {
  name: "",
  baseUrl: "https://api.anthropic.com",
  api: "anthropic-messages" as ProviderApi,
  apiKey: "",
  apiKeyMasked: "",
  models: [EXAMPLE_MODEL],
  iconColor: "#111111",
  notes: "",
};

const DEFAULT_MCP_FORM = {
  name: "",
  type: "stdio" as McpServerEntry["type"],
  command: "",
  args: "",
  url: "",
};

const colorOptions = ["#111111", "#16a34a", "#2563eb", "#7c3aed", "#f59e0b", "#d92d20", "#64748b"];
const PROVIDER_UPDATED_EVENT = "provider-profiles-updated";

function splitList(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function SettingsDialog({ isOpen, onClose, initialTab }: SettingsDialogProps) {
  const { user } = useAuth();
  const preferences = usePreferences();
  const t = useT();
  const [activeTab, setActiveTab] = useState<SettingsTab>(tabs[0].id);
  const [providers, setProviders] = useState<ProviderProfile[]>([]);
  const [mcpServers, setMcpServers] = useState<McpServerEntry[]>([]);
  // #377: preset BYOK. `null` = this deployment has no `/api/mcp-servers/byok`
  // (self-hosted) → presets behave exactly as before, no BYOK cards. An array
  // (possibly empty) = hosted deployment; each row tells us whether the user
  // already has a key on file for that `byok.kind`.
  const [mcpByokStatus, setMcpByokStatus] = useState<McpByokStatus[] | null>(null);
  const [providerForm, setProviderForm] = useState(DEFAULT_PROVIDER_FORM);
  const [editingProviderId, setEditingProviderId] = useState<string | null>(null);
  const [isProviderFormOpen, setIsProviderFormOpen] = useState(false);
  const [showProviderKey, setShowProviderKey] = useState(false);
  const [providerFieldErrors, setProviderFieldErrors] = useState<ProviderFormErrors>({});
  const [showProviderValidation, setShowProviderValidation] = useState(false);
  const [mcpForm, setMcpForm] = useState(DEFAULT_MCP_FORM);
  const [editingMcpName, setEditingMcpName] = useState<string | null>(null);
  const [isMcpFormOpen, setIsMcpFormOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState<string | null>(null);
  const [testingProviderId, setTestingProviderId] = useState<string | null>(null);

  // #328 — modal a11y: focus return, traps, nested Escape stack.
  const settingsRootRef = useRef<HTMLDivElement | null>(null);
  const settingsPanelRef = useRef<HTMLElement | null>(null);
  const providerDialogRef = useRef<HTMLDivElement | null>(null);
  const mcpDialogRef = useRef<HTMLDivElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const providerNameInputRef = useRef<HTMLInputElement | null>(null);

  const mergeHealth = (profiles: ProviderProfile[], healthProfiles: ProviderProfile[]): ProviderProfile[] => {
    const healthById = new Map(healthProfiles.map((p) => [p.id, p]));
    return profiles.map((p) => {
      const h = healthById.get(p.id);
      if (!h) return p;
      return { ...p, healthStatus: h.healthStatus, healthCheckedAt: h.healthCheckedAt, modelHealth: h.modelHealth };
    });
  };

  const loadSettings = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [nextProviders, nextMcpServers, healthProfiles, nextByok] = await Promise.all([
        api.providers.list(),
        api.mcpServers.list(),
        api.providers.health().catch(() => [] as ProviderProfile[]),
        // Probe never rejects — it resolves to null when unsupported (#377).
        api.mcpByok.support(),
      ]);
      setProviders(mergeHealth(nextProviders, healthProfiles));
      setMcpServers(nextMcpServers);
      setMcpByokStatus(nextByok);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("settings.loadFailed"));
    } finally {
      setIsLoading(false);
    }
  };

  const refreshHealth = async () => {
    try {
      const healthProfiles = await api.providers.health();
      setProviders((current) => mergeHealth(current, healthProfiles));
    } catch {
      // ignore silent refresh errors
    }
  };

  const refreshSettingsSilent = async () => {
    try {
      const [nextProviders, nextMcpServers, healthProfiles, nextByok] = await Promise.all([
        api.providers.list(),
        api.mcpServers.list(),
        api.providers.health().catch(() => [] as ProviderProfile[]),
        api.mcpByok.support(),
      ]);
      setProviders(mergeHealth(nextProviders, healthProfiles));
      setMcpServers(nextMcpServers);
      setMcpByokStatus(nextByok);
    } catch {
      // ignore silent refresh errors
    }
  };

  /**
   * #377: re-probe after a BYOK save/clear so the `configured` badge reflects the
   * write. Also refreshes the server list, because the hosted layer rewrites the
   * preset URL with the user's key as part of the same operation.
   */
  const refreshMcpByok = async () => {
    const [nextByok, nextMcpServers] = await Promise.all([
      api.mcpByok.support(),
      api.mcpServers.list().catch(() => null),
    ]);
    setMcpByokStatus(nextByok);
    if (nextMcpServers) setMcpServers(nextMcpServers);
  };

  const testProvider = async (providerId: string) => {
    setTestingProviderId(providerId);
    try {
      const result = await api.providers.test(providerId);
      setProviders((current) =>
        current.map((p) => (p.id === providerId ? { ...p, healthStatus: result.healthStatus, healthCheckedAt: result.healthCheckedAt, modelHealth: result.modelHealth } : p)),
      );
      setStatus(t("settings.providers.tested", { name: result.name, status: result.healthStatus }));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("settings.providers.testFailed"));
    } finally {
      setTestingProviderId(null);
    }
  };

  useEffect(() => {
    if (isOpen) {
      // Honour a deep-link target (e.g. the composer's no-provider banner jumps
      // straight to Providers). Only on the open transition, so a user can still
      // navigate to other tabs while the dialog stays open.
      if (initialTab) setActiveTab(initialTab);
      void loadSettings();
      void api.getVersion().then((v) => setVersion(v.version)).catch(() => setVersion(null));
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || activeTab !== "providers") return;
    const id = window.setInterval(() => void refreshSettingsSilent(), 30000);
    return () => window.clearInterval(id);
  }, [isOpen, activeTab]);

  // Capture the control that opened Settings and restore focus on close (#328).
  useEffect(() => {
    if (!isOpen) return;
    returnFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // Focus the settings panel after paint.
    const id = window.requestAnimationFrame(() => {
      const panel = settingsPanelRef.current;
      if (!panel) return;
      const focusable = listFocusable(panel);
      (focusable[0] ?? panel).focus();
    });
    return () => {
      window.cancelAnimationFrame(id);
      const el = returnFocusRef.current;
      if (el && typeof el.focus === "function") {
        try {
          el.focus();
        } catch {
          /* element may be gone */
        }
      }
    };
  }, [isOpen]);

  // Isolate background content from AT while any settings layer is open (#328).
  useEffect(() => {
    if (!isOpen) return;
    const root = settingsRootRef.current;
    const parent = root?.parentElement;
    if (!parent || !root) return;
    const siblings = Array.from(parent.children).filter((c) => c !== root);
    for (const el of siblings) {
      if (el instanceof HTMLElement) {
        el.setAttribute("inert", "");
        el.setAttribute("aria-hidden", "true");
      }
    }
    return () => {
      for (const el of siblings) {
        if (el instanceof HTMLElement) {
          el.removeAttribute("inert");
          el.removeAttribute("aria-hidden");
        }
      }
    };
  }, [isOpen]);

  // Nested Escape + focus trap for the topmost dialog (#328).
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const layer = resolveEscapeLayer({
        isSettingsOpen: isOpen,
        isProviderFormOpen,
        isMcpFormOpen,
      });
      const topEl =
        layer === "mcp"
          ? mcpDialogRef.current
          : layer === "provider"
            ? providerDialogRef.current
            : settingsPanelRef.current;
      if (topEl && trapFocusKeyDown(topEl, event)) {
        return;
      }
      if (event.key === "Escape" || event.key === "Esc") {
        event.preventDefault();
        event.stopPropagation();
        if (layer === "mcp") {
          closeMcpForm();
        } else if (layer === "provider") {
          closeProviderForm();
        } else {
          onClose();
        }
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [isOpen, isProviderFormOpen, isMcpFormOpen, onClose]);

  // Focus first field when nested provider form opens.
  useEffect(() => {
    if (!isProviderFormOpen) return;
    const id = window.requestAnimationFrame(() => {
      providerNameInputRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(id);
  }, [isProviderFormOpen]);

  // Focus first field when nested MCP form opens.
  useEffect(() => {
    if (!isMcpFormOpen) return;
    const id = window.requestAnimationFrame(() => {
      const dialog = mcpDialogRef.current;
      if (!dialog) return;
      const focusable = listFocusable(dialog);
      focusable[0]?.focus();
    });
    return () => window.cancelAnimationFrame(id);
  }, [isMcpFormOpen]);

  if (!isOpen) {
    return null;
  }

  const providerValidation = validateProviderForm(providerForm, {
    isEdit: Boolean(editingProviderId),
  });
  const canSubmitProvider = canSubmitProviderForm(providerForm, {
    isEdit: Boolean(editingProviderId),
  });

  const emitProviderUpdated = () => {
    window.dispatchEvent(new Event(PROVIDER_UPDATED_EVENT));
  };

  const openProviderForm = () => {
    setEditingProviderId(null);
    setProviderForm(DEFAULT_PROVIDER_FORM);
    setShowProviderKey(false);
    setProviderFieldErrors({});
    setShowProviderValidation(false);
    setIsProviderFormOpen(true);
  };

  const closeProviderForm = () => {
    setEditingProviderId(null);
    setProviderForm(DEFAULT_PROVIDER_FORM);
    setShowProviderKey(false);
    setProviderFieldErrors({});
    setShowProviderValidation(false);
    setIsProviderFormOpen(false);
  };

  const saveProvider = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    const validation = validateProviderForm(providerForm, {
      isEdit: Boolean(editingProviderId),
    });
    if (!validation.ok) {
      setShowProviderValidation(true);
      setProviderFieldErrors(validation.errors);
      return;
    }
    const models = providerForm.models.map((model) => model.trim()).filter(Boolean);
    try {
      const provider = editingProviderId
        ? await api.providers.update(editingProviderId, {
            name: providerForm.name,
            baseUrl: providerForm.baseUrl,
            api: providerForm.api,
            ...(providerForm.apiKey ? { apiKey: providerForm.apiKey } : {}),
            models,
            iconColor: providerForm.iconColor,
            notes: providerForm.notes,
          })
        : await api.providers.create({
            name: providerForm.name,
            baseUrl: providerForm.baseUrl,
            api: providerForm.api,
            apiKey: providerForm.apiKey,
            models,
            iconColor: providerForm.iconColor,
            notes: providerForm.notes,
          });
      setProviders((current) => [provider, ...current.filter((item) => item.id !== provider.id)]);
      setProviderForm(DEFAULT_PROVIDER_FORM);
      setEditingProviderId(null);
      setShowProviderKey(false);
      setIsProviderFormOpen(false);
      setStatus(editingProviderId ? t("settings.providers.updated") : t("settings.providers.added"));
      emitProviderUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("settings.providers.saveFailed"));
    }
  };

  const editProvider = (provider: ProviderProfile) => {
    setEditingProviderId(provider.id);
    setProviderForm({
      name: provider.name,
      baseUrl: provider.baseUrl,
      api: provider.api,
      apiKey: "",
      apiKeyMasked: provider.apiKeyMasked || "",
      models: provider.models.length ? provider.models : [""],
      iconColor: provider.iconColor || "#111111",
      notes: provider.notes,
    });
    setShowProviderKey(false);
    setIsProviderFormOpen(true);
  };

  const activateProvider = async (providerId: string) => {
    const active = await api.providers.setActive(providerId);
    setProviders((current) => current.map((provider) => ({ ...provider, isActive: provider.id === active.id })));
    setStatus(t("settings.providers.activeSwitched", { name: active.name }));
    emitProviderUpdated();
  };

  const removeProvider = async (providerId: string) => {
    await api.providers.remove(providerId);
    setProviders((current) => current.filter((provider) => provider.id !== providerId));
    emitProviderUpdated();
  };

  const updateProviderModel = (index: number, value: string) => {
    setProviderForm((current) => ({
      ...current,
      models: current.models.map((model, modelIndex) => (modelIndex === index ? value : model)),
    }));
  };

  const addProviderModel = () => {
    setProviderForm((current) => ({ ...current, models: [...current.models, ""] }));
  };

  const removeProviderModel = (index: number) => {
    setProviderForm((current) => ({
      ...current,
      models: current.models.filter((_, modelIndex) => modelIndex !== index),
    }));
  };

  const openMcpForm = () => {
    setEditingMcpName(null);
    setMcpForm(DEFAULT_MCP_FORM);
    setIsMcpFormOpen(true);
  };

  const closeMcpForm = () => {
    setEditingMcpName(null);
    setMcpForm(DEFAULT_MCP_FORM);
    setIsMcpFormOpen(false);
  };

  const saveMcpServer = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    try {
      const config: Omit<McpServerEntry, "name"> =
        mcpForm.type === "stdio"
          ? { type: "stdio", command: mcpForm.command, args: splitList(mcpForm.args) }
          : { type: mcpForm.type, url: mcpForm.url };
      const server = editingMcpName
        ? await api.mcpServers.update(editingMcpName, config)
        : await api.mcpServers.add(mcpForm.name, config);
      setMcpServers((current) => [server, ...current.filter((item) => item.name !== server.name)]);
      setMcpForm(DEFAULT_MCP_FORM);
      setEditingMcpName(null);
      setIsMcpFormOpen(false);
      setStatus(editingMcpName ? t("settings.mcp.updated") : t("settings.mcp.added"));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("settings.mcp.saveFailed"));
    }
  };

  const editMcpServer = (server: McpServerEntry) => {
    setEditingMcpName(server.name);
    setMcpForm({
      name: server.name,
      type: server.type,
      command: server.command || "",
      args: (server.args || []).join(", "),
      url: server.url || "",
    });
    setIsMcpFormOpen(true);
  };

  const removeMcpServer = async (name: string) => {
    setError(null);
    try {
      await api.mcpServers.remove(name);
      setMcpServers((current) => current.filter((server) => server.name !== name));
    } catch (err) {
      // #377: the backend now 403s on a platform-managed entry. Surface it rather
      // than rejecting unhandled and leaving the row silently in place.
      setError(err instanceof Error ? err.message : t("settings.mcp.removeFailed"));
    }
  };

  /**
   * #377: what to show as an entry's subtitle. `resolveMcpEntryView` returns null
   * when the URL must not be shown at all (a managed preset with an unparseable
   * URL) — that's the only case needing a localized stand-in.
   */
  const mcpSubtitle = (subtitle: string | null): string => subtitle ?? t("settings.mcp.presetHiddenUrl");

  return (
    <div
      className="settings-modal"
      ref={settingsRootRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-dialog-title"
    >
      <div className="settings-modal__backdrop" onClick={onClose} />
      <section
        className="settings-modal__panel"
        ref={settingsPanelRef}
        tabIndex={-1}
      >
        <header className="settings-modal__header">
          <div>
            <span className="settings-modal__eyebrow">{t("settings.eyebrow.workspace")}</span>
            <h2 id="settings-dialog-title">{t("settings.title")}</h2>
          </div>
          <IconButton label={t("settings.aria.close")} onClick={onClose}>
            <X size={16} />
          </IconButton>
        </header>

        <div className="settings-modal__body">
          <nav className="settings-tabs" aria-label={t("settings.aria.sections")}>
            {tabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  className={activeTab === tab.id ? "is-active" : ""}
                  key={tab.id}
                  aria-current={activeTab === tab.id ? "page" : undefined}
                  onClick={() => setActiveTab(tab.id)}
                  type="button"
                >
                  <Icon size={15} />
                  <span>{t(tab.labelKey)}</span>
                </button>
              );
            })}
          </nav>

          <div className="settings-content">
            {isLoading ? <p className="settings-note">{t("settings.loading")}</p> : null}
            {error ? <p className="settings-note settings-note--error">{error}</p> : null}
            {status ? <p className="settings-note">{status}</p> : null}

            {activeTab === "account" ? (
              <section className="settings-section">
                <h3>{t("settings.account.title")}</h3>
                <dl className="settings-kv">
                  <div>
                    <dt>{t("settings.account.username")}</dt>
                    <dd>{user?.username || "-"}</dd>
                  </div>
                  <div>
                    <dt>{t("settings.account.userId")}</dt>
                    <dd>{user?.id || "-"}</dd>
                  </div>
                  <div>
                    <dt>{t("settings.account.created")}</dt>
                    <dd>{user?.createdAt ? new Date(user.createdAt).toLocaleString() : "-"}</dd>
                  </div>
                </dl>
                <p className="settings-note">{t("settings.account.managedByHost")}</p>
              </section>
            ) : null}

            {activeTab === "providers" ? (
              <section className="settings-section">
                <div className="settings-section__header">
                  <div>
                    <h3>{t("settings.providers.title")}</h3>
                    <p>{t("settings.providers.desc")}</p>
                  </div>
                  <div className="provider-header-actions">
                    {providers.find((provider) => provider.isActive) ? (
                      <span className="provider-active-pill">
                        <Check size={13} />
                        {providers.find((provider) => provider.isActive)?.name}
                      </span>
                    ) : null}
                    <button className="settings-button" onClick={openProviderForm} type="button">
                      {t("settings.providers.add")}
                    </button>
                  </div>
                </div>

                {(() => {
                  const sharedProviders = providers.filter((p) => p.id.startsWith("shared_"));
                  const privateProviders = providers.filter((p) => !p.id.startsWith("shared_"));

                  const renderProviderCard = (provider: ProviderProfile) => (
                    <article className="settings-list-item" key={provider.id}>
                      <div>
                        <strong>
                          <span className="provider-color-dot" style={{ backgroundColor: provider.iconColor }} />
                          {provider.name}
                          <span
                            className={`provider-health-dot provider-health-dot--${provider.healthStatus}`}
                            title={t("settings.providers.statusTitle", { status: provider.healthStatus })}
                          />
                        </strong>
                        <span>{provider.baseUrl}</span>
                        <small>{provider.models.join(", ") || t("settings.providers.noModelList")} · {provider.apiKeyMasked}</small>
                        <div className="provider-model-health-row">
                          {provider.modelHealth.map((mh) => (
                            <span
                              key={mh.model}
                              className={`provider-model-pill provider-model-pill--${mh.status}`}
                              title={mh.error || mh.status}
                            >
                              <span className={`model-status-dot model-status-dot--${mh.status}`} />
                              {mh.model}
                              {mh.latencyMs !== undefined ? ` (${mh.latencyMs}ms)` : null}
                            </span>
                          ))}
                        </div>
                      </div>
                      <div className="settings-list-item__actions provider-actions">
                        <button onClick={() => editProvider(provider)} type="button">
                          {t("settings.providers.edit")}
                        </button>
                        <button
                          disabled={testingProviderId === provider.id}
                          onClick={() => void testProvider(provider.id)}
                          type="button"
                        >
                          {testingProviderId === provider.id ? <Loader2 size={14} className="spin" /> : t("settings.providers.test")}
                        </button>
                        <button disabled={provider.isActive} onClick={() => void activateProvider(provider.id)} type="button">
                          {provider.isActive ? <Check size={14} /> : t("settings.providers.use")}
                        </button>
                        <button disabled={provider.isActive} onClick={() => void removeProvider(provider.id)} type="button">
                          {t("settings.providers.remove")}
                        </button>
                      </div>
                    </article>
                  );

                  if (providers.length === 0) {
                    return (
                      <div className="settings-empty">
                        <SlidersHorizontal size={22} />
                        <strong>{t("settings.providers.empty")}</strong>
                        <p>{t("settings.providers.emptyHint")}</p>
                        <button className="settings-button" onClick={openProviderForm} type="button">
                          {t("settings.providers.add")}
                        </button>
                      </div>
                    );
                  }

                  return (
                    <>
                      {sharedProviders.length > 0 ? (
                        <div className="provider-group">
                          <h4 className="provider-group-title">{t("settings.providers.shared")}</h4>
                          <div className="settings-list">
                            {sharedProviders.map(renderProviderCard)}
                          </div>
                        </div>
                      ) : null}
                      {privateProviders.length > 0 ? (
                        <div className="provider-group">
                          <h4 className="provider-group-title">{t("settings.providers.private")}</h4>
                          <div className="settings-list">
                            {privateProviders.map(renderProviderCard)}
                          </div>
                        </div>
                      ) : null}
                    </>
                  );
                })()}
              </section>
            ) : null}

            {activeTab === "mcp" ? (
              <>
                <BuiltinToolsSection />
                <section className="settings-section">
                <div className="settings-section__header">
                  <div>
                    <h3>{t("settings.mcp.title")}</h3>
                    <p>{t("settings.mcp.desc")}</p>
                  </div>
                  <button className="settings-button" onClick={openMcpForm} type="button">
                    {t("settings.mcp.addServer")}
                  </button>
                </div>
                {mcpServers.length === 0 ? (
                  <div className="settings-empty">
                    <Plug size={22} />
                    <strong>{t("settings.mcp.empty")}</strong>
                    <p>{t("settings.mcp.emptyHint")}</p>
                    <button className="settings-button" onClick={openMcpForm} type="button">
                      {t("settings.mcp.addServer")}
                    </button>
                  </div>
                ) : (
                  <div className="settings-list">
                    {mcpServers.map((server) => {
                      // #377: platform-managed presets get no Edit / Delete and no raw
                      // URL; a BYOK card appears only when the deployment actually
                      // serves the endpoint and advertises this entry's `kind`.
                      const view = resolveMcpEntryView(server, mcpByokStatus);
                      return (
                        <article className="settings-list-item" key={server.name}>
                          <div>
                            <strong>
                              {server.name}
                              <span className={`mcp-transport-chip mcp-transport-chip--${server.type}`}>{server.type}</span>
                              {view.managed ? (
                                <span className="mcp-transport-chip mcp-transport-chip--preset">
                                  {t("settings.mcp.presetChip")}
                                </span>
                              ) : null}
                            </strong>
                            <span>{mcpSubtitle(view.subtitle)}</span>
                          </div>
                          {view.managed ? (
                            <span className="mcp-preset-note">{t("settings.mcp.presetManaged")}</span>
                          ) : (
                            <div className="settings-list-item__actions mcp-actions">
                              <button onClick={() => editMcpServer(server)} type="button">{t("settings.mcp.edit")}</button>
                              <button onClick={() => void removeMcpServer(server.name)} type="button">{t("settings.mcp.remove")}</button>
                            </div>
                          )}
                          {view.byok ? (
                            <McpByokCard
                              configured={view.byok.configured}
                              kind={view.byok.kind}
                              onChanged={refreshMcpByok}
                            />
                          ) : null}
                        </article>
                      );
                    })}
                  </div>
                )}
                </section>
              </>
            ) : null}

            {runtimeConfig.knowledgeBaseSettingsEnabled && activeTab === "knowledgeBase" ? (
              <KnowledgeBasePanel />
            ) : null}

            {activeTab === "preferences" ? (
              <section className="settings-section">
                <h3>{t("settings.prefs.title")}</h3>

                <div className="settings-group">
                  <h4 className="settings-group__title">{t("settings.prefs.groupAppearance")}</h4>
                  <div className="settings-field settings-field--split">
                    <div className="settings-field__label">
                      <span>{t("settings.prefs.theme")}</span>
                      <small>{t("settings.prefs.themeDesc")}</small>
                    </div>
                    <CustomSelect
                      ariaLabel={t("settings.prefs.theme")}
                      onChange={(value) => preferences.setTheme(value as typeof preferences.theme)}
                      options={[
                        { label: t("settings.prefs.themeLight"), value: "light" },
                        { label: t("settings.prefs.themeDark"), value: "dark" },
                        { label: t("settings.prefs.themeSystem"), value: "system" },
                      ]}
                      value={preferences.theme}
                    />
                  </div>
                  <div className="settings-field settings-field--split">
                    <div className="settings-field__label">
                      <span>{t("settings.prefs.language")}</span>
                      <small>{t("settings.prefs.languageDesc")}</small>
                    </div>
                    <CustomSelect
                      ariaLabel={t("settings.prefs.language")}
                      onChange={(value) => preferences.setLanguage(value as typeof preferences.language)}
                      options={[
                        { label: "简体中文", value: "zh-CN" },
                        { label: "English", value: "en-US" },
                      ]}
                      value={preferences.language}
                    />
                  </div>
                </div>

                <div className="settings-group">
                  <h4 className="settings-group__title">{t("settings.prefs.groupBehavior")}</h4>
                  <label className="settings-toggle-row">
                    <span className="settings-toggle-row__text">
                      <span>{t("settings.prefs.confirmDangerous")}</span>
                      <small>{t("settings.prefs.confirmDangerousDesc")}</small>
                    </span>
                    <input
                      checked={preferences.security.confirmDangerousActions}
                      onChange={(event) => preferences.setSecurity({ ...preferences.security, confirmDangerousActions: event.target.checked })}
                      type="checkbox"
                    />
                  </label>
                  <label className="settings-toggle-row">
                    <span className="settings-toggle-row__text">
                      <span>{t("settings.prefs.notifyDone")}</span>
                      <small>{t("settings.prefs.notifyDoneDesc")}</small>
                    </span>
                    <input
                      checked={preferences.notifications.agentDone}
                      onChange={(event) => preferences.setNotifications({ ...preferences.notifications, agentDone: event.target.checked })}
                      type="checkbox"
                    />
                  </label>
                </div>
              </section>
            ) : null}
          </div>
        </div>

        {version ? (
          <footer className="settings-modal__footer">
            <span className="settings-version">{version}</span>
          </footer>
        ) : null}
      </section>

      {isProviderFormOpen ? (
        <div
          className="provider-form-modal"
          ref={providerDialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="provider-form-title"
        >
          <div className="provider-form-modal__backdrop" onClick={closeProviderForm} />
          <form className="provider-form provider-form--modal" onSubmit={saveProvider} noValidate>
            <header className="provider-form-modal__header">
              <div>
                <span className="settings-modal__eyebrow">{t("settings.providerForm.eyebrow")}</span>
                <h3 id="provider-form-title">
                  {editingProviderId ? t("settings.providerForm.editTitle") : t("settings.providerForm.addTitle")}
                </h3>
              </div>
              <IconButton label={t("settings.providerForm.close")} onClick={closeProviderForm}>
                <X size={15} />
              </IconButton>
            </header>

            <div className="provider-form__grid">
              <label>
                <span>
                  {t("settings.providerForm.name")}
                  <span className="provider-form__required" aria-hidden="true">
                    {" "}
                    *
                  </span>
                </span>
                <input
                  ref={providerNameInputRef}
                  id="provider-form-name"
                  placeholder="Anthropic"
                  required
                  aria-required="true"
                  aria-invalid={showProviderValidation && providerFieldErrors.name ? true : undefined}
                  aria-describedby={
                    showProviderValidation && providerFieldErrors.name
                      ? "provider-form-name-error"
                      : undefined
                  }
                  value={providerForm.name}
                  onChange={(event) => {
                    setProviderForm({ ...providerForm, name: event.target.value });
                    if (showProviderValidation) {
                      setProviderFieldErrors(
                        validateProviderForm(
                          { ...providerForm, name: event.target.value },
                          { isEdit: Boolean(editingProviderId) },
                        ).errors,
                      );
                    }
                  }}
                />
                {showProviderValidation && providerFieldErrors.name ? (
                  <span id="provider-form-name-error" className="provider-form__error" role="alert">
                    {t(providerFieldErrorKey("name"))}
                  </span>
                ) : null}
              </label>
              <label>
                <span>
                  {t("settings.providerForm.baseUrl")}
                  <span className="provider-form__required" aria-hidden="true">
                    {" "}
                    *
                  </span>
                </span>
                <input
                  id="provider-form-baseUrl"
                  placeholder="https://api.anthropic.com"
                  required
                  aria-required="true"
                  aria-invalid={showProviderValidation && providerFieldErrors.baseUrl ? true : undefined}
                  aria-describedby={
                    showProviderValidation && providerFieldErrors.baseUrl
                      ? "provider-form-baseUrl-error"
                      : undefined
                  }
                  value={providerForm.baseUrl}
                  onChange={(event) => {
                    setProviderForm({ ...providerForm, baseUrl: event.target.value });
                    if (showProviderValidation) {
                      setProviderFieldErrors(
                        validateProviderForm(
                          { ...providerForm, baseUrl: event.target.value },
                          { isEdit: Boolean(editingProviderId) },
                        ).errors,
                      );
                    }
                  }}
                />
                {showProviderValidation && providerFieldErrors.baseUrl ? (
                  <span id="provider-form-baseUrl-error" className="provider-form__error" role="alert">
                    {t(providerFieldErrorKey("baseUrl"))}
                  </span>
                ) : null}
              </label>
              <div className="provider-form__field">
                <span>{t("settings.providerForm.protocol")}</span>
                <CustomSelect
                  ariaLabel={t("settings.providerForm.protocolAria")}
                  onChange={(value) => setProviderForm({ ...providerForm, api: value as ProviderApi })}
                  options={[
                    { label: "Anthropic Messages", value: "anthropic-messages" },
                    { label: "OpenAI Completions", value: "openai-completions" },
                    { label: "OpenAI Responses", value: "openai-responses" },
                    { label: "Azure OpenAI Responses", value: "azure-openai-responses" },
                  ]}
                  value={providerForm.api}
                />
              </div>
              <label className="provider-form__key">
                <span>
                  {t("settings.providerForm.apiKey")}{" "}
                  {editingProviderId ? t("settings.providerForm.apiKeyKeep") : (
                    <span className="provider-form__required" aria-hidden="true">
                      *
                    </span>
                  )}
                </span>
                <input
                  id="provider-form-apiKey"
                  placeholder={editingProviderId ? (providerForm.apiKeyMasked || "****") : ""}
                  required={!editingProviderId}
                  aria-required={!editingProviderId ? true : undefined}
                  aria-invalid={showProviderValidation && providerFieldErrors.apiKey ? true : undefined}
                  aria-describedby={
                    showProviderValidation && providerFieldErrors.apiKey
                      ? "provider-form-apiKey-error"
                      : undefined
                  }
                  type={showProviderKey ? "text" : "password"}
                  value={providerForm.apiKey}
                  onChange={(event) => {
                    setProviderForm({ ...providerForm, apiKey: event.target.value });
                    if (showProviderValidation) {
                      setProviderFieldErrors(
                        validateProviderForm(
                          { ...providerForm, apiKey: event.target.value },
                          { isEdit: Boolean(editingProviderId) },
                        ).errors,
                      );
                    }
                  }}
                />
                <button aria-label={showProviderKey ? t("settings.providerForm.hideKey") : t("settings.providerForm.showKey")} onClick={() => setShowProviderKey((current) => !current)} type="button">
                  {showProviderKey ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
                {showProviderValidation && providerFieldErrors.apiKey ? (
                  <span id="provider-form-apiKey-error" className="provider-form__error" role="alert">
                    {t(providerFieldErrorKey("apiKey"))}
                  </span>
                ) : null}
              </label>
              <label>
                <span>{t("settings.providerForm.notes")}</span>
                <input placeholder={t("settings.providerForm.notesPlaceholder")} value={providerForm.notes} onChange={(event) => setProviderForm({ ...providerForm, notes: event.target.value })} />
              </label>
            </div>

            <div className="provider-form__models">
              <div className="provider-form__models-header">
                <span>
                  {t("settings.providerForm.models")}
                  <span className="provider-form__required" aria-hidden="true">
                    {" "}
                    *
                  </span>
                </span>
                <button onClick={addProviderModel} type="button">
                  <Plus size={13} />
                  {t("settings.providerForm.addModel")}
                </button>
              </div>
              <div
                className="provider-model-list"
                aria-invalid={showProviderValidation && providerFieldErrors.models ? true : undefined}
                aria-describedby={
                  showProviderValidation && providerFieldErrors.models
                    ? "provider-form-models-error"
                    : undefined
                }
              >
                {providerForm.models.map((model, index) => (
                  <label className="provider-model-row" key={`${index}-${providerForm.models.length}`}>
                    <input
                      placeholder={EXAMPLE_MODEL}
                      value={model}
                      aria-required="true"
                      onChange={(event) => {
                        updateProviderModel(index, event.target.value);
                        if (showProviderValidation) {
                          const nextModels = providerForm.models.map((m, i) =>
                            i === index ? event.target.value : m,
                          );
                          setProviderFieldErrors(
                            validateProviderForm(
                              { ...providerForm, models: nextModels },
                              { isEdit: Boolean(editingProviderId) },
                            ).errors,
                          );
                        }
                      }}
                    />
                    <button
                      aria-label={t("settings.providerForm.removeModel")}
                      disabled={providerForm.models.length <= 1}
                      onClick={() => removeProviderModel(index)}
                      type="button"
                    >
                      <Trash2 size={14} />
                    </button>
                  </label>
                ))}
              </div>
              {showProviderValidation && providerFieldErrors.models ? (
                <span id="provider-form-models-error" className="provider-form__error" role="alert">
                  {t(providerFieldErrorKey("models"))}
                </span>
              ) : (
                <p className="provider-form__models-hint">
                  {t("settings.providerForm.modelsHint")}
                </p>
              )}
            </div>

            <div className="provider-form__appearance">
              <div>
                <span>{t("settings.providerForm.color")}</span>
                <div className="provider-color-row">
                  {colorOptions.map((color) => (
                    <button
                      aria-label={t("settings.providerForm.useColor", { color })}
                      className={providerForm.iconColor === color ? "is-selected" : ""}
                      key={color}
                      onClick={() => setProviderForm({ ...providerForm, iconColor: color })}
                      style={{ backgroundColor: color }}
                      type="button"
                    />
                  ))}
                </div>
              </div>
            </div>

            <div className="settings-actions provider-form-modal__actions">
              <button className="settings-button settings-button--ghost" onClick={closeProviderForm} type="button">{t("settings.providerForm.cancel")}</button>
              <button
                className="settings-button"
                type="submit"
                aria-disabled={!canSubmitProvider}
              >
                {editingProviderId ? t("settings.providerForm.save") : t("settings.providerForm.addTitle")}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {isMcpFormOpen ? (
        <div
          className="provider-form-modal"
          ref={mcpDialogRef}
          role="dialog"
          aria-modal="true"
          aria-label={editingMcpName ? t("settings.mcpForm.editAria") : t("settings.mcpForm.addAria")}
        >
          <div className="provider-form-modal__backdrop" onClick={closeMcpForm} />
          <form className="provider-form provider-form--modal mcp-form--modal" onSubmit={saveMcpServer}>
            <header className="provider-form-modal__header">
              <div>
                <span className="settings-modal__eyebrow">{t("settings.mcpForm.eyebrow")}</span>
                <h3>{editingMcpName ? t("settings.mcpForm.editTitle") : t("settings.mcpForm.addTitle")}</h3>
              </div>
              <IconButton label={t("settings.mcpForm.close")} onClick={closeMcpForm}>
                <X size={15} />
              </IconButton>
            </header>

            <div className="provider-form__grid">
              <label>
                <span>{t("settings.mcpForm.name")}</span>
                <input
                  disabled={!!editingMcpName}
                  placeholder="filesystem"
                  required
                  value={mcpForm.name}
                  onChange={(event) => setMcpForm({ ...mcpForm, name: event.target.value })}
                />
              </label>
              <div className="provider-form__field">
                <span>{t("settings.mcpForm.transport")}</span>
                <CustomSelect
                  ariaLabel={t("settings.mcpForm.transportAria")}
                  onChange={(value) => setMcpForm({ ...mcpForm, type: value as McpServerEntry["type"] })}
                  options={[
                    { label: "stdio", value: "stdio" },
                    { label: "http", value: "http" },
                    { label: "sse", value: "sse" },
                  ]}
                  value={mcpForm.type}
                />
              </div>
              {mcpForm.type === "stdio" ? (
                <>
                  <label>
                    <span>{t("settings.mcpForm.command")}</span>
                    <input
                      placeholder="npx"
                      required
                      value={mcpForm.command}
                      onChange={(event) => setMcpForm({ ...mcpForm, command: event.target.value })}
                    />
                  </label>
                  <label>
                    <span>{t("settings.mcpForm.arguments")}</span>
                    <input
                      placeholder="-y, @modelcontextprotocol/server-filesystem, /workspace"
                      value={mcpForm.args}
                      onChange={(event) => setMcpForm({ ...mcpForm, args: event.target.value })}
                    />
                  </label>
                </>
              ) : (
                <label className="mcp-form__wide">
                  <span>{t("settings.mcpForm.url")}</span>
                  <input
                    placeholder="https://example.com/mcp"
                    required
                    value={mcpForm.url}
                    onChange={(event) => setMcpForm({ ...mcpForm, url: event.target.value })}
                  />
                </label>
              )}
            </div>

            <div className="settings-actions provider-form-modal__actions">
              <button className="settings-button settings-button--ghost" onClick={closeMcpForm} type="button">{t("settings.mcpForm.cancel")}</button>
              <button className="settings-button" type="submit">{editingMcpName ? t("settings.mcpForm.save") : t("settings.mcpForm.addTitle")}</button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
