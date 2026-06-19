/**
 * agent-status — a Pi-native extension that injects a fresh team-status block
 * at the top of EVERY turn for the agent it is registered on (#97).
 *
 * Why an extension / the `context` hook (not the system prompt):
 *  - The per-role persona is injected via `appendSystemPrompt`, which Pi
 *    evaluates ONCE at session creation. A team-status snapshot put there would
 *    be frozen at "session start" and go stale immediately.
 *  - Pi's `context` hook fires before EACH LLM call (every turn within a run)
 *    and lets an extension non-destructively rewrite the `messages` array that
 *    is sent to the model. That rewrite is per-turn EPHEMERAL — it is applied to
 *    a local copy and is NOT persisted to the session history (events.jsonl).
 *    So a status block injected here is recomputed and current on every turn,
 *    and never accumulates stale snapshots on disk.
 *
 * Mechanism (Pi SDK, verified against the docs corpus):
 *  - Registered per-AgentSession via DefaultResourceLoader.extensionFactories,
 *    same as trace-reminder. Closure state is naturally per-agent.
 *  - `context` handler receives `{ messages }` (a safe-to-mutate copy) and may
 *    return `{ messages }` to replace what the model sees this turn.
 *  - Because the host appends a NEW block each turn, we first STRIP any block we
 *    injected on a previous turn (identified by the `<agent_status>` opener) so
 *    the model only ever sees the latest snapshot, not a pile of old ones.
 *
 * Only the real factory loads this — the mock has no Pi event loop, so the
 * behavioural injection is verified in real mode. The pure block renderer
 * (`renderAgentStatusBlock`) and the strip/inject logic are unit-tested here via
 * a fake `pi`.
 */

/** One agent's live state, as seen by the status block. */
export interface AgentStatusLine {
  name: string;
  /** Authoritative status: idle | running | error | stopped. */
  status: string;
  /** Inbound messages still queued unread in this agent's inbox. */
  unread: number;
}

/** Opening tag — also the marker used to recognise a block we injected before. */
const TAG_OPEN = "<agent_status>";
const TAG_CLOSE = "</agent_status>";

/**
 * Build the team-status block as a natural-language list (#97, option B). The
 * wording is self-explanatory so the model needs no schema knowledge: each line
 * names an agent, its status, and how many messages are still waiting unread in
 * its inbox. Returns "" when there is nothing to report (caller skips injection).
 *
 * `lines` should already be filtered by the caller (trace agent excluded,
 * stopped agents excluded). Order is preserved.
 */
export function renderAgentStatusBlock(lines: readonly AgentStatusLine[]): string {
  if (lines.length === 0) return "";
  const body = lines
    .map((l) => {
      const n = l.unread;
      const msg = `${n} unread message${n === 1 ? "" : "s"}`;
      return `- ${l.name}: ${l.status}, ${msg}`;
    })
    .join("\n");
  return (
    `${TAG_OPEN}\n` +
    `Current agents (status, and how many messages are still waiting unread in each inbox):\n` +
    `${body}\n` +
    `${TAG_CLOSE}`
  );
}

/** Minimal structural surface of an agent the collector reads. */
export interface StatusAgentLike {
  name: string;
  role: string;
  status: string;
}

/**
 * Collect the status lines for a team snapshot from the live agents (#97).
 * Includes every agent — INCLUDING the principal, so it sees its own backlog —
 * except the trace agent (an internal recorder) and any stopped agent
 * (destroyed; irrelevant to coordination). `unreadOf` returns the number of
 * messages still queued unread in that agent's inbox. Order follows iteration.
 */
export function collectAgentStatusLines(
  agents: Iterable<StatusAgentLike>,
  unreadOf: (name: string) => number,
): AgentStatusLine[] {
  const lines: AgentStatusLine[] = [];
  for (const a of agents) {
    if (a.role === "trace") continue;
    if (a.status === "stopped") continue;
    lines.push({ name: a.name, status: a.status, unread: unreadOf(a.name) });
  }
  return lines;
}

/** Minimal structural surface of Pi's ExtensionAPI we depend on. */
interface PiContextMessage {
  role: string;
  content: Array<{ type: string; text?: string }>;
  timestamp?: number;
}
interface PiExtensionApi {
  on(
    event: "context",
    handler: (e: {
      messages: PiContextMessage[];
    }) => { messages: PiContextMessage[] } | void,
  ): void;
}

export interface AgentStatusDeps {
  /**
   * Compute the current status block. Called once per turn. Returns "" when
   * there is nothing to inject (the handler then only strips any stale block).
   */
  renderStatus: () => string;
}

/** True for a `user` message whose text is a status block we injected earlier. */
function isStatusMessage(m: PiContextMessage): boolean {
  return (
    m.role === "user" &&
    m.content.some((c) => c.type === "text" && (c.text ?? "").startsWith(TAG_OPEN))
  );
}

/**
 * Build the extension factory for one agent. The returned function is what Pi
 * calls with the per-session `ExtensionAPI`.
 */
export function makeAgentStatusExt(deps: AgentStatusDeps): (pi: PiExtensionApi) => void {
  return (pi) => {
    pi.on("context", (e) => {
      const block = deps.renderStatus();
      // Strip any block we injected on a previous turn so only the latest
      // snapshot survives (the context copy is ephemeral — this never touches
      // persisted history).
      const stripped = e.messages.filter((m) => !isStatusMessage(m));
      const removedSome = stripped.length !== e.messages.length;

      if (!block) {
        // Nothing to report this turn. Only return a rewrite if we actually
        // removed a stale block; otherwise leave the messages untouched.
        return removedSome ? { messages: stripped } : undefined;
      }

      stripped.push({ role: "user", content: [{ type: "text", text: block }] });
      return { messages: stripped };
    });
  };
}
