// apps/openread-app/e2e/workflow/scenarios/S14.spec.ts
//
// Probe-driven workflow · E2E scenario (§8.1, J1).
//
// S14 — Two features reach P6 simultaneously
//
// Validates the PR merge gate under a race: two features independently open
// PRs and both clear L5. P6 must serialise merges (no double-merge to main)
// and re-run L5 on the loser once main advances, without human re-prompting.

import { test, expect } from '../../_helpers/probe.playwright.ts';

test.describe('S14 — Two features reach P6 simultaneously', () => {
  test('serialises merges and rebases the loser cleanly', async ({ testDb }) => {
    // GIVEN: two features, F1 and F2, both passed L5 on open PRs
    //   - testDb: gates P1..P5 'passed' for both
    //   - main HEAD is a common ancestor of both
    //
    // WHEN: both conductors attempt P6 at roughly the same instant
    //   - merge lock acquired by F1 first (CAS on features.merge_lock)
    //   - F2 sees lock held, parks its P6 attempt
    //   - F1 merges; main advances; F1 scorecard flips to 'done'
    //   - F2 auto-rebases on new main and re-runs L5
    //   - F2 merges after its L5 passes
    //
    // THEN:
    //   - main has exactly two new commits in order F1→F2
    //   - gates.P6 for F1 has one row (verdict=passed)
    //   - gates.P6 for F2 has two rows: [parked-retry, passed]
    //   - no human prompt during F2's rebase-and-retry loop

    test.skip(true, 'S14 — pending P6 merge-lock + auto-rebase loop (§E6, §L5)');

    // TODO: assert git log --first-parent main shows F1 then F2
    // TODO: assert F2 gates.P6 count === 2 with verdict order
    // TODO: assert no entries in human_prompts table for F2 during re-run
    expect(testDb).toBeDefined();
  });
});
