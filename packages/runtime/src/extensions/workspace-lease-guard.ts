interface ToolCallApi {
  on(event: "tool_call", handler: (event: { toolName: string }) => { block?: boolean; reason?: string } | void): void;
}

const MUTATING_TOOLS = new Set(["write", "edit", "bash"]);

/** Prevent non-owner agents from mutating a workspace while autoresearch owns it. */
export function makeWorkspaceLeaseGuardExt(canMutate: () => boolean): (pi: ToolCallApi) => void {
  return (pi) => {
    pi.on("tool_call", (event) => {
      if (MUTATING_TOOLS.has(event.toolName.toLowerCase()) && !canMutate()) {
        return { block: true, reason: "workspace is exclusively leased by an autoresearch agent" };
      }
    });
  };
}
