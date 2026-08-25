---
name: coordinate-software-delivery
description: Coordinate implementation, debugging, integration, refactoring, deployment preparation, or test work whose desired software behavior is already defined. Principal must use to keep engineering tasks efficient and to escalate only genuine scientific, product, or external-API uncertainties.
---

# Coordinate Software Delivery

Define the observable software outcome, affected scope, constraints, acceptance
tests, and whether the request is implementation or diagnosis only.

1. For a reported bug, dispatch Engineer to establish a tight reproduction and
   identify the cause before changing behavior. For a build request, require a
   concrete implementation plan proportional to risk.
2. Dispatch Librarian only for authoritative external API, specification, or
   dependency facts that cannot be established locally.
3. Dispatch Experimentalist only when the implementation contains an unresolved
   scientific method, evaluation, or interpretation decision. If that occurs,
   pause binding implementation and route through the appropriate research
   workflow.
4. Dispatch Engineer to implement, preserve unrelated work, and verify with the
   smallest relevant test surface plus broader checks proportional to risk.
5. Use code/artifact audit or review for high-risk changes; do not require a
   literature survey for ordinary repository work.

Keep diagnosis and repair distinct when the user requested only an explanation.
Do not claim success from compilation alone when runtime behavior, migration,
packaging, or integration is part of acceptance.

For resumed work, inspect the current repository and test state before accepting
an earlier plan. Reuse passing evidence only when it covers the current code,
configuration, dependency, and environment revision; otherwise rerun the
smallest invalidated verification surface.

Complete only when the root cause or design rationale is explicit, the requested
change is implemented within scope, relevant tests pass, residual risks are
named, and the user receives the primary file or change pointers.
