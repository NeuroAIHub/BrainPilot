---
name: create-data-inventory
description: Create or update the canonical Markdown inventory of task-relevant research data. Engineer must invoke this skill before creating or updating any data inventory, data contract, or dataset-coverage summary that downstream agents will use.
---

# Create Data Inventory

Inspect the task's authorized data locations before formal analysis, modelling,
training, or evaluation. Use bounded metadata and representative-content checks
to identify every task-relevant dataset, subject, session, run, partition, and
label source that is visible within the assigned scope. Reconcile counts across
filenames, metadata, labels, and loaded shapes; state unresolved discrepancies
instead of guessing.

Write one canonical Markdown document at `docs/specs/data-inventory.md`. Create
the parent directory when needed. If the document already exists, read it first
and revise it in place so downstream agents retain one authoritative path.

Include:

- the task scope and every location inspected;
- a table of discovered data sources with paths, formats, sizes or record counts,
  subjects, sessions, runs, trials or other natural grouping units;
- loaded structure where relevant: shapes, axes, dtypes, value domains, feature
  ordering, labels and label mappings;
- documented or observed split relationships and grouping boundaries;
- reconciled totals and the checks used to obtain them;
- missing metadata, ambiguous mappings, unreadable inputs, discrepancies, and
  any parts of the assigned scope that could not be inspected;
- concise implications that Experimentalist, Librarian, Engineer, and Auditor
  must preserve when designing or reviewing later work.

Keep the inventory descriptive. Do not train models, choose methods, freeze
hyperparameters, or treat inventory inspection as empirical validation. Link
supporting metadata or inspection outputs when they are useful, but keep the
inventory self-contained enough that another agent can use it without repeating
the discovery work.

Before handoff, verify that every discovered task-relevant grouping is accounted
for, totals agree or are explicitly unresolved, and every referenced path exists.
Return `docs/specs/data-inventory.md` as the primary artifact and direct dependent
agents to read it before using the data.
