// apps/openread-app/e2e/workflow/scenarios/S1.spec.ts
//
// Probe-driven workflow · E2E scenario (§8.1, J1).
//
// S1 — T1 small UI · hybrid · iOS-only · no existing Figma
//
// Validates the smallest UI-touching feature size (T1) going through the
// hybrid (auto-with-human-checkpoints) mode on iOS only, with no pre-existing
// Figma source. The agent must synthesise HiFi output from the Apple iOS 26
// Figma kit + Tokens Studio rather than reading an existing frame.

import { test, expect } from '../../_helpers/probe.playwright.ts';

test.describe('S1 — T1 small UI · hybrid · iOS-only · no existing Figma', () => {
  test('completes full pipeline end-to-end', async ({ testDb, testWorktree, mockFigma }) => {
    // GIVEN: clean main, healthy pre-flight, TRP paired, Figma MCP ready
    //   - testDb: fresh SQLite state DB seeded with empty features table
    //   - testWorktree: git worktree on clean main, no in-flight features
    //   - mockFigma: responding but with no existing file for this feature
    //
    // WHEN: /start-dev invoked with intent "add pencil highlight"
    //   - platforms: [ios]
    //   - ui_change: yes
    //   - tier: T1 accepted
    //   - mode: hybrid
    //   - agent creates HiFi from Tokens Studio + Apple iOS 26 kit
    //   - all 7 gates (P1..P6 + L4/L5) pass
    //   - merge to main succeeds
    //
    // THEN:
    //   - SQLite features.stage = 'done'
    //   - 5 baseline PNGs written under ~/.openread-dev/artifacts/baselines/
    //   - baselines.manifest.json committed to main

    test.skip(
      true,
      'S1 — pending orchestration helpers (driver facade, /start-dev stub, gate runners)',
    );

    // TODO: implement once Bundle C (probe.playwright.ts facade) and
    // Bundle E (pause-gate agents + conductor API) land.
    // TODO: assert testDb.query("SELECT stage FROM features WHERE slug=?")
    // TODO: assert bucket manifest contains 5 baselines for mobile-webkit project
    // TODO: assert mockFigma received draft-frame create call (no read)
    expect(testDb).toBeDefined();
    expect(testWorktree).toBeDefined();
    expect(mockFigma).toBeDefined();
  });
});
