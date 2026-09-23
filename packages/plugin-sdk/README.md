# @brainpilot/plugin-sdk

Stable Manifest v1, Agent Instructions v1, service contracts and Preview RPC
v1 types for BrainPilot plugins. Previewers declare
`contributes.previewers[].match` and communicate with the host using the
exported `PreviewHostToPluginMessage` / `PreviewPluginToHostMessage` unions.

Node helpers under `@brainpilot/plugin-sdk/node` validate, scaffold, and pack JSON plugin bundles. Publishable manifests must declare a valid `engines.brainpilot` SemVer range; generated templates use the current lockstep BrainPilot minor range.

Conformance and compatibility-matrix helpers are exported from
`@brainpilot/plugin-sdk/testing`. The BrainPilot CLI exposes them as
`brainpilot plugin test`; no separate testing npm package is used.

## Catalogue and lifecycle

BrainPilot reads the built-in catalogue, `<dataDir>/plugins/marketplace.json`,
and optional HTTPS catalogues declared in
`<dataDir>/plugins/marketplace-sources.json`. Catalogue releases point to an
immutable JSON bundle and its SHA-256 digest. Installed state is kept under
`<dataDir>/plugins/`; incompatible plugins remain installed but cannot be
enabled. Updates keep one real previous bundle for rollback.

Catalogue entries may also describe provenance without changing Manifest v1:
`sourceFormat` (`brainpilot`, `codex`, `claude-code`, or `pi-package`), an HTTPS
`repositoryUrl`, `license`, pinned `upstreamRef` / `upstreamCommit`, compact
`capabilities` (`skills`, `mcp`, `hooks`), runtime `requirements`, and an
`unsupported` list. `executesLocalCode` lets the details panel warn before a
trusted Pi extension or other executable integration is enabled, without adding
another badge to compact cards. The separate `source` field remains the catalogue transport
(`builtin`, `local`, or `https`). Older entries default to the BrainPilot source
format.

Enabled local Pi packages may declare `package.json#pi.extensions`. BrainPilot
loads only extension files copied into that immutable installed plugin root;
host-global Pi extension discovery remains disabled. Extension paths must be
relative JavaScript or TypeScript files, take effect in new sessions, and are
removed from new sessions when the plugin is disabled. Enabling such a plugin
is an explicit trust decision because Pi extensions execute in the agent
runtime.

## Experimental native workflows

`@brainpilot/plugin-sdk/workflow` exports `defineWorkflow`, JSON Schema 2020-12
validation, and the Definition / Run / Context / Artifact contracts. A workflow
is a TS implementation inside the BrainPilot host, not a separately deployed SDK
service. Manifest v1 continues to describe installation; workflow protocol `1`
describes execution.

Definitions declare an ID/version, applicability and exclusion conditions,
required capabilities, and input/output schemas. `outputSchema` validates
`result.data`; `summary`, `artifacts` and optional `issues` form the shared result
envelope. Domain-specific concepts such as paper sections, spike units or QC
metrics belong in those schemas, not in the SDK.

The host supplies `ctx.readText`, `ctx.writeArtifact`, `ctx.runAgent`, `ctx.runTool`, `ctx.emit`
and an `AbortSignal`. Every model stage uses the principal's actual provider,
model runtime and thinking level captured at acceptance. A stage requests a
structured output schema; it cannot select a different model. Artifact records
contain a workspace path, media type, role, hash and producing run ID. The host
commits immutable output files into a run-specific directory.

Disabling denies **new** starts; accepted queued/running work keeps its original
authorization and continues. Session Stop aborts preflight and execution and
preserves committed artifacts. Retrying the same idempotency key and input reads
the original run; changed input with that key conflicts. The first principal
tool permits one input per workflow per user-turn epoch. Repeated same-workflow
composition in a single epoch needs a later explicit dispatch identity.

This first host supports trusted bundled implementations, model stages, image
attachments and a small allowlisted tool set, with `resume: false`. LaTeX compilation,
PDF rendering and resource copying are host tools; plugins cannot supply arbitrary
shell commands through this interface. Image capability is taken from the actual
Pi model. Parallel stages share the host's existing provider capacity and cancellation.
After process restart, unfinished runs
become `interrupted`; durable terminal results are reconciled to the conversation
without re-executing them. Dynamic third-party loaders, additional domain tools,
stage resume and multi-user plugin-setting ownership remain future
extensions. The concrete workflow defines its stages and final deliverables.
Run success records completion of that workflow; scientific validity requires
the applicable evidence and evaluation.

The writing plugin follows PaperOrchestra's original automatic refinement flow.
There is no sentence-level revision protocol, author-approval action, or manuscript
hash approval gate in the SDK. Existing artifact metadata and run isolation remain
host bookkeeping rather than additional writing stages.

The native host also exposes `research_search` and `research_resolve` through
`ctx.runTool`. These use the current session's permitted paper library and
already configured Tavily connector. Workflow implementations receive normalized
source evidence, never service credentials or arbitrary MCP access. Library
permissions are re-evaluated for each request; cancellation is forwarded to the
existing MCP call. Native compilation/file tools remain separate capabilities.
