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
`unsupported` list. The separate `source` field remains the catalogue transport
(`builtin`, `local`, or `https`). Older entries default to the BrainPilot source
format.
