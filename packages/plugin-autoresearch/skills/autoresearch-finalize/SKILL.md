---
name: autoresearch-finalize
description: Finish and independently verify an autoresearch loop, restoring the best checkpoint and producing an evidence-backed report.
---

# Finalize Autoresearch

Call `autoresearch_finish`. It restores the best checkpoint, reruns the fixed benchmark and correctness command, captures a final checkpoint, and releases the workspace lease.

The engineer must independently inspect the changed files and rerun the reproduction command once. Report baseline, verified best metric, percentage improvement, iterations, accepted/discarded/crashed counts, final checkpoint, changed files, and remaining risks. v1 does not create Git commits or branches.
