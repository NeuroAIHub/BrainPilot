/**
 * Guard every Pi model request, including requests made inside one tool loop.
 * Pi 0.84 checks its compaction threshold only after agent_end and before a new
 * top-level prompt. At this boundary all tool results have been persisted, so
 * Pi's own compactor can rebuild a paired, durable session context safely.
 */
type Message = {
  role: string;
  timestamp?: number;
  stopReason?: string;
  usage?: { totalTokens?: number; input?: number; output?: number; cacheRead?: number; cacheWrite?: number };
};

type PiContextSession = {
  model?: { contextWindow?: number; maxTokens?: number };
  settingsManager: { getCompactionSettings(): { enabled: boolean; reserveTokens: number } };
  sessionManager: { getBranch(): Array<{ type: string; timestamp?: string }> };
  agent: {
    state: { messages: Message[] };
    transformContext?: (messages: Message[], signal?: AbortSignal) => Promise<Message[]>;
    prepareNextTurnWithContext?: (
      turn: { context: { messages: Message[] } },
      signal?: AbortSignal,
    ) => Promise<{ context?: { messages: Message[]; [key: string]: unknown }; [key: string]: unknown } | undefined>;
  };
  _runAutoCompaction(reason: "threshold", willRetry: false): Promise<boolean>;
  _checkCompaction(message: { errorMessage?: string }, skipAbortedCheck?: boolean): Promise<boolean>;
  _getSummarizationRequestAuth(model: unknown): Promise<unknown>;
  abortCompaction(): void;
  subscribe(listener: (event: {
    type: string;
    reason?: string;
    aborted?: boolean;
    errorMessage?: string;
    result?: unknown;
  }) => void): () => void;
};

export function estimateRequestTokens(
  messages: Message[],
  estimateTokens: (message: Message) => number,
  latestCompactionAt = 0,
): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    const usage = message?.role === "assistant" && message.stopReason !== "error" && message.stopReason !== "aborted"
      ? message.usage
      : undefined;
    const total = usage
      ? (usage.totalTokens || (usage.input ?? 0) + (usage.output ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0))
      : 0;
    if (total > 0 && (message?.timestamp ?? 0) > latestCompactionAt) {
      return total + messages.slice(i + 1).reduce((sum, item) => sum + estimateTokens(item), 0);
    }
  }
  return messages.reduce((sum, item) => sum + estimateTokens(item), 0);
}

export function installContextCompactionGuard(
  session: unknown,
  estimateTokens: (message: Message) => number,
): void {
  const pi = session as PiContextSession;
  if (typeof pi.agent?.transformContext !== "function" ||
      typeof pi._runAutoCompaction !== "function" ||
      typeof pi._checkCompaction !== "function" ||
      typeof pi._getSummarizationRequestAuth !== "function" ||
      typeof pi.abortCompaction !== "function") {
    throw new Error("Installed Pi SDK lacks the model-request compaction boundary");
  }
  const previous = pi.agent.transformContext.bind(pi.agent);
  const previousSummaryAuth = pi._getSummarizationRequestAuth.bind(pi);
  let boundarySignal: AbortSignal | undefined;
  pi._getSummarizationRequestAuth = async (model) => {
    const auth = await previousSummaryAuth(model);
    // Pi creates its compaction AbortController only after this awaited auth
    // resolution. Stop during that gap must prevent a late summary request.
    if (boundarySignal?.aborted) throw new DOMException("Aborted", "AbortError");
    return auth;
  };
  const previousCheck = pi._checkCompaction.bind(pi);
  pi._checkCompaction = async (message, skipAbortedCheck) => {
    // Pi otherwise tries the same failed summary again in _handlePostAgentRun
    // after agent-core converts our boundary error into an assistant message.
    if (message.errorMessage?.startsWith("Context compaction failed:")) return false;
    return previousCheck(message, skipAbortedCheck);
  };
  const previousPrepare = pi.agent.prepareNextTurnWithContext?.bind(pi.agent);
  let needsContextRefresh = false;
  // The core loop owns a separate currentContext snapshot. After Pi rebuilds
  // state from the compaction entry, replace that snapshot at the next turn
  // edge. Later turns inherit it and keep their own context modifications.
  pi.agent.prepareNextTurnWithContext = async (turn, signal) => {
    const snapshot = await previousPrepare?.(turn, signal);
    if (!needsContextRefresh) return snapshot;
    needsContextRefresh = false;
    const context = snapshot?.context ?? turn.context;
    return { ...snapshot, context: { ...context, messages: pi.agent.state.messages.slice() } };
  };
  pi.agent.transformContext = async (messages, signal) => {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const settings = pi.settingsManager.getCompactionSettings();
    const model = pi.model;
    const window = model?.contextWindow ?? 0;
    const reserve = Math.max(settings.reserveTokens, model?.maxTokens ?? 0);
    if (!settings.enabled || window <= 0) return previous(messages, signal);
    if (window <= reserve) {
      throw new Error(`Context compaction failed: model context window (${window}) must exceed the reserved output budget (${reserve}) tokens.`);
    }

    const branch = pi.sessionManager.getBranch();
    const lastCompaction = branch.slice().reverse().find((entry) => entry.type === "compaction");
    const compactionAt = lastCompaction?.timestamp ? Date.parse(lastCompaction.timestamp) : 0;
    const latest = pi.agent.state.messages;
    const estimated = estimateRequestTokens(latest, estimateTokens, compactionAt);
    if (estimated <= window - reserve) return previous(messages, signal);

    let outcome: { aborted?: boolean; errorMessage?: string; result?: unknown } | undefined;
    const unsubscribe = pi.subscribe((event) => {
      if (event.type === "compaction_end" && event.reason === "threshold") outcome = event;
    });
    const abort = () => pi.abortCompaction();
    signal?.addEventListener("abort", abort, { once: true });
    boundarySignal = signal;
    try {
      await pi._runAutoCompaction("threshold", false);
    } finally {
      boundarySignal = undefined;
      signal?.removeEventListener("abort", abort);
      unsubscribe();
    }
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    if (!outcome?.result || outcome.aborted || outcome.errorMessage) {
      // Pi reports summary failures on compaction_end but otherwise swallows
      // them. Raise the actual cause so the run terminates and cannot request
      // the same overfull context repeatedly.
      throw new Error(`Context compaction failed: ${outcome?.errorMessage ?? (outcome?.aborted ? "cancelled" : "no usable summary was produced")}`);
    }
    needsContextRefresh = true;
    const rebuilt = pi.agent.state.messages.slice();
    const after = estimateRequestTokens(rebuilt, estimateTokens, Date.now());
    if (after > window - reserve) {
      throw new Error(`Context compaction failed: summary still exceeds the safe model-request budget (${after} > ${window - reserve} tokens).`);
    }
    return previous(rebuilt, signal);
  };
}
