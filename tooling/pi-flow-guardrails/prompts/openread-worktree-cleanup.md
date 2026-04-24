---
description: Inspect Openread git worktrees and plan safe cleanup of stale or merged worktrees
argument-hint: '[scope or branch]'
---

Inspect Openread worktrees for safe cleanup:

$ARGUMENTS

Use read-only commands first. Do not remove worktrees or delete branches until the user approves.

Produce:

- worktree list with path, branch, HEAD, dirty count, and upstream if any
- merged/close candidates
- stale/local-only branches needing archive or review
- env/local artifact preservation warnings
- exact safe commands for the next approved cleanup step

Guardrails:

- never use `git worktree remove --force` unless explicitly approved
- never delete a branch with unmerged commits
- never remove a dirty worktree without commit/stash/archive
- never copy or commit `.env*` files
- keep cleanup commits/operations separate from feature work
