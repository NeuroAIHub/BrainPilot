/**
 * Pure helper for the "X 正在工作 / X is working" toast above the composer (#76).
 *
 * Selects which i18n key + vars the toast should render given the set of agents
 * currently working. Kept pure (no React) so it's unit-testable without a DOM —
 * the component just calls `t(key, vars)` with the result. Background agents
 * such as Trace remain visible even when they do not hold runState active.
 */
export interface ToastLabel {
  key: "chat.agentWorking" | "chat.agentsWorking" | "chat.agentThinking" | "chat.agentRetrying" | "chat.agentsWorkingRetrying";
  /** Interpolation vars; shape matches i18n `TranslateVars` (string|number). */
  vars?: Record<string, string | number>;
}

export interface RetryingAgent {
  name: string;
  attempt: number;
  maxAttempts: number;
  delayMs: number;
}

/**
 * @param workingAgentNames names of all agents with status "running"
 * @param separator locale-appropriate join for multiple names (default "、")
 */
export function runningToastLabel(
  workingAgentNames: readonly string[],
  separator = "、",
  retryingAgent?: RetryingAgent,
): ToastLabel {
  if (retryingAgent) {
    const others = workingAgentNames.filter((name) => name !== retryingAgent.name);
    if (others.length > 0) {
      return {
        key: "chat.agentsWorkingRetrying",
        vars: {
          names: others.join(separator),
          name: retryingAgent.name,
          attempt: retryingAgent.attempt,
          max: retryingAgent.maxAttempts,
          sec: Math.ceil(retryingAgent.delayMs / 1000),
        },
      };
    }
    return {
      key: "chat.agentRetrying",
      vars: {
        name: retryingAgent.name,
        attempt: retryingAgent.attempt,
        max: retryingAgent.maxAttempts,
        sec: Math.ceil(retryingAgent.delayMs / 1000),
      },
    };
  }
  if (workingAgentNames.length === 1) {
    return { key: "chat.agentWorking", vars: { name: workingAgentNames[0]! } };
  }
  if (workingAgentNames.length > 1) {
    return { key: "chat.agentsWorking", vars: { names: workingAgentNames.join(separator) } };
  }
  // Streaming but no named running agent yet (status not yet "running"): keep the
  // generic label so the toast never renders blank.
  return { key: "chat.agentThinking" };
}
