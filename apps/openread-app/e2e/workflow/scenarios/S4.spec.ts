// apps/openread-app/e2e/workflow/scenarios/S4.spec.ts
//
// Probe-driven workflow · E2E scenario (§8.1, J1).
//
// S4 — T3 large · manual · sync rewrite non-UI
//
// Validates the largest tier (T3) routed through full-manual mode on a non-UI
// backend change (rewriting the sync engine). All 7 gates pause for a human
// decision; P2a/P2b/P5 are skipped by the non-UI conditional path but their
// skip must still be recorded as a manual acknowledgement under T3.

import { test, expect } from '../../_helpers/probe.playwright.ts';

test.describe('S4 — T3 large · manual · sync rewrite non-UI', () => {
  test('routes every gate to human in manual mode on non-UI rewrite', async ({
    testDb,
    testWorktree,
  }) => {
    // GIVEN: clean main, healthy pre-flight, large multi-commit change ahead
    //   - testDb: fresh state DB
    //   - testWorktree: clean main on a fresh branch
    //
    // WHEN: /start-dev intent "rewrite Supabase sync engine for offline-first"
    //   - platforms: [] (non-UI · core)
    //   - ui_change: no
    //   - tier: T3 (blast-radius crosses shared module)
    //   - mode: manual (T3 default)
    //   - every pause gate (P1, P2a, P2b, P3, P4, P5, P6) prompts a human
    //   - P2a/P2b/P5 are auto-skipped for non-UI but skip requires manual ack
    //
    // THEN:
    //   - SQLite features.tier = 'T3', mode = 'manual'
    //   - gates rows for all 7 gates exist with decided_by='human'
    //   - P2a/P2b/P5 verdict='skipped-ack', not 'passed'
    //   - no baselines written; lockfile + Rust + TS deltas form the diff

    test.skip(
      true,
      'S4 — pending conductor manual-mode router (§E1) and T3 blast-radius probe (§P4)',
    );

    // TODO: assert gates.count WHERE feature_id=? is exactly 7
    // TODO: assert every gates.decided_by = 'human'
    // TODO: assert non-UI gates have verdict 'skipped-ack' with a rationale note
    expect(testDb).toBeDefined();
    expect(testWorktree).toBeDefined();
  });
});
