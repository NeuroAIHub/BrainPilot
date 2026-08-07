---
name: autoresearch-hooks
description: Pause, resume, stop, or inspect a running autoresearch session safely.
---

# Autoresearch Lifecycle

- `autoresearch_status`: inspect persisted state and budgets.
- `autoresearch_pause`: restore any unrecorded candidate, persist state, and release the lease.
- `autoresearch_resume`: reacquire the lease and recover an interrupted candidate before continuing.
- `autoresearch_stop`: restore unrecorded work, mark the session stopped, and release the lease.

Never edit the persisted plugin state directly. A stale workspace or checkpoint failure pauses the loop and requires inspection rather than forced overwrite.
