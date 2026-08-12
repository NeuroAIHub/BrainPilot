import {
  AgentStatus,
  SessionStateSnapshot,
  FileContent,
  FileEntry,
  McpServerEntry,
  McpByokStatus,
  ProviderCreate,
  ProviderProfile,
  ProviderUpdate,
  Sandbox,
  SandboxStats,
  Session,
  SessionMessageEntry,
  SettingsData,
  TraceGraph,
  WebSocketEvent,
} from "../contracts/backend";

const now = () => new Date().toISOString();
const wait = (ms = 180) => new Promise((resolve) => window.setTimeout(resolve, ms));

let mockUser = {
  id: "mock-user-fy",
  username: "fy",
  createdAt: "2026-05-10T02:00:00.000Z",
};

let mockSandbox: Sandbox | null = {
  id: "mock-sandbox-001",
  name: "default",
  status: "running",
  port: 8080,
  userId: mockUser.username,
  createdAt: "2026-05-10T02:05:00.000Z",
  containerName: "mas-neuroscience-default",
  hostApiUrl: "http://127.0.0.1:8080",
};

let mockSessions: Session[] = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    title: "EEG preprocessing reproducibility plan",
    
    createdAt: "2026-05-10T02:12:00.000Z",
    updatedAt: "2026-05-10T02:48:00.000Z",
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    title: "Bayesian power analysis comparison",
    
    createdAt: "2026-05-10T01:30:00.000Z",
    updatedAt: "2026-05-10T01:46:00.000Z",
  },
];

let mockSettings: SettingsData = {
  model: "claude-sonnet-4-6",
  apiKey: "sk-mock••••0000",
  baseUrl: "https://api.anthropic.com",
};

let mockMcpServers: McpServerEntry[] = [
  {
    name: "filesystem",
    type: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem", "/workspace"],
  },
  // #377: a platform-managed preset with a BYOK annotation, so the read-only +
  // "bring your own key" UI is reachable in mock/demo mode. The URL stands in for
  // a hosted preset carrying the platform's shared key — which is exactly why the
  // UI must not render it.
  {
    name: "tavily",
    type: "http",
    url: "https://mcp.tavily.com/mcp/?tavilyApiKey=PLATFORM_SHARED_KEY",
    readOnly: true,
    byok: { kind: "tavily", keyParam: "tavilyApiKey" },
  },
];

/** #377: mock BYOK store, keyed by `byok.kind`. */
let mockMcpByokKeys: Record<string, string> = {};

let mockProviders: ProviderProfile[] = [
  {
    id: "provider-anthropic",
    name: "Anthropic",
    baseUrl: "https://api.anthropic.com",
    api: "anthropic-messages",
    adapter: "anthropic",
    isShared: false,
    models: ["claude-sonnet-4-6", "claude-opus-4-6", "claude-haiku-4-5-20251001"],
    icon: "sparkles",
    iconColor: "#111111",
    notes: "Default mock provider profile",
    isActive: true,
    apiKeyMasked: "sk-ant••••0000",
    createdAt: 1_715_292_000,
    updatedAt: 1_715_292_000,
    healthStatus: "healthy",
    healthCheckedAt: 1_715_292_000,
    modelHealth: [
      { model: "claude-sonnet-4-6", status: "healthy", latencyMs: 340 },
      { model: "claude-opus-4-6", status: "healthy", latencyMs: 520 },
      { model: "claude-haiku-4-5-20251001", status: "healthy", latencyMs: 180 },
    ],
  },
];

const mockHistoryMessages: Record<string, SessionMessageEntry[]> = {
  "11111111-1111-4111-8111-111111111111": [
    {
      type: "user",
      uuid: "mock-hist-user-1",
      timestamp: "2026-05-10T02:20:00.000Z",
      message: { role: "user", content: "Build a reproducible EEG preprocessing plan", agent: "user" },
    },
    {
      type: "assistant",
      uuid: "mock-hist-assistant-1",
      timestamp: "2026-05-10T02:20:10.000Z",
      message: {
        role: "assistant",
        agent: "principal",
        content: [
          { type: "text", text: "A reproducible plan should start with raw import, filtering, ICA review, epoching, and QC export." },
          { type: "tool_use", id: "mock-tool-1", name: "record_trace", input: { node: "EEG preprocessing plan" } },
        ],
      },
    },
  ],
};

const mockTraceGraph: TraceGraph = {
  meta: {
    sessionId: "11111111-1111-4111-8111-111111111111",
    userId: "fy",
    projectName: "Mock EEG workflow",
    currentFocus: "qc-summary",
    createdAt: "2026-05-10T02:21:00.000Z",
  },
  nodes: [
    {
      id: "plan",
      title: "Define preprocessing plan",
      type: "plan",
      nodeType: "action",
      status: "done",
      agent: "principal",
      description: "Outlined a reproducible EEG preprocessing workflow and selected the main execution checkpoints.",
      summary: "Outlined a reproducible EEG preprocessing workflow.",
      reason: "The session needed an explicit, reproducible preprocessing path before tools could be delegated.",
      context: "Raw EEG data will be imported, filtered, cleaned with ICA, epoched, and exported with QC artifacts.",
      parents: [],
      artifacts: [{ path: "/workspace/src/pipeline.yaml", type: "code" }],
      parentIds: [],
      childIds: ["qc"],
      createdAt: "2026-05-10T02:21:00.000Z",
      timestamp: { createdAt: "2026-05-10T02:21:00.000Z", completedAt: "2026-05-10T02:21:28.000Z" },
      durationMs: 28_000,
      toolCalls: ["record_trace"],
    },
    {
      id: "delegate",
      title: "Delegate literature context",
      type: "delegation",
      nodeType: "decision",
      status: "in_progress",
      agent: "principal",
      description: "Asked the librarian expert to monitor method references and naming consistency.",
      summary: "Delegated method context tracking to librarian.",
      reason: "Preprocessing decisions should remain aligned with accepted EEG reporting practice.",
      context: "The plan introduced ICA and QC checkpoints that need literature-grounded wording.",
      parents: [{ id: "plan", relation: "necessitated_by", edgeType: "main_flow", explanation: "The workflow needs literature-grounded QC checkpoints." }],
      artifacts: [],
      parentIds: ["plan"],
      childIds: ["qc"],
      createdAt: "2026-05-10T02:22:30.000Z",
      timestamp: { createdAt: "2026-05-10T02:22:30.000Z", startedAt: "2026-05-10T02:22:40.000Z" },
      toolCalls: ["create_agent", "dispatch_task"],
    },
    {
      id: "qc",
      title: "Quality-control checkpoints",
      type: "analysis",
      nodeType: "observation",
      status: "done",
      agent: "librarian",
      description: "Captured retained epochs, ICA removals, and frontal-channel warnings.",
      summary: "Captured retained epochs, ICA removals, and frontal-channel warnings.",
      reason: "The workflow needs inspectable artifacts before it can be reproduced.",
      context: "Mock QC artifacts summarize retained epochs and ICA removal decisions.",
      parents: [{ id: "delegate", relation: "used", edgeType: "branch", explanation: "The librarian context informed the QC report wording." }],
      artifacts: [
        { path: "/workspace/reports/qc-summary.md", type: "report" },
        { path: "/workspace/reports/qc-plot.svg", type: "image" },
      ],
      parentIds: ["delegate"],
      childIds: [],
      createdAt: "2026-05-10T02:24:00.000Z",
      timestamp: { createdAt: "2026-05-10T02:24:00.000Z", completedAt: "2026-05-10T02:24:23.000Z" },
      durationMs: 23_000,
      toolCalls: ["record_trace"],
    },
  ],
};

const fileEntries: Record<string, FileEntry[]> = {
  "/workspace": [
    { name: "README.md", type: "file", size: 870, modified: 1_715_292_000, permissions: "rw-r--r--" },
    { name: "src", type: "folder", size: 0, modified: 1_715_292_200, permissions: "rwxr-xr-x" },
    { name: "data", type: "folder", size: 0, modified: 1_715_292_400, permissions: "rwxr-xr-x" },
    { name: "reports", type: "folder", size: 0, modified: 1_715_292_600, permissions: "rwxr-xr-x" },
  ],
  "/workspace/src": [
    { name: "preprocess_eeg.py", type: "file", size: 1380, modified: 1_715_293_000, permissions: "rw-r--r--" },
    { name: "pipeline.yaml", type: "file", size: 516, modified: 1_715_293_300, permissions: "rw-r--r--" },
  ],
  "/workspace/data": [
    { name: "participants.csv", type: "file", size: 168, modified: 1_715_293_900, permissions: "rw-r--r--" },
    { name: "raw-large.edf", type: "file", size: 4_800_000, modified: 1_715_294_200, permissions: "rw-r--r--" },
  ],
  "/workspace/reports": [
    { name: "qc-summary.md", type: "file", size: 1120, modified: 1_715_294_600, permissions: "rw-r--r--" },
    { name: "qc-plot.svg", type: "file", size: 932, modified: 1_715_294_900, permissions: "rw-r--r--" },
  ],
};

/**
 * #307: pure mock FS delete — removes `path` (and any descendants) from listing
 * maps and content maps. Exported for unit tests.
 */
export function applyMockFileDelete(
  path: string,
  entries: Record<string, FileEntry[]>,
  contents: Record<string, string>,
): void {
  for (const key of Object.keys(contents)) {
    if (key === path || key.startsWith(`${path}/`)) {
      delete contents[key];
    }
  }
  for (const key of Object.keys(entries)) {
    if (key === path || key.startsWith(`${path}/`)) {
      delete entries[key];
    }
  }
  const lastSlash = path.lastIndexOf("/");
  if (lastSlash > 0) {
    const parentPath = path.slice(0, lastSlash);
    const name = path.slice(lastSlash + 1);
    const parent = entries[parentPath];
    if (parent) {
      entries[parentPath] = parent.filter((entry) => entry.name !== name);
    }
  }
}

const fileContents: Record<string, string> = {
  "/workspace/README.md":
    "# Mock research workspace\n\nThis mock workspace mirrors the backend file API shape.\n\n- `src/` contains analysis code\n- `data/` contains small fixtures\n- `reports/` contains generated notes\n",
  "/workspace/src/preprocess_eeg.py":
    "from pathlib import Path\n\n\ndef preprocess(raw_dir: Path) -> dict[str, float]:\n    \"\"\"Mock EEG preprocessing summary.\"\"\"\n    return {\n        \"n_subjects\": 24,\n        \"bad_channel_rate\": 0.031,\n        \"mean_rejected_epochs\": 4.8,\n    }\n",
  "/workspace/src/pipeline.yaml":
    "steps:\n  - import_raw\n  - notch_filter\n  - bandpass_filter\n  - ica_artifact_rejection\n  - epoch\n  - export_qc_report\n",
  "/workspace/data/participants.csv": "id,group,age\nsub-001,control,24\nsub-002,patient,31\nsub-003,control,28\n",
  "/workspace/reports/qc-summary.md":
    "# QC Summary\n\nThe mock run completed successfully.\n\n- Mean retained epochs: **91.2%**\n- Median ICA components removed: `2`\n- Recommended next step: inspect frontal channels for residual blink artifacts.\n",
  "/workspace/reports/qc-plot.svg":
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 520 280"><rect width="520" height="280" fill="#f8f8f6"/><g fill="none" stroke="#1f2937" stroke-width="2"><path d="M54 222H476"/><path d="M54 40v182"/></g><g fill="#111827"><text x="54" y="26" font-family="Arial" font-size="16">Mock EEG QC retained epochs</text><text x="62" y="246" font-family="Arial" font-size="11">sub-001</text><text x="182" y="246" font-family="Arial" font-size="11">sub-002</text><text x="302" y="246" font-family="Arial" font-size="11">sub-003</text></g><g fill="#111827"><rect x="72" y="78" width="66" height="144" rx="3"/><rect x="192" y="94" width="66" height="128" rx="3"/><rect x="312" y="60" width="66" height="162" rx="3"/></g></svg>',
};

let seq = 0;

function getMimeType(path: string) {
  if (/\.svg$/i.test(path)) {
    return "image/svg+xml";
  }
  if (/\.png$/i.test(path)) {
    return "image/png";
  }
  if (/\.jpe?g$/i.test(path)) {
    return "image/jpeg";
  }
  if (/\.pdf$/i.test(path)) {
    return "application/pdf";
  }
  if (/\.json$/i.test(path)) {
    return "application/json";
  }
  return "text/plain";
}

export const mockBackend = {
  async version() {
    await wait(80);
    return { version: "mock-ui-redesign" };
  },

  async me() {
    await wait(80);
    return mockUser;
  },

  async listSandboxes(): Promise<Sandbox[]> {
    await wait();
    return mockSandbox ? [mockSandbox] : [];
  },

  async createSandbox(name = "default"): Promise<Sandbox> {
    await wait(450);
    mockSandbox = {
      id: "mock-sandbox-001",
      name,
      status: "running",
      port: 8080,
      userId: mockUser.username,
      createdAt: now(),
      containerName: `mas-neuroscience-${name}`,
      hostApiUrl: "http://127.0.0.1:8080",
    };
    return mockSandbox;
  },

  async rebuildSandbox(): Promise<Sandbox> {
    await wait(520);
    if (!mockSandbox) {
      return this.createSandbox();
    }
    mockSandbox = { ...mockSandbox, status: "running", createdAt: now() };
    return mockSandbox;
  },

  async destroySandbox(): Promise<void> {
    await wait();
    mockSandbox = null;
  },

  async sandboxStats(): Promise<SandboxStats> {
    await wait(120);
    return {
      sandboxId: mockSandbox?.id || "mock-sandbox-001",
      sandboxName: mockSandbox?.name || "default",
      status: mockSandbox?.status || "stopped",
      memory: { usedBytes: 612 * 1024 * 1024, limitBytes: 2 * 1024 * 1024 * 1024, percent: 29.9 },
      cpu: { usedPercent: 17.5, quotaPercent: 100, onlineCpus: 4 },
      pids: { current: 31, limit: 256 },
      disk: { workspaceUsedBytes: 156 * 1024 * 1024, quotaBytes: 1024 * 1024 * 1024, percentOfQuota: 15.2 },
      gpu: null,
    };
  },

  async sandboxLogs(): Promise<string> {
    await wait();
    return [
      "[mock] agent_runtime started on :8080",
      "[mock] mounted /workspace",
      "[mock] principal agent ready",
    ].join("\n");
  },

  async sandboxHealth(): Promise<Record<string, unknown>> {
    await wait();
    return {
      status: mockSandbox?.status === "running" ? "ok" : "offline",
      agent_runtime: mockSandbox?.status === "running",
      checked_at: now(),
    };
  },

  async listFiles(_sandboxId: string, path = "/workspace"): Promise<FileEntry[]> {
    await wait();
    return fileEntries[path] || [];
  },

  async readFile(_sandboxId: string, path: string): Promise<FileContent> {
    await wait();
    const content = fileContents[path];
    if (!content) {
      throw new Error("Mock file is not previewable inline");
    }
    return { path, content, size: content.length };
  },

  async readRawFile(_sandboxId: string, path: string): Promise<Blob> {
    await wait();
    return new Blob([fileContents[path] || ""], { type: getMimeType(path) });
  },

  async deleteFile(_sandboxId: string, path: string): Promise<void> {
    await wait();
    // #307: block protected roots (matches FileSidebar UI + runtime expectations).
    if (path === "/workspace" || path === "/data") {
      throw new Error(`Deleting ${path} root is not allowed`);
    }
    applyMockFileDelete(path, fileEntries, fileContents);
  },

  async listSessions(): Promise<Session[]> {
    await wait();
    return [...mockSessions];
  },

  async getSession(sessionId: string): Promise<Session> {
    await wait();
    const session = mockSessions.find((item) => item.id === sessionId);
    if (!session) {
      throw new Error("Session not found");
    }
    return session;
  },

  async createSession(title: string): Promise<Session> {
    await wait();
    const session = {
      id: crypto.randomUUID(),
      title: title || "New research session",
      createdAt: now(),
      updatedAt: now(),
    };
    mockSessions = [session, ...mockSessions];
    return session;
  },

  async updateSession(sessionId: string, title: string): Promise<Session> {
    await wait();
    mockSessions = mockSessions.map((session) =>
      session.id === sessionId ? { ...session, title, updatedAt: now() } : session,
    );
    return mockSessions.find((session) => session.id === sessionId) as Session;
  },

  async removeSession(sessionId: string): Promise<void> {
    await wait();
    mockSessions = mockSessions.filter((session) => session.id !== sessionId);
  },

  async getMessages(sessionId: string): Promise<SessionMessageEntry[]> {
    await wait();
    return mockHistoryMessages[sessionId] || [];
  },

  async getTrace(sessionId: string): Promise<TraceGraph> {
    await wait();
    return {
      ...mockTraceGraph,
      meta: { ...mockTraceGraph.meta, sessionId },
    };
  },

  async getSessionEvents(_sessionId: string) {
    await wait(80);
    // Timestamped AG-UI events aligned with mockTraceGraph (02:21–02:24) so the
    // demo replay can be exercised end-to-end in mock mode.
    return [
      { type: "RUN_STARTED", _ts: "2026-05-10T02:20:45.000Z", agentName: "principal" },
      { type: "TEXT_MESSAGE_CHUNK", _ts: "2026-05-10T02:20:50.000Z", messageId: "u1", role: "user", delta: "Design a reproducible EEG preprocessing pipeline." },
      { type: "REASONING_MESSAGE_START", _ts: "2026-05-10T02:21:00.000Z", messageId: "r1", agentName: "principal" },
      { type: "REASONING_MESSAGE_CONTENT", _ts: "2026-05-10T02:21:02.000Z", messageId: "r1", delta: "Outline import → filter → ICA → epoch → export, with QC checkpoints." },
      { type: "REASONING_MESSAGE_END", _ts: "2026-05-10T02:21:10.000Z", messageId: "r1" },
      { type: "TOOL_CALL_START", _ts: "2026-05-10T02:21:12.000Z", toolCallId: "t1", toolCallName: "record_trace", agentName: "principal" },
      { type: "TOOL_CALL_ARGS", _ts: "2026-05-10T02:21:13.000Z", toolCallId: "t1", delta: "{\"title\":\"Define preprocessing plan\"}" },
      { type: "TOOL_CALL_END", _ts: "2026-05-10T02:21:14.000Z", toolCallId: "t1" },
      { type: "TEXT_MESSAGE_START", _ts: "2026-05-10T02:21:20.000Z", messageId: "a1", agentName: "principal" },
      { type: "TEXT_MESSAGE_CONTENT", _ts: "2026-05-10T02:21:22.000Z", messageId: "a1", delta: "I drafted a reproducible pipeline in `src/pipeline.yaml`." },
      { type: "TEXT_MESSAGE_END", _ts: "2026-05-10T02:21:28.000Z", messageId: "a1" },
      { type: "TEXT_MESSAGE_START", _ts: "2026-05-10T02:24:05.000Z", messageId: "a2", agentName: "librarian" },
      { type: "TEXT_MESSAGE_CONTENT", _ts: "2026-05-10T02:24:08.000Z", messageId: "a2", delta: "QC summary captured retained epochs and ICA removals — see `reports/qc-summary.md`." },
      { type: "TEXT_MESSAGE_END", _ts: "2026-05-10T02:24:23.000Z", messageId: "a2" },
      { type: "RUN_FINISHED", _ts: "2026-05-10T02:24:25.000Z", agentName: "principal" },
    ];
  },

  async events() {
    await wait(80);
    return { events: [], nextOffset: 0, hasMore: false };
  },

  async state(): Promise<SessionStateSnapshot> {
    await wait(80);
    return {
      runState: { active: false, runId: null },
      workState: { active: false },
      agents: [
        { name: "principal", status: "idle", task: "Ready for a research prompt", updatedAt: new Date().toISOString(), alive: true },
        { name: "librarian", status: "idle", task: "Monitoring literature context", updatedAt: new Date().toISOString(), alive: true },
      ],
      lastActivityTs: new Date().toISOString(),
    };
  },

  async promptSuggestions(): Promise<string[]> {
    await wait(80);
    return [
      "Design a reproducible EEG preprocessing pipeline",
      "Compare Bayesian and frequentist power plans",
      "Summarize provenance for the latest analysis run",
    ];
  },

  async getSettings(): Promise<SettingsData> {
    await wait();
    return mockSettings;
  },

  async updateSettings(data: Partial<SettingsData>): Promise<SettingsData> {
    await wait();
    mockSettings = { ...mockSettings, ...data };
    return mockSettings;
  },

  async resetConfig(): Promise<void> {
    await wait();
    mockSettings = { model: "claude-sonnet-4-6", apiKey: "sk-mock••••0000", baseUrl: "https://api.anthropic.com" };
  },

  async listMcpServers(): Promise<McpServerEntry[]> {
    await wait();
    return [...mockMcpServers];
  },

  async addMcpServer(name: string, config: Omit<McpServerEntry, "name">): Promise<McpServerEntry> {
    await wait();
    const server = { name, ...config };
    mockMcpServers = [...mockMcpServers.filter((item) => item.name !== name), server];
    return server;
  },

  async updateMcpServer(name: string, config: Omit<McpServerEntry, "name">): Promise<McpServerEntry> {
    await wait();
    const server = { name, ...config };
    mockMcpServers = mockMcpServers.map((item) => (item.name === name ? server : item));
    return server;
  },

  async removeMcpServer(name: string): Promise<void> {
    await wait();
    mockMcpServers = mockMcpServers.filter((item) => item.name !== name);
  },

  async listMcpByok(): Promise<McpByokStatus[]> {
    await wait();
    return mockMcpServers
      .filter((item) => item.byok)
      .map((item) => ({
        kind: item.byok!.kind,
        presetName: item.name,
        configured: Boolean(mockMcpByokKeys[item.byok!.kind]),
      }));
  },

  async saveMcpByok(kind: string, apiKey: string): Promise<void> {
    await wait();
    mockMcpByokKeys = { ...mockMcpByokKeys, [kind]: apiKey };
  },

  async clearMcpByok(kind: string): Promise<void> {
    await wait();
    const { [kind]: _dropped, ...rest } = mockMcpByokKeys;
    mockMcpByokKeys = rest;
  },

  async listProviders(): Promise<ProviderProfile[]> {
    await wait();
    return [...mockProviders];
  },

  async createProvider(data: ProviderCreate): Promise<ProviderProfile> {
    await wait();
    const timestamp = Math.floor(Date.now() / 1000);
    const profile: ProviderProfile = {
      id: crypto.randomUUID(),
      name: data.name,
      baseUrl: data.baseUrl,
      api: data.api ?? "anthropic-messages",
      adapter: data.adapter ?? "auto",
      isShared: false,
      models: data.models || [],
      icon: data.icon || "circle",
      iconColor: data.iconColor || "#111111",
      notes: data.notes || "",
      isActive: false,
      apiKeyMasked: data.apiKey ? `${data.apiKey.slice(0, 5)}••••${data.apiKey.slice(-4)}` : "",
      createdAt: timestamp,
      updatedAt: timestamp,
      healthStatus: "unknown",
      healthCheckedAt: undefined,
      modelHealth: [],
    };
    mockProviders = [profile, ...mockProviders];
    return profile;
  },

  async updateProvider(id: string, data: ProviderUpdate): Promise<ProviderProfile> {
    await wait();
    let updated: ProviderProfile | null = null;
    mockProviders = mockProviders.map((profile) => {
      if (profile.id !== id) {
        return profile;
      }
      updated = {
        ...profile,
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.baseUrl !== undefined ? { baseUrl: data.baseUrl } : {}),
        ...(data.api !== undefined ? { api: data.api } : {}),
        ...(data.models !== undefined ? { models: data.models } : {}),
        ...(data.icon !== undefined ? { icon: data.icon } : {}),
        ...(data.iconColor !== undefined ? { iconColor: data.iconColor } : {}),
        ...(data.notes !== undefined ? { notes: data.notes } : {}),
        ...(data.apiKey !== undefined ? { apiKeyMasked: `${data.apiKey.slice(0, 5)}••••${data.apiKey.slice(-4)}` } : {}),
        updatedAt: Math.floor(Date.now() / 1000),
      };
      return updated;
    });
    if (!updated) {
      throw new Error("Provider not found");
    }
    return updated;
  },

  async removeProvider(id: string): Promise<void> {
    await wait();
    mockProviders = mockProviders.filter((profile) => profile.id !== id || profile.isActive);
  },

  async getActiveProvider(): Promise<ProviderProfile | null> {
    await wait();
    return mockProviders.find((profile) => profile.isActive) || null;
  },

  async setActiveProvider(id: string): Promise<ProviderProfile> {
    await wait();
    let active: ProviderProfile | null = null;
    mockProviders = mockProviders.map((profile) => {
      const next = { ...profile, isActive: profile.id === id };
      if (next.isActive) {
        active = next;
      }
      return next;
    });
    if (!active) {
      throw new Error("Provider not found");
    }
    return active;
  },

  async listProvidersHealth(): Promise<ProviderProfile[]> {
    await wait();
    return [...mockProviders];
  },

  async testProvider(id: string): Promise<ProviderProfile> {
    await wait(600);
    const profile = mockProviders.find((p) => p.id === id);
    if (!profile) {
      throw new Error("Provider not found");
    }
    const updated: ProviderProfile = {
      ...profile,
      healthStatus: "healthy",
      healthCheckedAt: Math.floor(Date.now() / 1000),
      modelHealth: profile.models.map((model) => ({
        model,
        status: "healthy" as const,
        latencyMs: Math.floor(Math.random() * 500) + 100,
      })),
    };
    mockProviders = mockProviders.map((p) => (p.id === id ? updated : p));
    return updated;
  },
};

export async function mockSendUserMessage(
  message: { sessionId: string; content: string; uuid: string; timestamp: string },
  emit: (event: WebSocketEvent) => void,
) {
  const base = {
    sessionId: message.sessionId,
    data: { agentName: "principal" },
  };
  const text =
    `I can help turn "${message.content}" into a reproducible neuroscience workflow.\n\n` +
    "Suggested next steps:\n" +
    "1. Define the cohort and exclusion rules.\n" +
    "2. Select preprocessing checkpoints.\n" +
    "3. Record trace nodes for data, method, and result provenance.";

  emit({
    type: "user_message",
    sessionId: message.sessionId,
    seq: ++seq,
    data: {
      content: message.content,
      uuid: message.uuid,
      timestamp: message.timestamp,
      role: "user",
    },
  });
  await wait(120);
  emit({ ...base, type: "message_start", seq: ++seq });
  await wait(180);
  emit({
    ...base,
    type: "thinking_block_delta",
    seq: ++seq,
    data: { agentName: "principal", delta: { thinking: "Checking project context and sandbox state..." } },
  });
  await wait(80);
  emit({ ...base, type: "thinking_block_stop", seq: ++seq });
  await wait(160);
  emit({
    ...base,
    type: "content_block_start",
    seq: ++seq,
    data: {
      agentName: "principal",
      contentBlock: {
        type: "tool_use",
        id: "mock-tool-live-1",
        name: "record_trace",
        input: { summary: "Started reproducible workflow planning", node_type: "milestone" },
      },
    },
  });
  await wait(80);
  emit({
    ...base,
    type: "content_block_delta",
    seq: ++seq,
    data: {
      agentName: "principal",
      content: [
        {
          type: "tool_result",
          tool_use_id: "mock-tool-live-1",
          content: { status: "ok", node_id: "plan" },
        },
      ],
    },
  });
  await wait(40);
  emit({ ...base, type: "content_block_stop", seq: ++seq });

  if (message.content.toLowerCase().includes("error")) {
    await wait(80);
    emit({
      ...base,
      type: "error",
      seq: ++seq,
      data: { agentName: "principal", error: { message: "Mock API error path rendered as an error card." } },
    });
    return;
  }

  for (const chunk of text.match(/.{1,42}(\s|$)/g) || [text]) {
    await wait(80);
    emit({
      ...base,
      type: "content_block_delta",
      seq: ++seq,
      data: { agentName: "principal", delta: { text: chunk } },
    });
  }

  await wait(80);
  emit({ ...base, type: "content_block_stop", seq: ++seq });
  await wait(40);
  emit({ ...base, type: "message_stop", seq: ++seq });
  emit({
    ...base,
    type: "agent_status",
    seq: ++seq,
    data: { agentName: "principal", status: "idle", task: "Ready" },
  });
}

export function mockTerminalResponse(command: string): string {
  const trimmed = command.trim();
  if (!trimmed) {
    return "$ ";
  }
  if (trimmed === "pwd") {
    return "/workspace\n$ ";
  }
  if (trimmed === "ls") {
    return "README.md  data/  reports/  src/\n$ ";
  }
  if (trimmed.startsWith("cat README")) {
    return `${fileContents["/workspace/README.md"]}\n$ `;
  }
  return `mock-shell: ${trimmed}: command simulated\n$ `;
}

export function mockInitialTerminalOutput(): string {
  return "Mock terminal connected to /workspace\n$ ";
}
