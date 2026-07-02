import {
  AgentStatus,
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

// Trust-front: the hosted gateway authenticates via an httpOnly cookie that the
// browser carries automatically. The frontend never reads, stores, or attaches a
// token — it just makes credentialed requests.
//
// #106: callers that drive composer state (postMessage / create) pass a
// `timeoutMs`. A hung request used to leave `isSending` true forever (the
// `finally` that resets it never ran), permanently disabling the composer and
// silently dropping the user's input. With a timeout the request rejects, the
// caller's catch surfaces a recoverable error, and `isSending` is released.
function apiFetch(
  input: RequestInfo | URL,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<Response> {
  const { timeoutMs, signal, ...rest } = init;
  if (timeoutMs == null) {
    return fetch(input, { credentials: "include", signal, ...rest });
  }
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  // Honour an upstream signal too, if one was supplied.
  const merged = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
  return fetch(input, { credentials: "include", signal: merged, ...rest });
}

/** #106: default ceiling for composer-driving requests (create / postMessage). */
const SEND_TIMEOUT_MS = 30_000;

function authHeaders(json = true): Record<string, string> {
  return json ? { "Content-Type": "application/json" } : {};
}

/**
 * #206: build a readable message from a Zod issue list. The backend returns
 * `details: parsed.error.issues` — each issue has a `path` (field) and a
 * `message`. We render `field: message` per issue so a validation 400 tells the
 * user *which* field is wrong (empty name, invalid url, …) instead of degrading
 * to a generic "Request failed (400)".
 */
function formatIssues(details: unknown): string | null {
  if (!Array.isArray(details) || details.length === 0) return null;
  const parts: string[] = [];
  for (const issue of details) {
    if (!issue || typeof issue !== "object") continue;
    const { path, message } = issue as { path?: unknown; message?: unknown };
    if (typeof message !== "string" || message.length === 0) continue;
    const field = Array.isArray(path) ? path.filter((p) => p !== "" && p != null).join(".") : "";
    parts.push(field ? `${field}: ${message}` : message);
  }
  return parts.length > 0 ? parts.join("; ") : null;
}

async function parseError(res: Response): Promise<string> {
  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    // #206: the backend uses two shapes — `{ detail }` (single string) and the
    // Zod validation shape `{ error, details }`. parseError previously read only
    // `detail`, so every `{ error, details }` 400/409 fell through to the generic
    // text fallback. Read all three: detail → error(+formatted details) → error.
    const body = (await res.json().catch(() => null)) as
      | { detail?: unknown; error?: unknown; details?: unknown }
      | null;
    if (typeof body?.detail === "string" && body.detail.length > 0) {
      return body.detail;
    }
    const issues = formatIssues(body?.details);
    if (typeof body?.error === "string" && body.error.length > 0) {
      return issues ? `${body.error} (${issues})` : body.error;
    }
    if (issues) return issues;
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

/** #47: encode a Blob/File as base64 (without the data: prefix) for upload. */
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("file read failed"));
    reader.onload = () => {
      const result = reader.result as string;
      // strip the "data:<mime>;base64," prefix
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.readAsDataURL(blob);
  });
}

export function getSSEUrl(sessionId: string): string {
  // Same origin; relative path lets EventSource follow the current host/port and
  // carry the auth cookie automatically — no token in the query string.
  return `${API_BASE}/sessions/${encodeURIComponent(sessionId)}/sse`;
}

export function getTerminalWsUrl(sandboxId: string, cols = 80, rows = 24): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const params = new URLSearchParams({ cols: String(cols), rows: String(rows) });
  return `${protocol}//${window.location.host}${API_BASE}/sandbox/${sandboxId}/terminal?${params}`;
}

export const api = {
  async getVersion(): Promise<{ version: string }> {
    if (runtimeConfig.useMockBackend) {
      return mockBackend.version();
    }
    return handleJson(await apiFetch(`${API_BASE}/version`));
  },

  // #156: real on-disk paths for the Files panel (local mode only). Hosted
  // backends return `{ localMode: false }` with no host path. Best-effort:
  // any failure resolves to a non-local shape so callers fall back cleanly.
  async getInfo(): Promise<{ localMode: boolean; dataDir?: string; workspacesRoot?: string }> {
    if (runtimeConfig.useMockBackend) {
      return { localMode: false };
    }
    try {
      return await handleJson(await apiFetch(`${API_BASE}/info`));
    } catch {
      return { localMode: false };
    }
  },

  auth: {
    async me(): Promise<User> {
      if (runtimeConfig.useMockBackend) {
        return mockBackend.me();
      }
      const raw = await handleJson<unknown>(await apiFetch(`${API_BASE}/auth/me`, { headers: authHeaders() }));
      return normalizeUser(raw as Parameters<typeof normalizeUser>[0]);
    },
  },

  sandbox: {
    async list(): Promise<Sandbox[]> {
      if (runtimeConfig.useMockBackend) {
        return mockBackend.listSandboxes();
      }
      const raw = await handleJson<unknown[]>(await apiFetch(`${API_BASE}/sandbox/list`, { headers: authHeaders() }));
      return raw.map((item) => normalizeSandbox(item as Parameters<typeof normalizeSandbox>[0]));
    },

    async create(sandboxName = "default"): Promise<Sandbox> {
      if (runtimeConfig.useMockBackend) {
        return mockBackend.createSandbox(sandboxName);
      }
      const raw = await handleJson<unknown>(
        await apiFetch(`${API_BASE}/sandbox/create`, {
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
        await apiFetch(`${API_BASE}/sandbox/rebuild?${params}`, {
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
        await apiFetch(`${API_BASE}/sandbox/${sandboxId}`, {
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
        await apiFetch(`${API_BASE}/sandbox/${sandboxId}/stats`, { headers: authHeaders() }),
      );
      return normalizeSandboxStats(raw);
    },

    async logs(sandboxId: string, tail = 200): Promise<string> {
      if (runtimeConfig.useMockBackend) {
        return mockBackend.sandboxLogs();
      }
      const params = new URLSearchParams({ tail: String(tail) });
      const raw = await handleJson<{ logs?: string }>(
        await apiFetch(`${API_BASE}/sandbox/${sandboxId}/logs?${params}`, { headers: authHeaders() }),
      );
      return raw.logs || "";
    },

    async reloadConfig(sandboxId: string): Promise<{ status: string }> {
      if (runtimeConfig.useMockBackend) {
        return { status: 'ok' }
      }
      const res = await apiFetch(`${API_BASE}/sandbox/reload-config?sandbox_id=${sandboxId}`, {
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
        await apiFetch(`${API_BASE}/sandbox/${sandboxId}/health`, { headers: authHeaders() }),
      );
    },

    async listFiles(sandboxId: string, path = "/workspace"): Promise<FileEntry[]> {
      if (runtimeConfig.useMockBackend) {
        return mockBackend.listFiles(sandboxId, path);
      }
      const params = new URLSearchParams({ path });
      const raw = await handleJson<unknown[]>(
        await apiFetch(`${API_BASE}/sandbox/${sandboxId}/files?${params}`, { headers: authHeaders() }),
      );
      return raw.map((item) => normalizeFileEntry(item as Parameters<typeof normalizeFileEntry>[0]));
    },

    async readFile(sandboxId: string, path: string): Promise<FileContent> {
      if (runtimeConfig.useMockBackend) {
        return mockBackend.readFile(sandboxId, path);
      }
      const params = new URLSearchParams({ path });
      const raw = await handleJson<unknown>(
        await apiFetch(`${API_BASE}/sandbox/${sandboxId}/files/content?${params}`, { headers: authHeaders() }),
      );
      return normalizeFileContent(raw);
    },

    async readRawFile(sandboxId: string, path: string): Promise<Blob> {
      if (runtimeConfig.useMockBackend) {
        return mockBackend.readRawFile(sandboxId, path);
      }
      const params = new URLSearchParams({ path });
      const res = await apiFetch(`${API_BASE}/sandbox/${sandboxId}/files/raw?${params}`, {
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
      const res = await apiFetch(`${API_BASE}/sandbox/${sandboxId}/files?${params}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      if (!res.ok) {
        throw new Error(await parseError(res));
      }
    },

    // #47: upload a file into the workspace (base64 over the JSON byte chain).
    async uploadFile(sandboxId: string, path: string, file: Blob): Promise<{ path: string; size: number }> {
      const contentBase64 = await blobToBase64(file);
      const res = await apiFetch(`${API_BASE}/sandbox/${sandboxId}/files`, {
        method: "POST",
        headers: { ...authHeaders(), "content-type": "application/json" },
        body: JSON.stringify({ path, contentBase64 }),
      });
      if (!res.ok) {
        throw new Error(await parseError(res));
      }
      return handleJson(res);
    },
  },

  sessions: {
    async list(): Promise<Session[]> {
      if (runtimeConfig.useMockBackend) {
        return mockBackend.listSessions();
      }
      // Runtime returns the protocol envelope `{ sessions: [...] }` (see
      // ListSessionsResponseSchema). Unwrap it; tolerate a bare array (legacy /
      // mock) and fall back to [] so an unexpected shape never throws
      // `.map is not a function` into SessionContext's error banner.
      const raw = await handleJson<{ sessions?: unknown[] } | unknown[]>(
        await apiFetch(`${API_BASE}/sessions`, { headers: authHeaders() }),
      );
      const list = Array.isArray(raw)
        ? raw
        : Array.isArray((raw as { sessions?: unknown[] })?.sessions)
          ? (raw as { sessions: unknown[] }).sessions
          : [];
      return list.map((item) => normalizeSession(item as Parameters<typeof normalizeSession>[0]));
    },

    async get(sessionId: string): Promise<Session> {
      if (runtimeConfig.useMockBackend) {
        return mockBackend.getSession(sessionId);
      }
      const raw = await handleJson<unknown>(await apiFetch(`${API_BASE}/sessions/${sessionId}`, { headers: authHeaders() }));
      return normalizeSession(raw as Parameters<typeof normalizeSession>[0]);
    },

    async create(
      title = "New research session",
      opts: { providerId?: string; modelId?: string } = {},
    ): Promise<Session> {
      if (runtimeConfig.useMockBackend) {
        return mockBackend.createSession(title);
      }
      const raw = await handleJson<unknown>(
        await apiFetch(`${API_BASE}/sessions`, {
          method: "POST",
          headers: authHeaders(),
          timeoutMs: SEND_TIMEOUT_MS,
          body: JSON.stringify({
            title,
            ...(opts.providerId ? { providerId: opts.providerId } : {}),
            ...(opts.modelId ? { modelId: opts.modelId } : {}),
          }),
        }),
      );
      // The runtime's POST /sessions returns the envelope `{ id, session }`
      // (server.ts), unlike GET /sessions[/:id] which return the bare session.
      // Unwrap `session` if present so normalizeSession reads the real `title`
      // instead of falling back to `Session <id8>` (#96). Tolerate a bare
      // object too (mock / future shape change).
      const envelope = raw as { session?: unknown } | null;
      const sessionRaw = envelope && typeof envelope === "object" && "session" in envelope
        ? envelope.session
        : raw;
      return normalizeSession(sessionRaw as Parameters<typeof normalizeSession>[0]);
    },

    async update(sessionId: string, title: string): Promise<Session> {
      if (runtimeConfig.useMockBackend) {
        return mockBackend.updateSession(sessionId, title);
      }
      const raw = await handleJson<unknown>(
        await apiFetch(`${API_BASE}/sessions/${sessionId}`, {
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
        await apiFetch(`${API_BASE}/sessions/${sessionId}`, {
          method: "DELETE",
          headers: authHeaders(),
        }),
      );
    },

    async interrupt(sessionId: string): Promise<{ interrupted: boolean }> {
      if (runtimeConfig.useMockBackend) {
        return { interrupted: true };
      }
      // #90: Stop = whole-session interrupt. Hit the dedicated interrupt route
      // (RUNTIME_ROUTES.interrupt), NOT /messages — the messages endpoint's body
      // schema rejects {type:"interrupt"} so the agent was never actually
      // stopped. Empty body = interrupt every agent in the session.
      return handleJson<{ interrupted: boolean }>(
        await apiFetch(`${API_BASE}/sessions/${sessionId}/interrupt`, {
          method: "POST",
          headers: { ...authHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({}),
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
        await apiFetch(`${API_BASE}/sessions/${sessionId}/messages`, {
          method: "POST",
          headers: { ...authHeaders(), "Content-Type": "application/json" },
          timeoutMs: SEND_TIMEOUT_MS,
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
        await apiFetch(`${API_BASE}/sessions/${sessionId}/commands`, { headers: authHeaders() }),
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
        await apiFetch(`${API_BASE}/sessions/${sessionId}/messages`, {
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
        await apiFetch(`${API_BASE}/sessions/${sessionId}/trace`, { headers: authHeaders() }),
      );
      return normalizeTraceGraph(raw);
    },

    async getEvents(sessionId: string): Promise<RawAgUiEvent[]> {
      if (runtimeConfig.useMockBackend) {
        return mockBackend.getSessionEvents(sessionId);
      }
      // `/sessions/:id/events` is an SSE alias in backend-core (sseHandler), not
      // a JSON route — so res.json() would reject. Treat any non-ok / non-JSON
      // response as "no events" and let callers (demoBundle) use their ordered
      // fallback instead of crashing on a stream body.
      const res = await apiFetch(`${API_BASE}/sessions/${sessionId}/events`, { headers: authHeaders() });
      if (!res.ok) return [];
      const contentType = res.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) return [];
      const raw = (await res.json().catch(() => ({}))) as { events?: unknown[] };
      return Array.isArray(raw.events) ? (raw.events as RawAgUiEvent[]) : [];
    },

    /**
     * Persisted AG-UI event history from `events.jsonl` — used to rehydrate
     * the chat list (and trace/agents seed) when a session is activated after
     * a runtime restart. SSE only replays the in-memory ring buffer; this
     * endpoint walks the on-disk log and returns the tail when long. Pass
     * `limit: 0` to request the full log for lossless rehydrate.
     *
     * Tolerates any non-200 / non-JSON response by returning an empty
     * envelope, so callers can fall through to whatever live data the SSE
     * stream eventually delivers.
     */
    async getHistory(
      sessionId: string,
      opts: { limit?: number } = {},
    ): Promise<{ events: RawAgUiEvent[]; total: number; truncated: boolean }> {
      if (runtimeConfig.useMockBackend) {
        return { events: [], total: 0, truncated: false };
      }
      const qs = opts.limit !== undefined ? `?limit=${encodeURIComponent(opts.limit)}` : "";
      const res = await apiFetch(
        `${API_BASE}/sessions/${sessionId}/history${qs}`,
        { headers: authHeaders() },
      );
      // A 404 means the session has no transcript on disk (genuinely empty) —
      // return an empty history. Any OTHER non-OK status is a real failure
      // (routing / storage / auth); surface it instead of silently rendering an
      // empty transcript, which historically masked broken rehydrates (#223).
      if (res.status === 404) return { events: [], total: 0, truncated: false };
      if (!res.ok) {
        throw new Error(`history fetch failed: ${res.status} ${res.statusText}`);
      }
      const raw = (await res.json().catch(() => null)) as
        | { events?: unknown[]; total?: number; truncated?: boolean }
        | null;
      return {
        events: Array.isArray(raw?.events) ? (raw!.events as RawAgUiEvent[]) : [],
        total: typeof raw?.total === "number" ? raw!.total : 0,
        truncated: Boolean(raw?.truncated),
      };
    },

    async state(sessionId: string): Promise<SessionStateSnapshot> {
      if (runtimeConfig.useMockBackend) {
        return mockBackend.state();
      }
      const raw = await handleJson<unknown>(
        await apiFetch(`${API_BASE}/sessions/${sessionId}/state`, { headers: authHeaders() }),
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
      const raw = await handleJson<unknown>(await apiFetch(`${API_BASE}/settings`, { headers: authHeaders() }));
      return normalizeSettings(raw as Parameters<typeof normalizeSettings>[0]);
    },

    async update(data: Partial<SettingsData>): Promise<SettingsData> {
      if (runtimeConfig.useMockBackend) {
        return mockBackend.updateSettings(data);
      }
      const raw = await handleJson<unknown>(
        await apiFetch(`${API_BASE}/settings`, {
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
        await apiFetch(`${API_BASE}/settings/reset-config`, {
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
      const raw = await handleJson<unknown[]>(await apiFetch(`${API_BASE}/mcp-servers`, { headers: authHeaders() }));
      return raw.map(normalizeMcpServer);
    },

    async add(name: string, config: Omit<McpServerEntry, "name">): Promise<McpServerEntry> {
      if (runtimeConfig.useMockBackend) {
        return mockBackend.addMcpServer(name, config);
      }
      const raw = await handleJson<unknown>(
        await apiFetch(`${API_BASE}/mcp-servers`, {
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
        await apiFetch(`${API_BASE}/mcp-servers/${name}`, {
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
        await apiFetch(`${API_BASE}/mcp-servers/${name}`, {
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
        await apiFetch(`${API_BASE}/provider/profiles`, { headers: authHeaders() }),
      );
      return raw.map((item) => normalizeProviderProfile(item as Parameters<typeof normalizeProviderProfile>[0]));
    },

    async create(data: ProviderCreate): Promise<ProviderProfile> {
      if (runtimeConfig.useMockBackend) {
        return mockBackend.createProvider(data);
      }
      const raw = await handleJson<unknown>(
        await apiFetch(`${API_BASE}/provider/profiles`, {
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
        await apiFetch(`${API_BASE}/provider/profiles/${id}`, {
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
        await apiFetch(`${API_BASE}/provider/profiles/${id}`, {
          method: "DELETE",
          headers: authHeaders(),
        }),
      );
    },

    async getActive(): Promise<ProviderProfile | null> {
      if (runtimeConfig.useMockBackend) {
        return mockBackend.getActiveProvider();
      }
      const res = await apiFetch(`${API_BASE}/provider/profiles/active`, { headers: authHeaders() });
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
        await apiFetch(`${API_BASE}/provider/profiles/active`, {
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
        await apiFetch(`${API_BASE}/provider/profiles/health`, { headers: authHeaders() }),
      );
      return raw.map((item) => normalizeProviderProfile(item as Parameters<typeof normalizeProviderProfile>[0]));
    },

    async test(id: string): Promise<ProviderProfile> {
      if (runtimeConfig.useMockBackend) {
        return mockBackend.testProvider(id);
      }
      const raw = await handleJson<unknown>(
        await apiFetch(`${API_BASE}/provider/profiles/${id}/test`, {
          method: "POST",
          headers: authHeaders(),
        }),
      );
      return normalizeProviderProfile(raw as Parameters<typeof normalizeProviderProfile>[0]);
    },
  },

  // Knowledge Base — local pipeline build orchestration.
  // Mirrors the backend /api/kb/* routes. The SSE event stream is consumed
  // directly via `new EventSource()` in the panel component (so it can stay
  // attached for the lifetime of the dialog), so we don't expose a helper
  // here for it.
  kb: {
    async build(opts: {
      ocrApiKey?: string;
      metaApiKey?: string;
      metaBaseUrl?: string;
      metaModel?: string;
      kbRoot?: string;
      ocrConcurrency?: number;
      ocrLimit?: number;
      skip?: Array<"ocr" | "extract" | "chunk" | "vectorize">;
      only?: Array<"ocr" | "extract" | "chunk" | "vectorize">;
      hfMirror?: string;
    }): Promise<{ ok: boolean; startedAt?: number; error?: string }> {
      const res = await apiFetch(`${API_BASE}/kb/build`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(opts),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        return { ok: false, error: body.error || `kb build failed (${res.status})` };
      }
      return handleJson(res);
    },

    async status(): Promise<{
      active: boolean;
      startedAt: number | null;
      finishedAt: number | null;
      exitCode: number | null | undefined;
      error?: string;
      recentEvents: Array<{
        ts: string;
        stage: string;
        event: string;
        msg: string;
        [k: string]: unknown;
      }>;
      environment: {
        python: string;
        pythonIsVenv: boolean;
        venvExists: boolean;
        expectedVenvPath: string;
        scriptsPresent: boolean;
        kbRoot: string;
      };
    }> {
      return handleJson(await apiFetch(`${API_BASE}/kb/status`));
    },

    async cancel(): Promise<{ ok: boolean; message?: string }> {
      const res = await apiFetch(`${API_BASE}/kb/cancel`, { method: "POST" });
      return res.json().catch(() => ({ ok: false }));
    },

    // Bootstrap the Python venv (KnowledgeBase/.venv) before the first
    // build can run. Streams progress on the same SSE channel as `build`,
    // so the panel only needs one EventSource subscription.
    async setupEnv(opts: {
      python?: string;
      reinstall?: boolean;
      kbRoot?: string;
    } = {}): Promise<{ ok: boolean; startedAt?: number; error?: string }> {
      const res = await apiFetch(`${API_BASE}/kb/setup-env`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(opts),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        return { ok: false, error: body.error || `setup-env failed (${res.status})` };
      }
      return handleJson(res);
    },

    // Download bge-m3 + bge-reranker-v2-m3 model weights (~2.5 GB) via
    // `scripts/setup_models.py`. Independent slot from setupEnv — the two
    // can run concurrently, and setupFull() chains them.
    async setupModels(opts: {
      hfMirror?: string;
      kbRoot?: string;
    } = {}): Promise<{ ok: boolean; startedAt?: number; error?: string }> {
      const res = await apiFetch(`${API_BASE}/kb/setup-models`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(opts),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        return { ok: false, error: body.error || `setup-models failed (${res.status})` };
      }
      return handleJson(res);
    },

    // One-click orchestration: create venv, then download models when venv
    // exits 0. Preferred entry point from the KB panel — one button, two
    // progress rows in the UI.
    async setupFull(opts: {
      python?: string;
      reinstall?: boolean;
      hfMirror?: string;
      kbRoot?: string;
    } = {}): Promise<{ ok: boolean; startedAt?: number; error?: string }> {
      const res = await apiFetch(`${API_BASE}/kb/setup-full`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(opts),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        return { ok: false, error: body.error || `setup-full failed (${res.status})` };
      }
      return handleJson(res);
    },

    // Persisted KB API config (SiliconFlow OCR key today). Backend never
    // returns the plaintext — only a masked preview + boolean — so the
    // browser can indicate "already saved" without ever holding the secret.
    async getApiConfig(): Promise<{ hasOcrApiKey: boolean; ocrApiKeyPreview: string }> {
      const res = await apiFetch(`${API_BASE}/kb/api-config`);
      if (!res.ok) return { hasOcrApiKey: false, ocrApiKeyPreview: "" };
      return handleJson(res);
    },

    async saveApiConfig(patch: { ocrApiKey?: string }): Promise<{ ok: boolean; error?: string }> {
      const res = await apiFetch(`${API_BASE}/kb/api-config`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        return { ok: false, error: body.error || `save failed (${res.status})` };
      }
      return handleJson(res);
    },

    eventsUrl(): string {
      return `${API_BASE}/kb/events`;
    },
  },
};
