# @brainpilot/plugin-sdk

Stable Manifest v1, Agent Instructions v1, service contracts and Preview RPC
v1 types for BrainPilot plugins. Previewers declare
`contributes.previewers[].match` and communicate with the host using the
exported `PreviewHostToPluginMessage` / `PreviewPluginToHostMessage` unions.

Node helpers under `@brainpilot/plugin-sdk/node` validate, scaffold, and pack JSON plugin bundles. Publishable manifests must declare a valid `engines.brainpilot` SemVer range; generated templates use the current lockstep BrainPilot minor range.

Conformance and compatibility-matrix helpers are exported from
`@brainpilot/plugin-sdk/testing`. The BrainPilot CLI exposes them as
`brainpilot plugin test`; no separate testing npm package is used.
