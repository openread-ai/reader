---
name: openread-local-dev
description: Start Openread local development with five-platform scope, Notion/activity awareness, and parallel read-only platform scouts. Use at the beginning of Openread feature, fix, refactor, test, or chore work.
---

# Openread Local Development

Use this skill to start local Openread development safely.

## Flow

1. Confirm task scope and activity ID, if any.
2. Confirm platforms in scope: `web`, `macos`, `windows`, `ios`, `android`.
3. If an Activity ID exists, treat Notion Activity Log as source of truth and inspect local artifacts under `~/.openread-dev/activity-artifacts/`.
4. Run read-only platform scouts with `flow_agents` before editing.
5. Consolidate findings, then edit only from the coordinator session.
6. Commit with `/commit-logical` after each logical change.
7. Run appropriate gates and sync activity artifacts/Notion when activity scripts are involved.

## Parallel Platform Scouts

Use `flow_agents` in `parallel` mode with one task per in-scope platform. Default to read-only tools.

Suggested tasks:

- `web-scout`: inspect Web/browser impact, routes, Next.js code, Playwright chromium coverage.
- `macos-scout`: inspect Tauri desktop/macOS impact, WKWebView/webkit coverage, native config.
- `windows-scout`: inspect Windows/Edge/Tauri impact, paths, WebView2/Edge coverage.
- `ios-scout`: inspect iOS/Tauri mobile impact, mobile-webkit, native bridge, deep links.
- `android-scout`: inspect Android/Tauri mobile impact, mobile-chromium, package/activity/deep links.

Each scout must return:

```text
Summary
Evidence: file paths and commands
Risks
Required tests/gates
Recommended next step
```

## Activity/Notion Awareness

If the task is tied to an Activity ID:

1. Read local activity metadata/artifacts if present.
2. Use existing app scripts from `apps/openread-app` rather than inventing state:
   - `pnpm activity:init`
   - `pnpm activity:plan-capture`
   - `pnpm activity:bootstrap`
   - `pnpm activity:stage3`
   - `pnpm activity:stage3-test`
   - `pnpm activity:stage4`
   - `pnpm activity:stage4-native`
   - `pnpm activity:android-smoke`
   - `pnpm activity:stage8`
   - `pnpm activity:notion-sync --write`
3. Stop at approval gates: `Pending`, `Rejected`, `Needs Revision`.
4. Do not overwrite attempts; create a new attempt ID for retries.

## Quality Gates

Use platform scope to choose gates. Always include when relevant:

```bash
pnpm --filter @openread/openread-app lint
pnpm --filter @openread/openread-app build-web
pnpm --filter @openread/openread-app test -- --watch=false
```

For native work, add the relevant Tauri/Rust/iOS/Android checks from `AGENTS.md`.
