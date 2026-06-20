# Markdown Report Templates (Annotated)

## 1. Project Report Template

```md
---
title: Project Name
author: Team / Agent
date: YYYY-MM-DD
tags: [project, report]
---

# Project Name

> One-line summary: this report covers project background, current progress, key risks, and next steps.

## Executive Summary

- Background:
- Current phase:
- Completed:
- Key risks:
- Next steps:

## Project Background

### Business Context

### Problem Definition

### Success Criteria

## Project Scope

### In Scope

- [x] Feature A
- [x] Feature B
- [ ] Feature C

### Out of Scope

- Item 1
- Item 2

## Architecture & Design

![System architecture diagram](./assets/fig-system.svg)

*Figure: Overall system architecture.*

### Core Modules

| Module | Responsibility | Input | Output |
|---|---|---|---|
| Data Layer | Data ingestion | Raw data | Standardized data |
| Service Layer | Analysis pipeline | Standardized data | Intermediate results |
| Presentation Layer | Output rendering | Intermediate results | Reports & charts |

### Key Workflow

​```mermaid
flowchart LR
    A[Requirements] --> B[Design]
    B --> C[Implementation]
    C --> D[Testing]
    D --> E[Delivery & Review]
​```

## Current Progress

| Item | Owner | Status | Notes |
|---|---|---|---|
| Requirements confirmed | @owner | Complete | Frozen |
| Data integration | @owner | In Progress | Awaiting API |
| Report template | @owner | Complete | Mermaid + footnotes |
| Release prep | @owner | Not Started | Depends on sign-off |

## Risks & Mitigation

| Risk | Impact | Likelihood | Mitigation |
|---|---|---|---|
| Data inconsistency | High | Medium | Field mapping checks |
| Broken asset links | Medium | Medium | Relative paths + CI validation |
| Scope creep | Medium | High | Change freeze window |

## Conclusion & Next Steps

### Conclusion

### Next Actions

- [ ] Complete integration
- [ ] Update diagrams
- [ ] Validate links
- [ ] Publish v1 report

## Appendix

- [Detailed design doc](./docs/design.md)
- [Data dictionary](./docs/data-dictionary.md)
- [System architecture SVG](./assets/fig-system.svg)

## Footnotes

Example terminology[^scope].

[^scope]: Scope freeze means no new high-impact requirements are introduced past the agreed cutoff date.
```

---

## 2. Experiment Report Template

```md
---
title: Experiment Name
author: Researcher / Agent
date: YYYY-MM-DD
tags: [experiment, report]
---

# Experiment Name

> One-line summary: what was tested, with what method, and what was found.

## Executive Summary

- Hypothesis:
- Method:
- Key results:
- Conclusion:

## Research Questions & Hypotheses

### Research Question

### Hypothesis

## Experimental Setup

### Environment

| Item | Value |
|---|---|
| OS | |
| Software version | |
| Dataset | |
| Time range | |

### Variables

| Type | Variable | Description |
|---|---|---|
| Independent | | |
| Dependent | | |
| Controlled | | |

## Procedure

1. Data preparation
2. Parameter configuration
3. Experiment execution
4. Result recording
5. Statistical analysis

​```mermaid
flowchart TD
    A[Data Prep] --> B[Execution]
    B --> C[Recording]
    C --> D[Analysis]
    D --> E[Conclusion]
​```

## Results

### Results Table

| Method | Metric A | Metric B | Notes |
|---|---:|---:|---|
| Baseline | | | |
| Method-1 | | | |
| Method-2 | | | |

### Charts

![Results comparison chart](./assets/fig-results.svg)

*Figure: Results comparison across methods.*

## Discussion

### Interpretation

### Error Sources

### Limitations

## Reproducibility

- [Experiment script](./code/run.py)
- [Config file](./configs/exp.yaml)
- [Raw results](./results/raw.csv)

## Conclusion

## Footnotes

Terminology[^metric].

[^metric]: Metric A is the primary evaluation metric; higher is better.
```

---

## 3. README Template

```md
# Project Name

> One-line description of the problem this solves and its core value.

[Quick Start](#quick-start) · [Docs](./docs/index.md) · [Changelog](./CHANGELOG.md) · [License](./LICENSE)

## About

What this project is, who it's for, and how it differs from alternatives.

## Features

- Feature A
- Feature B
- Feature C

## Project Structure

| Path | Description |
|---|---|
| `src/` | Core source code |
| `docs/` | Detailed documentation |
| `assets/` | Images and diagrams |
| `examples/` | Example inputs and outputs |

## Quick Start

### Installation

​```bash
# install command
​```

### Usage

​```bash
# run command
​```

### Example

​```bash
# example command
​```

## How It Works

​```mermaid
flowchart LR
    A[Install] --> B[Configure]
    B --> C[Run]
    C --> D[View Results]
​```

### Input & Output

| Type | Path | Description |
|---|---|---|
| Input | `examples/input.json` | Sample input |
| Output | `examples/output.md` | Sample output |

## Documentation

- [User Guide](./docs/user-guide.md)
- [Developer Guide](./docs/developer-guide.md)
- [FAQ](./docs/faq.md)

## Roadmap

- [ ] Release v1.0
- [ ] Plugin system
- [ ] Documentation site

## Contributing

Issues and pull requests welcome. Please read [CONTRIBUTING.md](./CONTRIBUTING.md) first.

## License

This project is licensed under [MIT License](./LICENSE).
```