# Real-provider engineering acceptance fixture

These files contain **synthetic research values** for testing a real writing implementation. No EEG was collected, no participants were recruited, and no statistical analysis was executed. Successful software execution does not validate a scientific effect or manuscript quality.

The driver `scripts/workflow-real-acceptance.mjs` uses the normal SessionManager registry, real Pi/provider sessions, real Semantic Scholar retrieval and native LaTeX/PDF tools. The observer wrapper records calls and results but does not fabricate replies, force tool selection or call workflow start on the Principal's behalf.

Harness version 2 copies only `raw_materials/`, `latex_template/`, and `local_edit.md` into `/workspace/materials/`. This README, scenario names, expected outcomes, preflight reports and telemetry remain outside the Agent workspace and are not provided in prompts. The session title is the neutral `Research writing study`. Use neutral output directory names (for example a study UUID), because the actual working directory can appear in Pi's system context. The five earlier runs that exposed the harness README are exploratory records with evaluation leakage; they are not formal routing acceptance evidence.

Run only from the isolated, built 208 checkout. Every invocation needs a new absolute output directory. The output directory's parent must already exist.

```sh
node scripts/workflow-real-acceptance.mjs \
  --output /absolute/new/isolated/study-001 \
  --scenario qa \
  --provider-env /absolute/private/provider.env \
  --model-id EXACT_APPROVED_MODEL_ID \
  --preflight /absolute/verified-model-preflight.json
```

Other formal intent-routing observations are `short-report`, `local-edit`, `discussion`, and `missing-inputs`. They must use the same image-capable model/configuration and successful preflight as the positive case, so unavailable workflows cannot explain a zero-start result. They expose the same complete materials, except that `missing-inputs` removes the experimental log before the request. Every negative case requires both zero start attempts and zero accepted runs; a host-rejected start is still a routing failure. No question is automatically answered. A provider error without a usable Principal response cannot count as a routing pass.

For the full writing run:

```sh
node scripts/workflow-real-acceptance.mjs \
  --output /absolute/new/isolated/study-002 \
  --scenario positive \
  --provider-env /absolute/private/provider.env \
  --model-id EXACT_APPROVED_MODEL_ID \
  --preflight /absolute/verified-model-preflight.json
```

For every formal intent-routing case, `--preflight` must match the selected `modelId`, `protocol` (the actual profile API), and `endpointHash` computed from the **original unnormalized CUSTOM_BASE_URL string**. Its `text.status`, `tool.status` and `image.status` must all be `passed`. The tool probe must demonstrate ordinary automatic tool calling; a failed forced-tool-choice probe is not equivalent. The generic provider profile declares `inputModalities` per model only after image capability was actually verified. The driver also verifies the resulting Principal binding; it never patches its model object. Without these checks the formal case reports `blocked` and does not switch models.

The positive request asks naturally for a complete manuscript, bibliography, editable LaTeX and PDF. It does not name a workflow or prescribe tool selection. The `capability-missing` case uses that exact same request, with complete materials and a model whose image capability is not verified. This separate capability-boundary case needs matching successful text/tool preflight, but permits failed image preflight:

`explicit-positive` separately asks to use PaperOrchestra by name, with the same materials and complete-writing checks. Its `observationKind` is `explicit-workflow-execution`; success establishes explicit execution, never autonomous route selection. The original `positive` remains a natural request without naming a workflow.

```sh
node scripts/workflow-real-acceptance.mjs \
  --output /absolute/new/isolated/study-003 \
  --scenario capability-missing \
  --provider-env /absolute/private/provider.env \
  --model-id EXACT_TEXT_ONLY_MODEL_ID \
  --preflight /absolute/text-and-tool-preflight.json
```

Capability-boundary acceptance requires a real Principal `workflow_search` response showing `missingCapabilities` includes `images`, no start attempt or accepted run, and a completed explanation of the current model's image limitation. The explanation screen is accompanied by the actual text for human review. Such a result is labelled `observationKind: capability-boundary` and must not be pooled into intent-routing success or mis-trigger rates.

An explicitly authorized alternative **single main model** can be selected with `--model-id EXACT_ID`; all agents must inherit it, and the positive preflight must match it. No fallback model is selected automatically. Credentials stay in a process environment reference; provider JSON and script telemetry do not contain the API key. Pi config, state, workspaces, artifacts and logs are placed under the isolated output directory.

Optional `--scholar-env /absolute/private/scholar.env` reads `SEMANTIC_SCHOLAR_API_KEY` or `S2_API_KEY` as dotenv data and injects the value only into this process's environment. The value is never written into the provider profile or prompt, and it is included in raw/JSON/URL-form log redaction. The manifest records only the credential reference path and whether a credential was configured. Without this option, an existing process S2 key can still be used and is also redacted.

The provider concurrency cap is 2. The model-stage limit is 600 seconds, matching the host default so whole-manuscript generation is not repeatedly cancelled at the former 180-second cutoff. Parent Stop remains authoritative. The overall default is 45 minutes for writing and 5 minutes for adjacent observations; `--timeout-ms` may shorten this, never exceed 45 minutes, and no run may exceed the 60-minute whole-run maximum. Operator stop and the deadline interrupt the owned session. No production API or service deployment is targeted.

No hidden approval step exists by default. The driver never asks an operator to approve a stage, a workflow start or a model choice, and nothing is auto-approved on the Principal's behalf; the only run-affecting operator inputs are the documented flags, the credentials reference and the `STOP` file. Each required writing stage is judged only through the attempt that produced the final manuscript, so errors from superseded attempts are reported as recovered telemetry and never fail a later complete attempt, while an earlier attempt's success never covers a missing final-attempt stage. Earlier recovered errors appear in `real-acceptance-report.json` as telemetry (`recoveredStageErrors`, `recoveredAttempts`, `finalAttemptAccounting`), not as an acceptance gate.

`node scripts/workflow-writing-acceptance.mjs` runs the same accounting rules as a deterministic self-check. It makes no model or provider calls, needs no credentials, network or workspace, and prints a JSON result; use it to confirm the final-attempt gate before spending a real run.

Every 5 seconds, the driver saves `status.json`, `stages.json` and `usage.json`, with append-only event/call/HTTP observations. It records actual stage errors, retries, successful structured submissions, image payload counts, model binding and source/dist/input hashes. The fetch observer forwards requests unchanged; real Semantic Scholar 429s and failures remain visible and are never replaced with mocked metadata.

`real-acceptance-report.json` distinguishes:

- `passed_engineering_acceptance`: completed workflow plus real final LaTeX/PDF, artifact hashes, actual image-bearing stages, usable final review, nonempty verified citation map/BibTeX, citation-key reconciliation, unchanged inputs, the synthetic/null-result/value screen, and `resultDelivered: true`.
- `passed_observation`: one usable Principal routing observation, not a generalized success rate or a full writing run.
- `incomplete`: runtime may have produced outputs, but some citation, stage or fixture-fidelity acceptance remains unmet.
- `failed`: execution, routing or artifact acceptance failed.
- `blocked`: the selected model lacks matching verified vision or registered image capability.
- `interrupted`: operator Stop or the overall deadline; partial evidence, not a product failure or a passed observation.

Exit codes are 0 for the two scoped passes, 2 for incomplete, 1 for failed and 3 for blocked. `cleanup-error.json`, if present, indicates an additional shutdown issue and a nonzero exit. Human reading of the final manuscript remains necessary: metadata/abstract identity is not full-text claim verification, and model review scores are not real acceptance decisions.

Operator stop: create a regular `STOP` file at the run's output root, outside the Agent workspace. The driver writes an interrupted/partial report before cancelling its session; exit code is 2. SIGINT/SIGTERM listeners also remain installed through asynchronous cleanup so `signal-exit` cannot re-send the signal before evidence is flushed. Do not terminate an unrelated process or reuse an old output directory.

`provider-streams.ndjson` records only SSE event/type/termination metadata from a response clone. The original response is returned unchanged to Pi. The observer neither repairs a stream nor records thinking/text/tool-argument deltas; an incomplete response remains an error.

`resultDelivered` requires observing a Principal prompt containing this run's actual settled-outbox message, followed in that prompt by a completed nonempty response that references both actual final TeX and PDF paths. Initial accepted/start acknowledgments do not qualify. Ambiguous overlapping prompt correlation is not counted as delivery.
