# Shared-workspace subagents

BrainPilot persistent experts can run bounded, short-lived leaf agents for
parallel research and verification. A subagent is not another durable expert:
it receives a fresh conversation, the shared session workspace by default, a
private scratch directory, an explicit task and input manifest, and must return
through `submit_result`. Callers may request an isolated workspace explicitly.

## Lifecycle

1. An expert calls `spawn_subagent` with one to four tasks and a validated
   profile. It may wait immediately or retain child IDs for later polling.
2. `SubagentManager` creates an isolated history plus private scratch directory,
   then starts the child in the session workspace unless isolation was requested.
   It enforces per-session concurrency and execution timeout limits.
3. The first child may borrow the paused parent provider lease. This prevents a
   deadlock when provider concurrency is one while keeping other children
   bounded by the same semaphore.
4. A child calls `submit_result` once with `completed` or `blocked`. Shared-mode
   artifacts remain at their workspace paths; isolated artifacts are copied into
   `workspaces/<session>/subagent-results/<child>/`.
5. Lifecycle records are persisted, emitted as `subagent_state`, included in
   `session_state`, and shown separately from persistent experts in the Agents
   panel. Running children may be cancelled individually.

## Compatibility boundary

Profiles are version-1 `profile.json` plus `prompt.md`. Official profiles are
scaffolded without overwriting local edits; deployments may add profiles with
validated parent roles and tool allowlists. Leaf agents never receive agent
messaging, user-input, trace mutation, agent management, or recursive spawn
tools. Existing clients remain compatible because `session_state.subagents` is
optional in the protocol.
