/**
 * Pure helper for the "X 正在工作 / X is working" toast above the composer (#76).
 *
 * Selects which i18n key + vars the toast should render given the set of agents
 * currently working. Kept pure (no React) so it's unit-testable without a DOM —
 * the component just calls `t(key, vars)` with the result. The trace agent is
 * excluded by the caller (it self-records continuously and isn't "the user's
 * task"), matching the runtime's run-active aggregation.
 */
export interface ToastLabel {
  key: "chat.agentWorking" | "chat.agentsWorking" | "chat.agentThinking";
  /** Interpolation vars; shape matches i18n `TranslateVars` (string|number). */
  vars?: Record<string, string>;
}

/**
 * @param workingAgentNames names of non-trace agents with status "running"
 * @param separator locale-appropriate join for multiple names (default "、")
 */
export function runningToastLabel(
  workingAgentNames: readonly string[],
  separator = "、",
): ToastLabel {
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
