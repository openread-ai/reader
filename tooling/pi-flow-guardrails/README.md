# @openread/pi-flow-guardrails

Pi package for workflow guardrails, scoped commits, a productivity footer, read-only parallel agents, persisted run state, and an Openread-inspired theme.

## Install

From this repo:

```bash
pi install ./tooling/pi-flow-guardrails
```

For team/project-local loading, keep this in `.pi/settings.json`:

```json
{
  "packages": ["../tooling/pi-flow-guardrails"]
}
```

Or temporarily load while developing:

```bash
pi -e ./tooling/pi-flow-guardrails
```

## What it adds

- `flow-guardrails` extension
  - impact reminders before edits
  - dependent import scan for common `src/...` aliases
  - protected path warnings/blocks
  - `git add .` guard
  - dirty worktree budget warnings before branches accumulate too much WIP
  - staged secret scan before commits
  - optional post-edit auto-commit for files edited by the current Pi session only
  - `/commit-logical` scoped commit helper
  - custom status/footer
- `flow-concurrency` extension
  - `flow_agents` tool for read-only single/parallel/chain subagents
  - `/flow-parallel` template command
  - `/flow-tree` color-coded task-tree view for recent agent runs
  - status/footer includes branch, dirty count, and total git worktree count
- `openread-worktree` extension
  - `/openread-bootstrap` bootstraps the current worktree: submodules, dependencies, vendor assets
  - `/openread-worktree <branch>` creates and bootstraps a new Openread worktree
- `openread-night` theme
- `flow-guardrails` skill

## Policy

Environment variables:

```bash
PI_FLOW_MODE=warn          # observe | warn | block
PI_FLOW_MAX_DIRTY_FILES=5  # warns at max-1; gates over max in warn/block modes
PI_FLOW_AUTO_COMMIT=false  # optional: auto-commit files edited by this Pi session only
PI_FLOW_CONCURRENCY=4      # max concurrent read-only agents
PI_FLOW_MAX_TASKS=8        # max tasks per flow_agents call
```

Dirty budget stays simple: with the default max of `5`, Pi starts nudging at `4/5` and closes the flow gate over `5/5` in `warn` and `block` modes. Use `observe` for notifications only.

Auto-commit is off by default. When `PI_FLOW_AUTO_COMMIT=true`, the post-edit hook commits only files edited by the current Pi session and stages explicit paths; it does not touch unrelated dirty files from other sessions.

## Openread worktree bootstrap

Use these commands after `/reload`:

```text
/openread-bootstrap [--playwright]
/openread-worktree <branch> [--path <path>] [--base origin/main] [--playwright]
```

They run the standard Openread setup steps:

```bash
git submodule update --init --recursive
pnpm install --prefer-offline
pnpm --filter @openread/openread-app setup-vendors
```

`--playwright` also installs Chromium/WebKit through the app package. Reports are written outside the repo at:

```text
~/.pi/agent/flow-guardrails/openread-worktree-bootstrap.json
```

The commands are non-destructive: they do not remove existing paths, do not copy env files, and `/openread-worktree` stops if the source worktree is dirty.

Use `/openread-worktree-cleanup` to inspect stale/merged worktrees and produce safe cleanup commands before removing anything.

## Parallel agent model

Pi core intentionally keeps subagents out of the base product. This package follows Pi's extension model: it spawns isolated `pi --mode json -p --no-session` subprocesses with read-only tools by default.

Default tools for spawned agents:

```text
read, grep, find, ls
```

Agents return evidence and plans. The coordinator performs edits and commits.

When `flow_agents` runs, progress updates include a compact task tree, for example:

```text
… run-abc · parallel · running · 2 task(s)
├─ ✓ scout · done
│   cwd: /repo
│   task: inspect relevant files and existing patterns
└─ … planner · running
    cwd: /repo
    task: propose the smallest safe implementation plan
```

Use `/flow-tree` to show recent runs in this tree format. In the Pi UI, status is color-coded with theme colors: success, warning/running, error/failed, and dim tree guides.

The extension enforces read-only subagent tools (`read`, `grep`, `find`, `ls`) and constrains per-task `cwd` to stay under the coordinator working directory.

## State

Agent run state is stored outside repos:

```text
~/.pi/agent/flow-guardrails/state.json
```

This keeps repo history clean while making sessions inspectable.
