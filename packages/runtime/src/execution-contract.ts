const HEADER = "# Command execution contract";

/** Add the runtime's shell policy only when the agent can actually invoke Bash. */
export function withExecutionToolContract(
  systemPrompt: string,
  allowedToolNames: readonly string[],
): string {
  if (!allowedToolNames.includes("bash")) return systemPrompt;

  const rules = [
    HEADER,
    "- Every `bash` call must explicitly set `timeout` in seconds. Use the shortest realistic deadline; the maximum is 300 seconds.",
    "- Use foreground Bash only for bounded inspection, builds, and short tests.",
  ];
  if (allowedToolNames.includes("run_in_background")) {
    rules.push(
      "- For model training, hyperparameter search, full-data evaluation, large simulation, and any workload expected to exceed 5 minutes, you must use `run_in_background` with an explicit `timeout_ms`; never run them in foreground Bash.",
    );
  } else {
    rules.push(
      "- Do not start model training, hyperparameter search, full-data evaluation, large simulation, or work expected to exceed 5 minutes; hand it to an agent that has `run_in_background`.",
    );
  }
  if (allowedToolNames.includes("start_monitor")) {
    rules.push("- Monitor is for streaming observation and event-driven wakeups, not for running training or other one-shot compute jobs.");
  }
  return `${systemPrompt.trim()}\n\n${rules.join("\n")}`;
}
