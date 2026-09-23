# Workflow screen-share demo

This demo uses the native BrainPilot interface and real provider calls.
One operator opens the interface through an SSH tunnel and shares their screen.
The backend and runtime bind to `127.0.0.1`. This setup does not provide accounts for remote viewers.

## Prepare the host

Use an isolated Linux checkout and Node.js 22 or newer.
Install `pdflatex`, `bibtex`, `pdftotext`, and `pdftoppm` before the writing run.
Use an existing provider credential file outside the repository.

```sh
npm ci
npm run check:workflows
npm run build -w @brainpilot/backend-core
node scripts/workflow-provider-preflight.mjs \
  /absolute/private/provider.env /absolute/new/preflight APPROVED_MODEL_ID
node scripts/workflow-demo-server.mjs --create \
  --provider-env /absolute/private/provider.env \
  --output /absolute/new/demo \
  --model-id APPROVED_MODEL_ID --port 19340 --ttl-minutes 1440
```

The launcher reads credentials into its process environment.
Its owner record contains hashes of the provider file and reference path.
The provider profile stores the environment-variable name instead of the API key.
The launcher refuses occupied ports, existing create directories, and a resume with different configuration.

Run the launcher under a task-owned process supervisor for a presentation.
It writes `demo-ready.json` after startup and `demo-stopped.json` after shutdown.
The default lifetime is 24 hours. Shutdown preserves session files.
To restart the same demo, use the same arguments with `--resume` instead of `--create`.
Only resume after the previous launcher stops.

## Open the interface

From the operator's computer, forward the backend port:

```sh
ssh -N -o ExitOnForwardFailure=yes \
  -L 127.0.0.1:19340:127.0.0.1:19340 YOUR_TEST_HOST
```

Open `http://127.0.0.1:19340`.
Install and enable **PaperOrchestra-inspired writing** from Plugins.
After the provider preflight passes, declare the selected model's text and image input capabilities in the demo provider profile.
Create a session with low thinking and the configured literature resources.
The writing workflow uses the current session model, not the development-agent models.

Configure the existing paper-library and Tavily resources in this demo's data directory.
Keep their credentials outside Git. Do not copy unrelated user workspaces.

## Run the short example

Copy the [synthetic fixture](../../scripts/fixtures/workflow-demo/README.md) into the session workspace.
The fixture guide supplies exact paths and a paste-ready Chinese request.
Use its `raw_materials/` and `latex_template/` directories only.

1. Open the prepared session and inspect the supplied materials.
2. Submit the fixture request through chat.
3. Expand the `workflow_start` activity to show actual workflow admission.
4. Open Files to inspect outputs as the run saves them.
5. After completion, open the delivered TeX and PDF links.

The Stop button cancels active work and preserves committed artifacts.
Refreshing the page does not stop a running workflow.
An interrupted workflow does not resume from its last stage. A new request starts a new run.
The launcher can resume the application and its saved sessions; that is a separate operation.

The example targets a short document, but the native workflow still includes literature checks, reviews, revisions, and compilation.
Do not promise instant completion. Preserve failed runs and report their actual status.
The fixture values are synthetic. They do not establish a scientific effect.

## Show an existing real result

The separate replay server displays an already completed writing run:

```sh
node scripts/workflow-result-replay-server.mjs \
  --source /absolute/completed/writing-run \
  --output /absolute/new/replay --ttl-minutes 1440
```

It binds backend/runtime ports `19332` and `19333`.
Forward backend port `19332` to another local port, such as `19342`.
The copied session title identifies the historical date and read-only mode.
The replay server rejects mutations, creates no agents, and blocks external network requests.
It checks original artifact hashes and leaves the source run unchanged.

Show the original delivery message, PDF, editable source, and review records.
Describe this page as a historical result. It is not a new live execution.
Do not copy its private experiment directory or credentials into Git.
