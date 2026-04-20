// apps/openread-app/e2e/workflow/scenarios/S6.spec.ts
//
// Probe-driven workflow · E2E scenario (§8.1, J1).
//
// S6 — Red pre-flight → --fix → resume
//
// Validates the /start-dev-health two-phase pre-flight: an initial red layer
// blocks the pipeline, the user runs the `--fix` auto-remediation pathway,
// and the pipeline resumes from the checkpoint without losing intake state.

import { test, expect } from '../../_helpers/probe.playwright.ts';

test.describe('S6 — Red pre-flight → --fix → resume', () => {
  test('blocks on red layer, auto-fixes, then resumes from checkpoint', async ({
    testDb,
    testWorktree,
  }) => {
    // GIVEN: a deliberately-unhealthy environment
    //   - testDb: seeded with stale schema version (L6 red)
    //   - testWorktree: dirty lockfile and a stray untracked migration
    //
    // WHEN: /start-dev is invoked
    //   - pre-flight phase 1 reports RED (exit 2) → conductor halts at L0
    //   - user runs `/start-dev-health --fix`
    //   - remediation: runs schema migration, restores lockfile, removes orphan
    //   - pre-flight phase 2 (post-dialog) re-runs and is GREEN
    //   - conductor resumes from L1 intake with original intent preserved
    //
    // THEN:
    //   - SQLite features row carries the original slug and intent
    //   - health_checks table logs two runs: red-pre-fix, green-post-fix
    //   - bypass_audit has zero entries (auto-fix is not a bypass)

    test.skip(true, 'S6 — pending /start-dev-health (§F3) and --fix remediation plan (§F3)');

    // TODO: assert exit code 2 on the first run, then 0 after --fix
    // TODO: assert features.stage advanced past 'pre-flight' after fix
    // TODO: assert no gates.verdict='bypassed' entries for this feature
    expect(testDb).toBeDefined();
    expect(testWorktree).toBeDefined();
  });
});
