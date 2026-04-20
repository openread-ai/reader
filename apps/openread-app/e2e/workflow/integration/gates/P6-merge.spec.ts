// apps/openread-app/e2e/workflow/integration/gates/P6-merge.spec.ts
//
// Probe-driven workflow · P6 merge gate integration test (§8.2, J2).
//
// Covers: [axis 19] merge-gate · [axis 20] dnm-trailer ·
//         [axis 21] scorecard-aggregation
//
// Validates the P6 pause gate (final merge). Gate blocks unless:
//   - every deterministic probe pass (or audited-bypass)
//   - no `[DO-NOT-MERGE]` subject prefix
//   - no unresolved `Merge-Block:` trailer
//
// Reference: docs/probe-driven-workflow-implementation.md §8.5 (P6 row),
//            §10 (lefthook), `pause-gate-p6-merge.md`,
//            `scripts/hooks/dnm-trailer-check.js`.

import { test, expect } from '../../../_helpers/probe.playwright.ts';

test.describe('P6 · merge gate', () => {
  test('[axis 19] happy path · all probes pass, no DNM → merge allowed', async ({
    testDb,
    testWorktree,
  }) => {
    // GIVEN: scorecard rows exist for P1-P5 all in 'passed' state.
    //        HEAD commit subject + body have no DNM markers.
    // WHEN:  P6 gate evaluates.
    // THEN:  gates.P6.status = 'passed', CI fast-forward merge succeeds.

    test.skip(
      true,
      'P6-merge happy path — pending scorecard aggregator + dnm-trailer-check wiring',
    );

    // TODO: seed scorecards P1-P5 = 'passed'
    // TODO: craft HEAD commit with clean subject/body
    // TODO: run P6 gate
    // TODO: assert gates.P6.status = 'passed'
    expect(testWorktree.branch).toBeTruthy();
    expect(testDb.path).toBeTruthy();
  });

  test('[axis 20] DNM-subject prefix → merge blocked', async ({ testDb, testWorktree }) => {
    // GIVEN: commit subject starts with `[DO-NOT-MERGE]`.
    //        All other probes passing.
    // WHEN:  lefthook pre-push runs dnm-trailer-check.js AND P6 gate runs.
    // THEN:  pre-push exits non-zero, gates.P6.status = 'blocked',
    //        payload.reason includes 'DNM subject prefix'.

    test.skip(true, 'P6-merge DNM block — pending dnm-trailer-check.js (B7) + P6 wiring');

    // TODO: craft commit `[DO-NOT-MERGE] WIP: ...`
    // TODO: run dnm-trailer-check via execFile
    // TODO: assert exit code != 0
    // TODO: assert gates.P6.status = 'blocked'
    expect(testDb).toBeDefined();
    expect(testWorktree).toBeDefined();
  });
});
