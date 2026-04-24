---
name: flow-guardrails
description: Use Pi workflow guardrails for scoped commits, impact analysis, parallel read-only research agents, and quality gates. Use when starting or coordinating repo work.
---

# Flow Guardrails

## Standard Flow

```text
scope → impact → edit → commit → lint/build → tests → review → security → push
```

## Parallel Agent Pattern

Use `flow_agents` for read-only research before editing:

- Run independent scouts in `parallel` mode.
- Use `chain` mode when later steps depend on prior findings.
- Keep editing in the coordinator session unless agents are isolated in separate worktrees.
- Agents should return evidence, risks, and plans — not mutate files.

## Commit Pattern

Use `/commit-logical`:

```text
/commit-logical <file...> -m <message> --why <why this logical change exists>
```

This stages explicit files only and records session/why metadata in the commit body.

## State

Use `/flow-tree` to inspect recent persisted parallel-agent runs. State is stored outside repos at:

```text
~/.pi/agent/flow-guardrails/state.json
```

## Policy Modes

Set `PI_FLOW_MODE`:

- `observe` — never blocks, only records/notifies
- `warn` — safe default, blocks broad staging and secret commits
- `block` — stricter protected-path behavior

Set `PI_FLOW_CONCURRENCY` and `PI_FLOW_MAX_TASKS` to tune parallelism.
