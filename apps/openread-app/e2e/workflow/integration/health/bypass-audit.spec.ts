// apps/openread-app/e2e/workflow/integration/health/bypass-audit.spec.ts
//
// Probe-driven workflow · bypass-audit health integration test (§8.2, J2).
//
// Covers: [axis 25] bypass-audit · [axis 26] audited-exit · [axis 27] bypass-reason
//
// Validates that invoking `/start-dev-health --skip-health` with
// requireBypassReason=true records a row in the gates table (or its
// bypass-sibling per §5.1) capturing the flag, actor, timestamp, and the
// current verdict state being bypassed. The row is immutable and queryable
// via `/state-query`.
//
// Reference: docs/probe-driven-workflow-implementation.md §7.4 (--skip-health),
//            scripts/health/bypass-audit.ts, §5.1 (state.db — bypass tracked
//            via gates table per Bundle F).

import { test, expect } from '../../../_helpers/probe.playwright.ts';

test.describe('health · bypass-audit', () => {
  test('[axis 25] --skip-health records bypass row with reason', async ({
    testDb,
  }) => {
    // GIVEN: phase-1 verdict would be YELLOW (e.g. stale pnpm-lock).
    //        requireBypassReason = true in workflow-config.json.
    // WHEN:  user runs `/start-dev-health --skip-health --reason="hotfix push"`.
    // THEN:  a bypass row is written with { flag='--skip-health',
    //        status='yellow', reason, actor, ts }, and exit code = 0 (bypass).

    test.skip(
      true,
      'bypass-audit — pending scripts/health/bypass-audit.ts + schema rows',
    );

    // TODO: seed a yellow-producing condition in testDb
    // TODO: execFile health/index.ts --skip-health --reason='hotfix push' --json
    // TODO: query testDb for bypass row
    // TODO: assert row fields: flag, status, reason present
    expect(testDb.path).toBeTruthy();
  });
});
