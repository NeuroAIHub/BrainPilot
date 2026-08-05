# Plugin and GoT runtime evaluation — 2026-08-05

## Scope

This evaluation used the deployed local BrainPilot runtime, DeepSeek
`deepseek-v4-flash`, Superpowers v6.2.0, real Pi sessions, runtime event logs,
token statistics, and controlled Graph of Trace (GoT) prompts. It supplements
unit tests; it is not a statistically powered model benchmark.

## Findings

### Superpowers

- The pinned Pi Package installs, enables, projects 14 Skills, and loads its
  trusted Pi extension correctly.
- An explicit request for `superpowers:systematic-debugging` located and read
  the upstream Skill and changed the answer structure toward fact/hypothesis
  separation and root-cause-first validation.
- Merely enabling the plugin did not cause the research task to use a
  Superpowers Skill. The agent used BrainPilot's existing EEG resources instead.
- Explicit Skill loading went through `bash`/`read`, so Skill usage telemetry
  remained empty. Namespaced loading should use the router/Skill API directly.
- Research quality was mixed. The Skill improved process structure but did not
  prevent unsupported wording or a scientifically unjustified regression
  threshold. Superpowers should remain an opt-in coding/debugging capability,
  not be presented as a general research-quality guarantee.

### GoT context

- The context extension replaces the previous GoT snapshot on every Principal
  turn and does not persist the injected block into Pi history.
- In a controlled continuation task, the no-GoT condition correctly reported
  insufficient context. With a 1,337-character GoT snapshot, the same model
  recovered `confidence: medium`, `reviewConclusion: uncertain`, selected a
  small validation run as the next action, and avoided repeating the diagnosis.
- The Pi Principal independently reported that GoT was useful for subsequent
  turns and avoiding duplicated work, but not for the first turn that created
  the node. It also identified duplicated node prose as non-incremental context.
- The controlled response latency increased from about 6.8 s without GoT to
  15.9 s with GoT. Current one-node snapshots are small (about 300–350 estimated
  tokens), but costs must be bounded as graphs grow.

### Correctness and design issues

1. **User evidence provenance is incomplete.** The user explicitly stated that
   scaler and ICA were fitted on all epochs, but the trace record context did
   not retain that fact. Auditor consequently called it an unsupported
   assumption. Trace records must bind the relevant user-message evidence or a
   durable message reference, not only an agent-authored summary.
2. **Large-graph selection keeps the oldest nodes.** With 120 synthetic active
   nodes, the 24,000-character renderer included nodes 0–27 and omitted the
   newest 92. Selection should prioritize task relevance, incomplete or
   uncertain state, and recent updates before filling the budget.
3. **Background accounting settles late.** Trace and Auditor runs can continue
   after the user-facing Principal run becomes inactive. Early stats therefore
   undercount total latency and tokens; the UI/API should distinguish response
   completion from background settlement.
4. **Long invisible reasoning harms feedback.** First visible text took roughly
   65–115 seconds in the tested research tasks, although the provider probe was
   healthy. Health checks should not be interpreted as generation-latency
   checks, and the UI needs a visible reasoning/progress state.
5. **Instruction compliance remains model-dependent.** One baseline run wrote a
   report after being told not to use tools or write files. Plugin compatibility
   does not provide a sandbox or guarantee behavioral compliance.

## Verification

- Targeted plugin, hooks, Skills, GoT, and marketplace tests: 57/57 passed.
- Full suite: 929/930 passed on the first parallel run; one Trace/Auditor restart
  test timed out and then passed 8/8 when rerun alone, indicating timing
  fragility rather than a deterministic failure.
- TypeScript project typecheck passed.

## Recommended order

1. Preserve source user evidence in bound Trace records and Auditor context.
2. Replace insertion-order GoT truncation with relevance/state/recency ranking.
3. Add background-settled status and accurate final usage accounting.
4. Route namespaced marketplace Skills through the Skill API and telemetry.
5. Repeat research evaluations across multiple tasks and seeds before claiming
   quality improvement.
