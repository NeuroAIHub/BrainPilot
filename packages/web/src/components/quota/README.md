# `components/quota/` — hosted disk-quota UI (a hosted trust-front hook)

These components (`DiskQuotaWarningDialog`, `DiskQuotaCriticalDialog`,
`QuotaFileManager`) render the disk-**quota** experience: a 90% warning dialog,
a 100% critical dialog, and a quota file-manager. Disk *quota* is a
managed/multi-tenant concept with no meaning in single-user open-source.

**This is a hosted hook, not dead code — do not remove it.** (See issue #262,
which reversed an earlier "remove it" ask.)

## The contract

- The UI shell lives in open-source (`@brainpilot/web`).
- The *data* that drives it — `SandboxStats.disk.quotaBytes` and
  `SandboxStats.disk.percentOfQuota`, from `/stats` — is supplied **only** by a
  hosting layer. See `contracts/backend.ts` (`SandboxStats.disk`).
- In a self-hosted **single-user** run, backend-core serves no quota fields, so
  both normalize to `0` (`numberValue` fallback in `normalizeSandboxStats`). The
  gating in `shell/DesktopShell.tsx` is `percentOfQuota >= 90` (warning) and
  `>= 100` (critical), so with `0` defaults **the dialogs never open**. This
  inertness is guaranteed by a regression test
  (`__tests__/DiskQuotaHostedHook.test.tsx`).
- In a **hosted** run, the hosting layer fills `/stats` with real quota fields
  and the dialogs light up.

## Why it can't be deleted

The hosting layer consumes `@brainpilot/web` as an npm artifact and **must not
patch it**. Removing these components would leave managed deployments with no
in-`/app` quota surfacing at all — only raw 413s on over-quota upload. So the
front must ship in open-source even though its data source is hosted-only.

This mirrors the other hosted hooks: auth stripping (R-11) and subpath hosting
(R-9). Open-source provides the front; the hosted layer drives it.

## Not to be confused with

- `disk.workspaceUsedBytes` — plain workspace usage, meaningful single-user;
  drives the `SandboxStatus` disk meter. Unrelated to quota.
- `cpu.quotaPercent` and the `quota_exceeded` sandbox status — different
  concepts, not disk quota.
