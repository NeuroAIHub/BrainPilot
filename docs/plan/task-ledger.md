# Flat Task Ledger

## Summary

BrainPilot uses a durable, session-scoped flat task ledger for agent-to-agent work. Each task has an independent ID; an agent run may process several tasks. There are no task trees or run-to-task bindings.

`dispatch_task` creates work for another agent and `complete_task` returns a reply to the task's recorded creator. This replaces model-visible `send_message`, mailbox message types, and mutable per-agent delegator state.

## Contract

- Statuses are `pending`, `replied`, and host-only `cancelled`.
- Tasks are ordered with pending tasks first, then by creation sequence.
- Every non-trace agent receives a fresh `<task_list>` containing pending `assigned_to_me` and `delegated_by_me` entries.
- Completion replies are delivered once through `<task_events>`; failed provider runs leave their notifications unacknowledged for replay.
- Substantive replies name their primary workspace artifact. Downstream tasks name any upstream artifact they depend on.
- The runtime persists tasks, notifications, and reminder markers atomically in `.bp/<session>/tasks.json`.

Task changes use AG-UI `CUSTOM` events named `task_state`:

```ts
{ op: "snapshot", tasks: TaskRecord[] }
{ op: "created" | "replied" | "cancelled", task: TaskRecord }
```

Normal tool execution continues to use `TOOL_CALL_*`; warnings and terminal delivery errors use `system_message`.

## Delivery and failure behavior

- A committed assignment wakes its assignee; a committed completion wakes its exact `created_by` agent.
- Notifications are peeked in FIFO batches and acknowledged only after a clean provider run, giving at-least-once delivery.
- Duplicate completion with the same reply is idempotent; a different reply or wrong assignee is rejected.
- An assignee that takes no task action receives one follow-up. A second no-op keeps the task pending and notifies its creator. Reminder state survives restart.
- Retryable provider failures replay the same assignment up to the existing retry limit. Fatal or exhausted failures notify every affected task creator without changing task status.
- Permanently destroying an agent cancels its pending assignments and notifies their creators.
- Whole-session interruption persistently pauses queued notifications without deleting them; the next explicit user turn resumes delivery.
- Corrupt task ledgers fail closed and are never silently replaced with an empty ledger.
- Old mailbox files are deliberately not migrated or read.

## Risk and feasibility

| Risk | Level | Mitigation |
|---|---:|---|
| State and notification races | High | Serialized mutations, atomic file replacement, persist-before-event ordering |
| Duplicate delivery after crash | Medium | At-least-once notifications plus idempotent completion |
| Context growth | Medium | Pending-only task context, oldest-first 24k character budget |
| Reminder false positives | Medium | Assignment-only reminder, one persisted follow-up maximum |
| Upgrade loses unread mailbox messages | Medium | Explicit incompatibility; existing rendered history remains readable |
| No task UI in v1 | Low | Complete `task_state` snapshots and incremental events support a later UI |

Feasibility is high: the implementation reuses the existing serial delivery loop, provider concurrency limiter, Pi follow-up mechanism, EventBus, and AG-UI `CUSTOM` envelope without provider SDK changes.

## Acceptance checks

- Stable IDs, ordering, persistence, restart recovery, queue limits, and notification acknowledgement.
- Multiple independent tasks per agent, out-of-order completion, and exact creator routing under interleaving.
- Unauthorized, duplicate, self, and trace task operations.
- Safe delivery while an agent is already running and replay after provider failure.
- One reminder maximum and no reminder for completion events or ordinary runs.
- Valid `task_state` snapshots/increments and no runtime dependency on `send_message` or mailbox routing.
- Full typecheck, test suite, and build pass.
