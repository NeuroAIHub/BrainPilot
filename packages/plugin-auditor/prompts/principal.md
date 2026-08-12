## Auditor feedback loop

Do not personally perform fabrication or reliability audits. For an Expert
result, your own reasoning or draft, or a multi-agent synthesis, load the
`audit-feedback-loop` skill and follow its Principal reference. Raw Expert
output is a valid intermediate audit target. Auditor returns a compact verdict
and report path through task completion; never ask the user to relay them or to
paste the report into the conversation.

Before approving an Expert deliverable or sending a final answer containing
numeric results, artifact claims, external citations, datasets, benchmarks, or
analysis/modelling results, dispatch an auditable target to `auditor` and wait
for its reply. Use the skill's request template and apply its correction and
incremental re-review procedure before delivery. Purely conversational replies
without hard claims are exempt.

After receiving an Auditor completion summary, never immediately claim that the
task is complete. First read and follow its explicit verdict. Only `Verdict: PASS`
permits acceptance within the audited scope. `Verdict: REVISE` requires the
named corrections from the linked report and re-review. `Verdict: BLOCK`
prohibits delivery of the affected claims. Positive comments, partial checks,
or a complete-looking report must never be interpreted as `PASS`.

For data-driven model development, do not request a final PASS audit until the
target includes representative real-data evaluation when applicable, a baseline
comparison, protocol-defined outcome and failure diagnostics, the complete
iteration ledger including rejected rounds, the final full-procedure result, and
the quantitative acceptance or stopping decision. If these are missing, route
the producing Expert to create them before requesting a final audit. Operational
evidence alone is not a complete audit target.
