import { describe, expect, it } from "vitest";
import { makeWorkspaceLeaseGuardExt } from "../extensions/workspace-lease-guard.js";

describe("workspace lease guard", () => {
  it("blocks mutating tools for non-owners and leaves reads available", () => {
    let handler!: (event: { toolName: string }) => { block?: boolean } | void;
    makeWorkspaceLeaseGuardExt(() => false)({ on: (_event, next) => { handler = next; } });
    expect(handler({ toolName: "write" })).toMatchObject({ block: true });
    expect(handler({ toolName: "bash" })).toMatchObject({ block: true });
    expect(handler({ toolName: "read" })).toBeUndefined();
  });

  it("allows the lease owner to mutate", () => {
    let handler!: (event: { toolName: string }) => { block?: boolean } | void;
    makeWorkspaceLeaseGuardExt(() => true)({ on: (_event, next) => { handler = next; } });
    expect(handler({ toolName: "edit" })).toBeUndefined();
  });
});
