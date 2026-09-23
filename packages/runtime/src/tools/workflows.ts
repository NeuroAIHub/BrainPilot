import type { WorkflowDefinition, WorkflowRun } from "@brainpilot/plugin-sdk/workflow";
import type { SystemTool } from "../types.js";

export interface WorkflowCatalogEntry extends WorkflowDefinition {
  enabled: boolean;
  /** Present only when this session's actual PI model binding is readable. */
  missingCapabilities?: string[];
  /** Host/model capabilities only, not provider health, input completeness or scientific suitability. */
  hostCapabilitiesSatisfied?: boolean;
}

export interface WorkflowToolDeps {
  listWorkflows(): WorkflowCatalogEntry[];
  startWorkflow(args: { workflowId: string; input: unknown }): Promise<WorkflowRun>;
  getWorkflows(): WorkflowRun[];
  cancelWorkflow(runId: string): Promise<boolean>;
}
const result = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }] });
const schema = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false });
const text = { type: "string", minLength: 1 };
function view(run: WorkflowRun) {
  return { runId: run.id, workflowId: run.workflowId, status: run.status, acceptedAt: run.acceptedAt,
    modelBinding: run.modelBinding, artifacts: run.artifacts, result: run.result, error: run.error };
}
export function createWorkflowTools(deps: WorkflowToolDeps): SystemTool[] {
  return [
    {
      name: "workflow_search",
      description: "Read available workflow descriptions and their exact input schemas only when a task may benefit from a dedicated research workflow. Enabling is permission, not a requirement. If missingCapabilities is non-empty, explain the missing host/model capabilities and do not start that workflow. hostCapabilitiesSatisfied checks capabilities only; it does not mean materials or scientific preconditions are ready. Omitted capability fields mean unknown. Do not search this catalog for ordinary Q&A, short reports, local edits or status/thanks.",
      parameters: schema({ query: { type: "string" }, includeDisabled: { type: "boolean" } }),
      execute: async args => {
        const all = deps.listWorkflows().filter(item => item.enabled || args.includeDisabled === true);
        const query = typeof args.query === "string" ? args.query.toLowerCase() : "";
        const matching = query ? all.filter(item => JSON.stringify(item).toLowerCase().includes(query)) : all;
        return result({ workflows: (matching.length ? matching : all).slice(0, 5) });
      },
    },
    {
      name: "workflow_start",
      description: "Start an enabled workflow only when its full goal, necessary stages and input preconditions fit the user request. First obtain the input schema with workflow_search. A title/report format or multiple steps alone is not sufficient. This is asynchronous delegation: acceptance is not completion. Never duplicate an accepted run; wait for its terminal notification. A disabled workflow cannot start, even from an old conversation.",
      parameters: schema({ workflowId: text, input: { type: "object" } }, ["workflowId", "input"]),
      execute: async args => {
        if (typeof args.workflowId !== "string" || !args.workflowId.trim() || !args.input || typeof args.input !== "object" || Array.isArray(args.input)
          || Object.keys(args).some(key => key !== "workflowId" && key !== "input")) throw new Error("workflow_start requires only workflowId and an input object matching its definition");
        const run = await deps.startWorkflow({ workflowId: args.workflowId, input: args.input });
        return result({ ...view(run), instruction: "Accepted or previously accepted run. Do not claim the deliverable is complete unless status is succeeded; do not dispatch duplicate work. Terminal results are delivered to this conversation." });
      },
    },
    {
      name: "workflow_get",
      description: "Read this session's existing workflow state or results without starting a new run. Disabling does not hide historical results or stop an accepted run.",
      parameters: schema({ runId: text }),
      execute: async args => {
        const runs = deps.getWorkflows();
        const selected = typeof args.runId === "string" ? runs.filter(run => run.id === args.runId) : runs.slice(-10);
        return result({ runs: selected.map(view) });
      },
    },
    {
      name: "workflow_cancel",
      description: "Stop one existing workflow in this session when the user asks to stop it. The workflow enable/disable switch does not cancel accepted work. Historical artifacts remain.",
      parameters: schema({ runId: text }, ["runId"]),
      execute: async args => {
        if (typeof args.runId !== "string" || !args.runId) throw new Error("runId is required");
        return result({ runId: args.runId, cancelled: await deps.cancelWorkflow(args.runId) });
      },
    },
  ];
}
