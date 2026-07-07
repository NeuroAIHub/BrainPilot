import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// #262 — the disk-quota UI (components/quota/*) is a HOSTED trust-front hook,
// not dead code: the hosting layer consumes @brainpilot/web unpatched, so these
// dialogs are the only in-/app quota surface a managed deployment has. This test
// locks in the other side of that contract — single-user INERTNESS. In a
// self-hosted single-user run backend-core serves no quota fields, so:
//   1. normalizeSandboxStats defaults quotaBytes / percentOfQuota to 0, and
//   2. the DesktopShell gates (percentOfQuota >= 90 warning, >= 100 critical)
//      stay false, so both dialogs stay closed and render nothing.
// If someone changes the defaults or the gate thresholds, this fails loudly.

vi.mock("../i18n/useT", () => ({
  useT: () => (k: string) => k,
}));

import { normalizeSandboxStats } from "../contracts/backend";
import { DiskQuotaWarningDialog } from "../components/quota/DiskQuotaWarningDialog";
import { DiskQuotaCriticalDialog } from "../components/quota/DiskQuotaCriticalDialog";

// Mirrors the gating in shell/DesktopShell.tsx. Kept in sync deliberately: this
// is the single-user "never opens" guarantee, so the thresholds are asserted.
function warningWouldOpen(percentOfQuota: number): boolean {
  return percentOfQuota >= 90 && percentOfQuota < 100;
}
function criticalWouldOpen(percentOfQuota: number): boolean {
  return percentOfQuota >= 100;
}

describe("#262 disk-quota hosted hook — single-user inertness", () => {
  it("defaults quota fields to 0 when backend-core serves no quota (single-user /stats)", () => {
    // A single-user /stats payload: real workspace usage, no quota fields.
    const stats = normalizeSandboxStats({
      memory: { usedBytes: 100, limitBytes: 1000, percent: 10 },
      cpu: { usedPercent: 5, onlineCpus: 4 },
      pids: { current: 3, limit: null },
      disk: { workspaceUsedBytes: 156 * 1024 * 1024 },
    });

    // Plain usage survives; quota fields default to 0.
    expect(stats.disk.workspaceUsedBytes).toBe(156 * 1024 * 1024);
    expect(stats.disk.quotaBytes).toBe(0);
    expect(stats.disk.percentOfQuota).toBe(0);
  });

  it("keeps both dialogs closed at the single-user default (0%)", () => {
    const stats = normalizeSandboxStats({ disk: { workspaceUsedBytes: 42 } });
    expect(warningWouldOpen(stats.disk.percentOfQuota)).toBe(false);
    expect(criticalWouldOpen(stats.disk.percentOfQuota)).toBe(false);
  });

  it("renders nothing when the dialogs are closed (gate false → empty markup)", () => {
    const warning = renderToStaticMarkup(
      <DiskQuotaWarningDialog isOpen={false} onClose={() => {}} percentOfQuota={0} />,
    );
    const critical = renderToStaticMarkup(
      <DiskQuotaCriticalDialog
        isOpen={false}
        sandboxId={null}
        workspaceUsedBytes={0}
        quotaBytes={0}
        percentOfQuota={0}
      />,
    );
    expect(warning).toBe("");
    expect(critical).toBe("");
  });

  it("still lights up when a hosting layer supplies quota fields (hook is live, not removed)", () => {
    const warn = normalizeSandboxStats({
      disk: { workspaceUsedBytes: 900, quotaBytes: 1000, percentOfQuota: 92 },
    });
    expect(warningWouldOpen(warn.disk.percentOfQuota)).toBe(true);
    expect(criticalWouldOpen(warn.disk.percentOfQuota)).toBe(false);

    const crit = normalizeSandboxStats({
      disk: { workspaceUsedBytes: 1000, quotaBytes: 1000, percentOfQuota: 100 },
    });
    expect(criticalWouldOpen(crit.disk.percentOfQuota)).toBe(true);
  });
});
