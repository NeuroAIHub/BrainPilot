---
name: method-design
description: "Use this skill whenever the user wants to formalize a network architecture and derive theoretical components from a research idea. Triggers include: 'method design', 'design method', 'network architecture', 'formula derivation', 'method-design', 'theoretical framework', 'derive equations', or any request to transform IDEA.md into a detailed METHOD.md. This skill is the **mandatory interface-layer method formalizer** in NeuroClaw: it reads IDEA.md, designs concrete network structures (layers, modules, connections), performs mathematical derivations (equations, loss functions, proofs), and always outputs a structured METHOD.md."
license: MIT License (NeuroClaw custom skill – freely modifiable within the project)
layer: interface
skill_type: workflow
dependencies: []
---
# Method Design

## Overview
This skill implements the **Framework Formalization & Theoretical Derivation** process for the NeuroClaw method-design phase.

It acts as the Method Architect within the multi-agent framework:
- Reads the latest **IDEA.md** from the workspace.
- Designs the specific neural network structure (e.g., CNN backbone, attention modules, MRI-specific layers) tailored to the neuroscience task.
- Derives all necessary formulas (loss functions, gradients, convergence proofs, etc.) using symbolic or step-by-step reasoning.
- Produces a clean, publication-ready **METHOD.md** with sections: Architecture Diagram (text description), Detailed Layers, Mathematical Formulation, Implementation Notes, and Pseudocode.

If any part is ambiguous, it asks the user for clarification before proceeding.  
**Research use only** — the output is a mathematically rigorous METHOD.md ready for experiment-controller and paper-writing.

## Quick Reference (Method Flow)

| Step | Description                          | Output File            |
|------|--------------------------------------|------------------------|
| 1. Read & Parse | Load and analyze IDEA.md            | 01_idea_summary.md    |
| 2. Architecture Design | Define network layers & modules     | 02_architecture.md    |
| 3. Formula Derivation | Derive equations & proofs           | 03_formulas.md        |
| 4. Pseudocode & Notes | Generate implementation details     | 04_pseudocode.md      |
| 5. Finalize | Compile and polish                  | METHOD.md             |

## Installation
```bash
# Place files in: skills/method-design/
```

## Important Notes & Limitations
- Always starts from the latest IDEA.md; stops and prompts if missing.
- Every step saved as numbered .md files for transparency and resumption.
- Uses symbolic derivation (no hallucinated math); can call claw-shell or code tools internally for verification.
- Final output always saved as `METHOD.md` in workspace root.
- Diagrams are described in text (PlantUML/Mermaid ready); no image generation here.

## When to Call This Skill
- Immediately after research-idea skill completes IDEA.md
- When the user wants to specify network details or mathematical foundation
- Before experiment-controller or paper-writing

## Complementary / Related Skills
- `research-idea` → provides IDEA.md (input)
- `experiment-controller` → consumes METHOD.md
- `paper-writing` → consumes METHOD.md

## Reference
NeuroClaw architecture (section 1.5 method-design skill).  
Flow: IDEA.md parsing → architecture design → equation derivation → pseudocode → METHOD.md  

Created At: 2026-03-24 00:00 HKT
Last Updated At: 2026-03-26 00:14 HKT  
Author: chengwang96