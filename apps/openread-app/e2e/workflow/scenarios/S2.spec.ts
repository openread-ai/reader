// apps/openread-app/e2e/workflow/scenarios/S2.spec.ts
//
// Probe-driven workflow · E2E scenario (§8.1, J1).
//
// S2 — T0 auto chore · non-UI · playwright bump
//
// Validates the smallest non-UI chore (T0) running in full-auto mode.
// Example: bumping the @playwright/test dependency. No UI artifacts are
// produced; P2a / P2b / P5 are skipped by the non-UI conditional path.

import { test, expect } from '../../_helpers/probe.playwright.ts';

test.describe('S2 — T0 auto chore · non-UI · playwright bump', () => {
  test('completes non-UI auto pipeline with P2a/P2b/P5 skipped', async ({
    testDb,
    testWorktree,
  }) => {
    // GIVEN: clean main, healthy pre-flight, no Figma needed
    //   - testDb: fresh state
    //   - testWorktree: clean main
    //
    // WHEN: /start-dev intent "bump @playwright/test to latest"
    //   - platforms: [] (non-UI · infra)
    //   - ui_change: no
    //   - tier: T0
    //   - mode: auto
    //   - conductor skips P2a, P2b, P5 per non-UI conditional rule
    //
    // THEN:
    //   - SQLite features.stage = 'done'
    //   - gates table records P2a/P2b/P5 as 'skipped' (not 'passed')
    //   - no baselines written
    //   - lockfile delta + passing install form the full diff

    test.skip(true, 'S2 — pending conductor API (§E2) and auto-mode runner (§E1)');

    // TODO: assert gates.status = 'skipped' for P2a, P2b, P5
    // TODO: assert no entries under baselines/ for this feature
    // TODO: assert CI green on lockfile-only diff
    expect(testDb).toBeDefined();
    expect(testWorktree).toBeDefined();
  });
});
