import { FormEvent, useEffect, useState } from "react";
import { Check, Database, Eye, EyeOff, Loader2, Plug, Plus, Settings, SlidersHorizontal, Trash2, UserRound, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { McpServerEntry, ProviderProfile, ProviderApi } from "../../contracts/backend";
import { useAuth } from "../../contexts/AuthContext";
import { usePreferences } from "../../contexts/PreferencesContext";
import { useT } from "../../i18n/useT";
import { api } from "../../utils/api";
import { EXAMPLE_MODEL } from "@brainpilot/protocol";
import { CustomSelect } from "../primitives/CustomSelect";
import { IconButton } from "../primitives/IconButton";
import { KnowledgeBasePanel } from "./KnowledgeBasePanel";

type SettingsTab = "account" | "providers" | "mcp" | "knowledgeBase" | "preferences";

type SettingsDialogProps = {
  isOpen: boolean;
  onClose: () => void;
};

const tabs: Array<{ id: SettingsTab; labelKey: string; icon: LucideIcon }> = [
  { id: "account", labelKey: "settings.tab.account", icon: UserRound },
  { id: "providers", labelKey: "settings.tab.providers", icon: SlidersHorizontal },
  { id: "mcp", labelKey: "settings.tab.mcp", icon: Plug },
  { id: "knowledgeBase", labelKey: "settings.tab.knowledgeBase", icon: Database },
  { id: "preferences", labelKey: "settings.tab.preferences", icon: Settings },
];

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

export function SettingsDialog({ isOpen, onClose }: SettingsDialogProps) {
  const { user } = useAuth();
  const preferences = usePreferences();
  const t = useT();
  const [activeTab, setActiveTab] = useState<SettingsTab>("account");
  const [providers, setProviders] = useState<ProviderProfile[]>([]);
  const [mcpServers, setMcpServers] = useState<McpServerEntry[]>([]);
  const [providerForm, setProviderForm] = useState(DEFAULT_PROVIDER_FORM);
  const [editingProviderId, setEditingProviderId] = useState<string | null>(null);
  const [isProviderFormOpen, setIsProviderFormOpen] = useState(false);
  const [showProviderKey, setShowProviderKey] = useState(false);
  const [mcpForm, setMcpForm] = useState(DEFAULT_MCP_FORM);
  const [editingMcpName, setEditingMcpName] = useState<string | null>(null);
  const [isMcpFormOpen, setIsMcpFormOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState<string | null>(null);
  const [testingProviderId, setTestingProviderId] = useState<string | null>(null);

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
      const [nextProviders, nextMcpServers, healthProfiles] = await Promise.all([
        api.providers.list(),
        api.mcpServers.list(),
        api.providers.health().catch(() => [] as ProviderProfile[]),
      ]);
      setProviders(mergeHealth(nextProviders, healthProfiles));
      setMcpServers(nextMcpServers);
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
      const [nextProviders, nextMcpServers, healthProfiles] = await Promise.all([
        api.providers.list(),
        api.mcpServers.list(),
        api.providers.health().catch(() => [] as ProviderProfile[]),
      ]);
      setProviders(mergeHealth(nextProviders, healthProfiles));
      setMcpServers(nextMcpServers);
    } catch {
      // ignore silent refresh errors
    }
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
      void loadSettings();
      void api.getVersion().then((v) => setVersion(v.version)).catch(() => setVersion(null));
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || activeTab !== "providers") return;
    const id = window.setInterval(() => void refreshSettingsSilent(), 30000);
    return () => window.clearInterval(id);
  }, [isOpen, activeTab]);

  if (!isOpen) {
    return null;
  }

  const emitProviderUpdated = () => {
    window.dispatchEvent(new Event(PROVIDER_UPDATED_EVENT));
  };

  const openProviderForm = () => {
    setEditingProviderId(null);
    setProviderForm(DEFAULT_PROVIDER_FORM);
    setShowProviderKey(false);
    setIsProviderFormOpen(true);
  };

  const closeProviderForm = () => {
    setEditingProviderId(null);
    setProviderForm(DEFAULT_PROVIDER_FORM);
    setShowProviderKey(false);
    setIsProviderFormOpen(false);
  };

  const saveProvider = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    const models = providerForm.models.map((model) => model.trim()).filter(Boolean);
    if (!models.length) {
      setError(t("settings.providers.modelRequired"));
      return;
    }
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
    await api.mcpServers.remove(name);
    setMcpServers((current) => current.filter((server) => server.name !== name));
  };

  return (
    <div className="settings-modal" role="dialog" aria-label={t("settings.aria.dialog")}>
      <div className="settings-modal__backdrop" onClick={onClose} />
      <section className="settings-modal__panel">
        <header className="settings-modal__header">
          <div>
            <span className="settings-modal__eyebrow">{t("settings.eyebrow.workspace")}</span>
            <h2>{t("settings.title")}</h2>
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
                {version ? <span className="settings-version">{version}</span> : null}
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
                <div className="settings-list">
                  {mcpServers.map((server) => (
                    <article className="settings-list-item" key={server.name}>
                      <div>
                        <strong>{server.name}</strong>
                        <span>{server.type === "stdio" ? [server.command, ...(server.args || [])].filter(Boolean).join(" ") : server.url}</span>
                        <small>{server.type}</small>
                      </div>
                      <div className="settings-list-item__actions mcp-actions">
                        <button onClick={() => editMcpServer(server)} type="button">{t("settings.mcp.edit")}</button>
                        <button onClick={() => void removeMcpServer(server.name)} type="button">{t("settings.mcp.remove")}</button>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            ) : null}

            {activeTab === "knowledgeBase" ? <KnowledgeBasePanel /> : null}

            {activeTab === "preferences" ? (
              <section className="settings-section">
                <h3>{t("settings.prefs.title")}</h3>
                <div className="settings-field">
                  <span>{t("settings.prefs.theme")}</span>
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
                <div className="settings-field">
                  <span>{t("settings.prefs.language")}</span>
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
                <label className="settings-check">
                  <input
                    checked={preferences.security.confirmDangerousActions}
                    onChange={(event) => preferences.setSecurity({ ...preferences.security, confirmDangerousActions: event.target.checked })}
                    type="checkbox"
                  />
                  <span>{t("settings.prefs.confirmDangerous")}</span>
                </label>
                <label className="settings-check">
                  <input
                    checked={preferences.notifications.agentDone}
                    onChange={(event) => preferences.setNotifications({ ...preferences.notifications, agentDone: event.target.checked })}
                    type="checkbox"
                  />
                  <span>{t("settings.prefs.notifyDone")}</span>
                </label>
              </section>
            ) : null}
          </div>
        </div>
      </section>

      {isProviderFormOpen ? (
        <div className="provider-form-modal" role="dialog" aria-label={editingProviderId ? t("settings.providerForm.editAria") : t("settings.providerForm.addAria")}>
          <div className="provider-form-modal__backdrop" onClick={closeProviderForm} />
          <form className="provider-form provider-form--modal" onSubmit={saveProvider}>
            <header className="provider-form-modal__header">
              <div>
                <span className="settings-modal__eyebrow">{t("settings.providerForm.eyebrow")}</span>
                <h3>{editingProviderId ? t("settings.providerForm.editTitle") : t("settings.providerForm.addTitle")}</h3>
              </div>
              <IconButton label={t("settings.providerForm.close")} onClick={closeProviderForm}>
                <X size={15} />
              </IconButton>
            </header>

            <div className="provider-form__grid">
              <label>
                <span>{t("settings.providerForm.name")}</span>
                <input placeholder="Anthropic" required value={providerForm.name} onChange={(event) => setProviderForm({ ...providerForm, name: event.target.value })} />
              </label>
              <label>
                <span>{t("settings.providerForm.baseUrl")}</span>
                <input placeholder="https://api.anthropic.com" required value={providerForm.baseUrl} onChange={(event) => setProviderForm({ ...providerForm, baseUrl: event.target.value })} />
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
                <span>{t("settings.providerForm.apiKey")} {editingProviderId ? t("settings.providerForm.apiKeyKeep") : ""}</span>
                <input
                  placeholder={editingProviderId ? (providerForm.apiKeyMasked || "****") : ""}
                  required={!editingProviderId}
                  type={showProviderKey ? "text" : "password"}
                  value={providerForm.apiKey}
                  onChange={(event) => setProviderForm({ ...providerForm, apiKey: event.target.value })}
                />
                <button aria-label={showProviderKey ? t("settings.providerForm.hideKey") : t("settings.providerForm.showKey")} onClick={() => setShowProviderKey((current) => !current)} type="button">
                  {showProviderKey ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </label>
              <label>
                <span>{t("settings.providerForm.notes")}</span>
                <input placeholder={t("settings.providerForm.notesPlaceholder")} value={providerForm.notes} onChange={(event) => setProviderForm({ ...providerForm, notes: event.target.value })} />
              </label>
            </div>

            <div className="provider-form__models">
              <div className="provider-form__models-header">
                <span>{t("settings.providerForm.models")}</span>
                <button onClick={addProviderModel} type="button">
                  <Plus size={13} />
                  {t("settings.providerForm.addModel")}
                </button>
              </div>
              <div className="provider-model-list">
                {providerForm.models.map((model, index) => (
                  <label className="provider-model-row" key={`${index}-${providerForm.models.length}`}>
                    <input
                      placeholder={EXAMPLE_MODEL}
                      value={model}
                      onChange={(event) => updateProviderModel(index, event.target.value)}
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
              <p className="provider-form__models-hint">
                {t("settings.providerForm.modelsHint")}
              </p>
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
              <button className="settings-button" type="submit">{editingProviderId ? t("settings.providerForm.save") : t("settings.providerForm.addTitle")}</button>
            </div>
          </form>
        </div>
      ) : null}

      {isMcpFormOpen ? (
        <div className="provider-form-modal" role="dialog" aria-label={editingMcpName ? t("settings.mcpForm.editAria") : t("settings.mcpForm.addAria")}>
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
