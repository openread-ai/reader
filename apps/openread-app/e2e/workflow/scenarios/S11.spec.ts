// apps/openread-app/e2e/workflow/scenarios/S11.spec.ts
//
// Probe-driven workflow · E2E scenario (§8.1, J1).
//
// S11 — P5 regression → reject → fix → re-run
//
// Validates the visual-regression gate: a code change produces a pixel diff
// above threshold on at least one baseline. P5 must block, a human must
// reject, the agent must repair the implementation (not weaken the test),
// and a re-run must pass cleanly.

import { test, expect } from '../../_helpers/probe.playwright.ts';

test.describe('S11 — P5 regression → reject → fix → re-run', () => {
  test('blocks on pixel diff, routes to fix loop, then re-runs green', async ({
    testDb,
    testWorktree,
  }) => {
    // GIVEN: a UI feature at P5 with an existing baseline in the bucket
    //   - testWorktree: HEAD introduces a 12px padding shift that fails P5
    //   - testDb: gates P1..P4 already 'passed'
    //
    // WHEN: P5 gate runs
    //   - pixel-diff ratio exceeds p5PixelDiffRatio threshold
    //   - verdict 'rejected' recorded; human confirms intent is unchanged
    //   - agent opens fix loop; reverts the offending padding delta
    //   - P5 re-runs; new diff ratio below threshold; verdict 'passed'
    //
    // THEN:
    //   - SQLite gates.P5 has TWO rows: first rejected, second passed
    //   - baseline file is NOT modified (fix was on impl side)
    //   - bucket diffs/ retains the rejected diff artifact for 30d
    //   - commit log shows one impl-fix commit after the rejection

    test.skip(true, 'S11 — pending P5 visual gate + agent fix loop (§E6, §C4)');

    // TODO: assert gates WHERE gate='P5' returns 2 rows, verdicts [rejected, passed]
    // TODO: assert baseline PNG hash unchanged pre/post
    // TODO: assert git log has exactly one commit between the two P5 runs
    expect(testDb).toBeDefined();
    expect(testWorktree).toBeDefined();
  });
});
