# Software Architect

## Capture

Capture knowledge at the right level of abstraction: specific enough to be actionable, general enough to apply beyond
the immediate project. Name the technology, library, or pattern involved so it can be found when working with it again.

### Architecture Decisions

- What was chosen, what was rejected, and why — including constraints that ruled out alternatives
- Tradeoff reasoning: what was sacrificed for what, and under what conditions that changes
- Assumptions baked into a decision (scale targets, team size, compliance requirements, legacy constraints)
- When and why a decision became superseded or regretted

### Technology & Vendor Evaluation

- Why tool/library/service X was chosen over Y — specific criteria applied, not just "X was better"
- OSS vs commercial tradeoffs: sustainability, licensing, ecosystem, support, lock-in exit costs
- Proof-of-concept outcomes: what was tested, what broke, what surprised
- Dependency risks: transitive dependencies, security patch cadence, project health signals

### Integration & API Design

- API contract decisions: versioning strategy, backward compatibility guarantees, evolution approach
- Integration patterns between systems: sync vs async, event-driven, data consistency models
- Boundary decisions: where systems split, what crosses the boundary, who owns the contract
- Data flow and transformation patterns that recur across different contexts

### Non-Functional Requirements

- Scalability targets discovered: throughput, latency, concurrency, data volume expectations
- Reliability patterns: fault tolerance, graceful degradation, SPOF identification, RTO/RPO targets
- Observability strategy: what to log, what to metric, what to trace, and why
- Security architecture: auth patterns, attack surface decisions, secrets management approaches
- Compliance and regulatory constraints that shaped architecture choices

### Failure Modes & Operational Reality

- How a system actually fails under specific conditions — not just that it can fail
- Cascading failure scenarios and how they were mitigated or accepted
- Operational surprises: what behaved differently in production than in design
- Configuration and environment conditions that affect system behavior non-obviously

### Patterns & Structural Insights

- When a specific architectural or design pattern fits a problem class — with the conditions that make it applicable
- When a pattern was tried and found to not fit — and why
- Migration and evolution strategies: strangler fig, parallel-run, feature flag approaches
- Conway's Law observations: how team or org structure shaped or constrained the architecture

## Skip

Skip anything that won't transfer beyond the immediate project or day.

- Project-specific business logic with no structural or transferable lesson
- Bugfixes unless they reveal a non-obvious systemic issue (e.g., a platform constraint, library behavior, or architectural root cause)
- Syntax or API usage covered clearly in official documentation
- Exploratory back-and-forth that reached no conclusion
- One-off configuration or environment changes with no broader applicability
- Incorrect or unverified hypotheses — if Claude guessed and was later proven wrong, do not capture it
