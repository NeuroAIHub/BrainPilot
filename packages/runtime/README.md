# @brainpilot/runtime

The orchestration runtime for **BrainPilot** — the open-source, single-user
multi-agent platform built on TypeScript + the [Pi SDK](https://pi.dev). This
package owns the agent lifecycle and is the **state authority**: a Principal
agent coordinating specialist agents over a file-based mailbox, exposed as a
Hono + SSE server.

It is consumed by `@brainpilot/backend-core` (which proxies to it as a stateless
byte-passthrough) and, in hosted deployments, by the platform layer.

## What lives here

- `SessionManager` — session lifecycle, agent registry, **state authority**
  (`status = idle | running | error | stopped`), `metrics()`.
- `MasAgent` — per-agent wrapper over a Pi `AgentSession`; emits AG-UI events.
- System tools + access control, the external-MCP bridge, Graph-of-Trace.
- The Hono server (`./server`) with the SSE event stream.

All wire types come from `@brainpilot/protocol` (the zod SSOT).

## Persistent storage contract

The runtime is single-user: reusable cross-session files live directly under
`<BP_DATA_DIR>/data/`, while session workspaces live under
`<BP_DATA_DIR>/workspaces/<sessionId>/`. `/data/...` is the stable logical API
prefix. A hosted multi-user deployment must isolate users with separate data
roots/volumes; `BP_USER_ID` no longer selects a nested storage root.

On upgrade from the former `data/<userId>/` layout, startup migrates only the
known legacy directory (`BP_USER_ID`, or `local` when unset) and records the v2
layout outside the user-visible `data/` tree. Ambiguous mixed layouts fail
readiness without moving files so an operator can resolve them safely.

## Liveness contract (R-3)

The runtime imposes **no fixed wall-clock cap on a single agent turn.** A
multi-hour research run is never killed by a timer. Liveness is
**activity-based, not duration-based.**

**Guarantees:**

1. **No per-turn / per-prompt hard timeout.** There is no `120s`-style cap; the
   TS runtime has no turn cap at all. (The only `timeout` in this package is the
   provider connectivity **probe**, unrelated to agent turns.)
2. **A turn ends only on a real terminal condition** — the agent finishes the
   run, the run errors, or it is **explicitly aborted** via
   `SessionManager.interrupt(sessionId, agentName?)` (user stop) or
   `SessionManager.evictSession(sessionId)` (idle reclaim / shutdown). The
   runtime never aborts a turn on a timer of its own.
3. **No inactivity timeout either.** Silence is not treated as death.

**Liveness signal** — `SessionManager.metrics()` (served at `GET /metrics`) is
the authority a hosting layer should use:

| field | meaning |
|-------|---------|
| `runningAgents` | count of agents currently in `status === "running"` |
| `lastActivityAt` | ISO timestamp, advanced on **every** emitted event / state change (prompt accepted, status transition, run finished, …) |

**"Still alive" = `runningAgents > 0`, or a recently-advanced `lastActivityAt`.**
An idle reaper must key off these — never off elapsed wall-clock since the
prompt started. As long as a long-running agent keeps `runningAgents > 0` (or
keeps advancing `lastActivityAt`), it must not be reaped.

**Bash / tool calls** run inside the Pi SDK. The runtime adds no bash tool of
its own and configures no Pi turn/tool timeout. A separately configurable
per-tool timeout (e.g. a ~30min bash default) would belong at the Pi-SDK tool
layer and would not change the turn-liveness contract above.

**Validate end-to-end:** start a session, issue a prompt that runs longer than
any historical timeout, and poll `GET /metrics` — the run stays alive
(`runningAgents > 0`, `lastActivityAt` advancing) until the agent itself
completes, with no runtime-initiated abort.
