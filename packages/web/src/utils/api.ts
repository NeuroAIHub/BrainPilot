import {
  AgentStatus,
  AuthToken,
  FileContent,
  FileEntry,
  McpServerEntry,
  ProviderCreate,
  ProviderProfile,
  ProviderUpdate,
  Sandbox,
  SandboxStats,
  Session,
  SessionMessageEntry,
  SessionStateSnapshot,
  SettingsData,
  TraceGraph,
  normalizeFileContent,
  normalizeFileEntry,
  normalizeMcpServer,
  normalizeProviderProfile,
  normalizeSandbox,
  normalizeSandboxStats,
  normalizeSession,
  normalizeSessionState,
  normalizeSettings,
  normalizeToken,
  normalizeTraceGraph,
  normalizeUser,
  serializeMcpConfig,
  serializeProviderCreate,
  serializeProviderUpdate,
  serializeSettings,
  User,
} from "../contracts/backend";
import { runtimeConfig } from "../config";
import { mockBackend } from "../mocks/backend";
import { RawAgUiEvent } from "../contracts/demoBundle";

const API_BASE = "/api";
const TOKEN_KEY = "mas_access_token";

export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_KEY) || localStorage.getItem("token");
}

export function storeToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem("token", token);
}

export function clearStoredToken(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem("token");
}

function authHeaders(json = true): Record<string, string> {
  const token = getStoredToken();
  return {
    ...(json ? { "Content-Type": "application/json" } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function parseError(res: Response): Promise<string> {
  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const body = (await res.json().catch(() => null)) as { detail?: unknown } | null;
    if (typeof body?.detail === "string") {
      return body.detail;
    }
  }
  const text = await res.text().catch(() => "");
  return text || `Request failed (${res.status})`;
}

async function handleJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    throw new Error(await parseError(res));
  }
  if (res.status === 204) {
    return undefined as T;
  }
  return (await res.json()) as T;
}

export function getSSEUrl(sessionId: string, token: string): string {
  // Same origin; relative path lets EventSource follow the current host/port.
  return `${API_BASE}/sessions/${encodeURIComponent(sessionId)}/sse?token=${encodeURIComponent(token)}`;
}

export function getTerminalWsUrl(sandboxId: string, token: string, cols = 80, rows = 24): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const params = new URLSearchParams({ token, cols: String(cols), rows: String(rows) });
  return `${protocol}//${window.location.host}${API_BASE}/sandbox/${sandboxId}/terminal?${params}`;
}

export const api = {
  async getVersion(): Promise<{ version: string }> {
    if (runtimeConfig.useMockBackend) {
      return mockBackend.version();
    }
    return handleJson(await fetch(`${API_BASE}/version`));
  },

  auth: {
    async login(username: string, password: string): Promise<AuthToken> {
      if (runtimeConfig.useMockBackend) {
        return mockBackend.login(username, password);
      }
      const raw = await handleJson<unknown>(
        await fetch(`${API_BASE}/auth/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username, password }),
        }),
      );
      return normalizeToken(raw as Parameters<typeof normalizeToken>[0]);
    },

    async register(username: string, password: string): Promise<AuthToken> {
      if (runtimeConfig.useMockBackend) {
        return mockBackend.register(username, password);
      }
      const raw = await handleJson<unknown>(
        await fetch(`${API_BASE}/auth/register`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username, password }),
        }),
      );
      return normalizeToken(raw as Parameters<typeof normalizeToken>[0]);
    },

    async me(): Promise<User> {
      if (runtimeConfig.useMockBackend) {
        return mockBackend.me();
      }
      const raw = await handleJson<unknown>(await fetch(`${API_BASE}/auth/me`, { headers: authHeaders() }));
      return normalizeUser(raw as Parameters<typeof normalizeUser>[0]);
    },
  },

  sandbox: {
    async list(): Promise<Sandbox[]> {
      if (runtimeConfig.useMockBackend) {
        return mockBackend.listSandboxes();
      }
      const raw = await handleJson<unknown[]>(await fetch(`${API_BASE}/sandbox/list`, { headers: authHeaders() }));
      return raw.map((item) => normalizeSandbox(item as Parameters<typeof normalizeSandbox>[0]));
    },

    async create(sandboxName = "default"): Promise<Sandbox> {
      if (runtimeConfig.useMockBackend) {
        return mockBackend.createSandbox(sandboxName);
      }
      const raw = await handleJson<unknown>(
        await fetch(`${API_BASE}/sandbox/create`, {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify({ sandbox_name: sandboxName }),
        }),
      );
      return normalizeSandbox(raw as Parameters<typeof normalizeSandbox>[0]);
    },

    async rebuild(sandboxId: string): Promise<Sandbox> {
      if (runtimeConfig.useMockBackend) {
        return mockBackend.rebuildSandbox();
      }
      const params = new URLSearchParams({ sandbox_id: sandboxId });
      const raw = await handleJson<unknown>(
        await fetch(`${API_BASE}/sandbox/rebuild?${params}`, {
          method: "POST",
          headers: authHeaders(),
        }),
      );
      return normalizeSandbox(raw as Parameters<typeof normalizeSandbox>[0]);
    },

    async destroy(sandboxId: string): Promise<void> {
      if (runtimeConfig.useMockBackend) {
        return mockBackend.destroySandbox();
      }
      await handleJson<void>(
        await fetch(`${API_BASE}/sandbox/${sandboxId}`, {
          method: "DELETE",
          headers: authHeaders(),
        }),
      );
    },

    async stats(sandboxId: string): Promise<SandboxStats> {
      if (runtimeConfig.useMockBackend) {
        return mockBackend.sandboxStats();
      }
      const raw = await handleJson<unknown>(
        await fetch(`${API_BASE}/sandbox/${sandboxId}/stats`, { headers: authHeaders() }),
      );
      return normalizeSandboxStats(raw);
    },

    async logs(sandboxId: string, tail = 200): Promise<string> {
      if (runtimeConfig.useMockBackend) {
        return mockBackend.sandboxLogs();
      }
      const params = new URLSearchParams({ tail: String(tail) });
      const raw = await handleJson<{ logs?: string }>(
        await fetch(`${API_BASE}/sandbox/${sandboxId}/logs?${params}`, { headers: authHeaders() }),
      );
      return raw.logs || "";
    },

    async reloadConfig(sandboxId: string): Promise<{ status: string }> {
      if (runtimeConfig.useMockBackend) {
        return { status: 'ok' }
      }
      const res = await fetch(`${API_BASE}/sandbox/reload-config?sandbox_id=${sandboxId}`, {
        method: 'POST',
        headers: authHeaders(),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.detail || `Reload failed (${res.status})`)
      }
      return handleJson(res)
    },

    async health(sandboxId: string): Promise<Record<string, unknown>> {
      if (runtimeConfig.useMockBackend) {
        return mockBackend.sandboxHealth();
      }
      return handleJson<Record<string, unknown>>(
        await fetch(`${API_BASE}/sandbox/${sandboxId}/health`, { headers: authHeaders() }),
      );
    },

    async listFiles(sandboxId: string, path = "/workspace"): Promise<FileEntry[]> {
      if (runtimeConfig.useMockBackend) {
        return mockBackend.listFiles(sandboxId, path);
      }
      const params = new URLSearchParams({ path });
      const raw = await handleJson<unknown[]>(
        await fetch(`${API_BASE}/sandbox/${sandboxId}/files?${params}`, { headers: authHeaders() }),
      );
      return raw.map((item) => normalizeFileEntry(item as Parameters<typeof normalizeFileEntry>[0]));
    },

    async readFile(sandboxId: string, path: string): Promise<FileContent> {
      if (runtimeConfig.useMockBackend) {
        return mockBackend.readFile(sandboxId, path);
      }
      const params = new URLSearchParams({ path });
      const raw = await handleJson<unknown>(
        await fetch(`${API_BASE}/sandbox/${sandboxId}/files/content?${params}`, { headers: authHeaders() }),
      );
      return normalizeFileContent(raw);
    },

    async readRawFile(sandboxId: string, path: string): Promise<Blob> {
      if (runtimeConfig.useMockBackend) {
        return mockBackend.readRawFile(sandboxId, path);
      }
      const params = new URLSearchParams({ path });
      const res = await fetch(`${API_BASE}/sandbox/${sandboxId}/files/raw?${params}`, {
        headers: authHeaders(false),
      });
      if (!res.ok) {
        throw new Error(await parseError(res));
      }
      return res.blob();
    },

    async readFileBlob(sandboxId: string, path: string): Promise<Blob> {
      return this.readRawFile(sandboxId, path);
    },

    async deleteFile(sandboxId: string, path: string): Promise<void> {
      if (runtimeConfig.useMockBackend) {
        return mockBackend.deleteFile(sandboxId, path);
      }
      const params = new URLSearchParams({ path });
      const res = await fetch(`${API_BASE}/sandbox/${sandboxId}/files?${params}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      if (!res.ok) {
        throw new Error(await parseError(res));
      }
    },
  },

  sessions: {
    async list(): Promise<Session[]> {
      if (runtimeConfig.useMockBackend) {
        return mockBackend.listSessions();
      }
      const raw = await handleJson<unknown[]>(await fetch(`${API_BASE}/sessions`, { headers: authHeaders() }));
      return raw.map((item) => normalizeSession(item as Parameters<typeof normalizeSession>[0]));
    },

    async get(sessionId: string): Promise<Session> {
      if (runtimeConfig.useMockBackend) {
        return mockBackend.getSession(sessionId);
      }
      const raw = await handleJson<unknown>(await fetch(`${API_BASE}/sessions/${sessionId}`, { headers: authHeaders() }));
      return normalizeSession(raw as Parameters<typeof normalizeSession>[0]);
    },

    async create(title = "New research session"): Promise<Session> {
      if (runtimeConfig.useMockBackend) {
        return mockBackend.createSession(title);
      }
      const raw = await handleJson<unknown>(
        await fetch(`${API_BASE}/sessions`, {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify({ title }),
        }),
      );
      return normalizeSession(raw as Parameters<typeof normalizeSession>[0]);
    },

    async update(sessionId: string, title: string): Promise<Session> {
      if (runtimeConfig.useMockBackend) {
        return mockBackend.updateSession(sessionId, title);
      }
      const raw = await handleJson<unknown>(
        await fetch(`${API_BASE}/sessions/${sessionId}`, {
          method: "PUT",
          headers: authHeaders(),
          body: JSON.stringify({ title }),
        }),
      );
      return normalizeSession(raw as Parameters<typeof normalizeSession>[0]);
    },

    async remove(sessionId: string): Promise<void> {
      if (runtimeConfig.useMockBackend) {
        return mockBackend.removeSession(sessionId);
      }
      await handleJson<void>(
        await fetch(`${API_BASE}/sessions/${sessionId}`, {
          method: "DELETE",
          headers: authHeaders(),
        }),
      );
    },

    async interrupt(sessionId: string): Promise<{ status: string }> {
      if (runtimeConfig.useMockBackend) {
        return { status: "ok" };
      }
      return handleJson<{ status: string }>(
        await fetch(`${API_BASE}/sessions/${sessionId}/messages`, {
          method: "POST",
          headers: { ...authHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({ type: "interrupt", session_id: sessionId }),
        }),
      );
    },

    async postMessage(
      sessionId: string,
      payload: { content: string; uuid: string; timestamp: string; type?: string },
    ): Promise<{ status: string }> {
      if (runtimeConfig.useMockBackend) {
        // Mock path: route through the existing mock helper if needed by the UI.
        return { status: "ok" };
      }
      return handleJson<{ status: string }>(
        await fetch(`${API_BASE}/sessions/${sessionId}/messages`, {
          method: "POST",
          headers: { ...authHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({
            type: payload.type ?? "user_message",
            content: payload.content,
            session_id: sessionId,
            data: { uuid: payload.uuid, timestamp: payload.timestamp },
          }),
        }),
      );
    },

    async commands(sessionId: string): Promise<{ commands: string[] }> {
      if (runtimeConfig.useMockBackend) {
        // ✅ 已通过真实 API 测试：/compact /context /cost 有效
        // ❌ 已移除：/usage（返回空） /clear /init（Unknown skill）
        return { commands: ["/compact", "/context", "/cost"] };
      }
      return handleJson<{ commands: string[] }>(
        await fetch(`${API_BASE}/sessions/${sessionId}/commands`, { headers: authHeaders() }),
      );
    },

    // 修正6 — answer an ask_user (user_input_request) prompt. Posts a
    // user_input_response back through the same /messages endpoint the
    // composer uses, carrying the request_id so the runtime can match it.
    async respondToInput(
      sessionId: string,
      payload: { requestId: string; answer: string },
    ): Promise<{ status: string }> {
      if (runtimeConfig.useMockBackend) {
        return { status: "ok" };
      }
      return handleJson<{ status: string }>(
        await fetch(`${API_BASE}/sessions/${sessionId}/messages`, {
          method: "POST",
          headers: { ...authHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "user_input_response",
            session_id: sessionId,
            request_id: payload.requestId,
            answer: payload.answer,
          }),
        }),
      );
    },

    async getTrace(sessionId: string): Promise<TraceGraph> {
      if (runtimeConfig.useMockBackend) {
        return mockBackend.getTrace(sessionId);
      }
      const raw = await handleJson<unknown>(
        await fetch(`${API_BASE}/sessions/${sessionId}/trace`, { headers: authHeaders() }),
      );
      return normalizeTraceGraph(raw);
    },

    async getEvents(sessionId: string): Promise<RawAgUiEvent[]> {
      if (runtimeConfig.useMockBackend) {
        return mockBackend.getSessionEvents(sessionId);
      }
      const raw = await handleJson<{ events?: unknown[] }>(
        await fetch(`${API_BASE}/sessions/${sessionId}/events`, { headers: authHeaders() }),
      );
      return Array.isArray(raw.events) ? (raw.events as RawAgUiEvent[]) : [];
    },

    async state(sessionId: string): Promise<SessionStateSnapshot> {
      if (runtimeConfig.useMockBackend) {
        return mockBackend.state();
      }
      const raw = await handleJson<unknown>(
        await fetch(`${API_BASE}/sessions/${sessionId}/state`, { headers: authHeaders() }),
      );
      return normalizeSessionState(raw);
    },
  },

  ui: {
    async promptSuggestions(): Promise<string[]> {
      if (runtimeConfig.useMockBackend) {
        return mockBackend.promptSuggestions();
      }
      return [];
    },
  },

  settings: {
    async get(): Promise<SettingsData> {
      if (runtimeConfig.useMockBackend) {
        return mockBackend.getSettings();
      }
      const raw = await handleJson<unknown>(await fetch(`${API_BASE}/settings`, { headers: authHeaders() }));
      return normalizeSettings(raw as Parameters<typeof normalizeSettings>[0]);
    },

    async update(data: Partial<SettingsData>): Promise<SettingsData> {
      if (runtimeConfig.useMockBackend) {
        return mockBackend.updateSettings(data);
      }
      const raw = await handleJson<unknown>(
        await fetch(`${API_BASE}/settings`, {
          method: "PUT",
          headers: authHeaders(),
          body: JSON.stringify(serializeSettings(data)),
        }),
      );
      return normalizeSettings(raw as Parameters<typeof normalizeSettings>[0]);
    },

    async resetConfig(): Promise<void> {
      if (runtimeConfig.useMockBackend) {
        return mockBackend.resetConfig();
      }
      await handleJson<void>(
        await fetch(`${API_BASE}/settings/reset-config`, {
          method: "POST",
          headers: authHeaders(),
        }),
      );
    },
  },

  mcpServers: {
    async list(): Promise<McpServerEntry[]> {
      if (runtimeConfig.useMockBackend) {
        return mockBackend.listMcpServers();
      }
      const raw = await handleJson<unknown[]>(await fetch(`${API_BASE}/mcp-servers`, { headers: authHeaders() }));
      return raw.map(normalizeMcpServer);
    },

    async add(name: string, config: Omit<McpServerEntry, "name">): Promise<McpServerEntry> {
      if (runtimeConfig.useMockBackend) {
        return mockBackend.addMcpServer(name, config);
      }
      const raw = await handleJson<unknown>(
        await fetch(`${API_BASE}/mcp-servers`, {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify({ name, config: serializeMcpConfig(config) }),
        }),
      );
      return normalizeMcpServer(raw);
    },

    async update(name: string, config: Omit<McpServerEntry, "name">): Promise<McpServerEntry> {
      if (runtimeConfig.useMockBackend) {
        return mockBackend.updateMcpServer(name, config);
      }
      const raw = await handleJson<unknown>(
        await fetch(`${API_BASE}/mcp-servers/${name}`, {
          method: "PUT",
          headers: authHeaders(),
          body: JSON.stringify(serializeMcpConfig(config)),
        }),
      );
      return normalizeMcpServer(raw);
    },

    async remove(name: string): Promise<void> {
      if (runtimeConfig.useMockBackend) {
        return mockBackend.removeMcpServer(name);
      }
      await handleJson<void>(
        await fetch(`${API_BASE}/mcp-servers/${name}`, {
          method: "DELETE",
          headers: authHeaders(),
        }),
      );
    },
  },

  providers: {
    async list(): Promise<ProviderProfile[]> {
      if (runtimeConfig.useMockBackend) {
        return mockBackend.listProviders();
      }
      const raw = await handleJson<unknown[]>(
        await fetch(`${API_BASE}/provider/profiles`, { headers: authHeaders() }),
      );
      return raw.map((item) => normalizeProviderProfile(item as Parameters<typeof normalizeProviderProfile>[0]));
    },

    async create(data: ProviderCreate): Promise<ProviderProfile> {
      if (runtimeConfig.useMockBackend) {
        return mockBackend.createProvider(data);
      }
      const raw = await handleJson<unknown>(
        await fetch(`${API_BASE}/provider/profiles`, {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify(serializeProviderCreate(data)),
        }),
      );
      return normalizeProviderProfile(raw as Parameters<typeof normalizeProviderProfile>[0]);
    },

    async update(id: string, data: ProviderUpdate): Promise<ProviderProfile> {
      if (runtimeConfig.useMockBackend) {
        return mockBackend.updateProvider(id, data);
      }
      const raw = await handleJson<unknown>(
        await fetch(`${API_BASE}/provider/profiles/${id}`, {
          method: "PUT",
          headers: authHeaders(),
          body: JSON.stringify(serializeProviderUpdate(data)),
        }),
      );
      return normalizeProviderProfile(raw as Parameters<typeof normalizeProviderProfile>[0]);
    },

    async remove(id: string): Promise<void> {
      if (runtimeConfig.useMockBackend) {
        return mockBackend.removeProvider(id);
      }
      await handleJson<void>(
        await fetch(`${API_BASE}/provider/profiles/${id}`, {
          method: "DELETE",
          headers: authHeaders(),
        }),
      );
    },

    async getActive(): Promise<ProviderProfile | null> {
      if (runtimeConfig.useMockBackend) {
        return mockBackend.getActiveProvider();
      }
      const res = await fetch(`${API_BASE}/provider/profiles/active`, { headers: authHeaders() });
      if (res.status === 204) {
        return null;
      }
      return normalizeProviderProfile((await handleJson<unknown>(res)) as Parameters<typeof normalizeProviderProfile>[0]);
    },

    async setActive(id: string): Promise<ProviderProfile> {
      if (runtimeConfig.useMockBackend) {
        return mockBackend.setActiveProvider(id);
      }
      const raw = await handleJson<unknown>(
        await fetch(`${API_BASE}/provider/profiles/active`, {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify({ id }),
        }),
      );
      return normalizeProviderProfile(raw as Parameters<typeof normalizeProviderProfile>[0]);
    },

    async health(): Promise<ProviderProfile[]> {
      if (runtimeConfig.useMockBackend) {
        return mockBackend.listProvidersHealth();
      }
      const raw = await handleJson<unknown[]>(
        await fetch(`${API_BASE}/provider/profiles/health`, { headers: authHeaders() }),
      );
      return raw.map((item) => normalizeProviderProfile(item as Parameters<typeof normalizeProviderProfile>[0]));
    },

    async test(id: string): Promise<ProviderProfile> {
      if (runtimeConfig.useMockBackend) {
        return mockBackend.testProvider(id);
      }
      const raw = await handleJson<unknown>(
        await fetch(`${API_BASE}/provider/profiles/${id}/test`, {
          method: "POST",
          headers: authHeaders(),
        }),
      );
      return normalizeProviderProfile(raw as Parameters<typeof normalizeProviderProfile>[0]);
    },
  },
};
