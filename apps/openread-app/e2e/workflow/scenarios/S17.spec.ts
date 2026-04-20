// apps/openread-app/e2e/workflow/scenarios/S17.spec.ts
//
// Probe-driven workflow · E2E scenario (§8.1, J1).
//
// S17 — Shadow 14d → 92% agreement → flip live
//
// Validates calibration of agent-scored gates. For 14 consecutive days the
// shadow-mode logger records both the agent's would-be verdict and the
// human's actual verdict. If agreement ≥ 0.90, the gate flips from shadow
// to live auto-scoring on the next invocation.

import { test, expect } from '../../_helpers/probe.playwright.ts';

test.describe('S17 — Shadow 14d → 92% agreement → flip live', () => {
  test('flips a gate from shadow to live after 14d ≥ 90% agreement', async ({ testDb }) => {
    // GIVEN: a gate (e.g. P2a) currently in shadow mode
    //   - testDb: shadow_log seeded with 14 days of pairs
    //   - 92% of pairs match (agent verdict == human verdict)
    //   - the 15th day begins
    //
    // WHEN: the daily shadow-reconcile cron runs
    //   - computes rolling 14d agreement pct
    //   - result: 0.92 ≥ 0.90 threshold for 14 consecutive days
    //   - updates gate_config.P2a.mode from 'shadow' to 'auto'
    //   - next feature to hit P2a gets an agent-scored verdict with no human
    //
    // THEN:
    //   - gate_config table reflects the flip with a timestamp
    //   - the next feature's P2a gate row has decided_by='agent'
    //   - if any day later drops below 0.90, mode reverts to 'shadow'

    test.skip(true, 'S17 — pending shadow-mode logger + reconcile cron (§F7)');

    // TODO: seed shadow_log with 14*N pair entries, 92% matching
    // TODO: run reconcile; assert gate_config.P2a.mode transitions to 'auto'
    // TODO: spawn a new feature; assert its P2a row is agent-decided
    expect(testDb).toBeDefined();
  });
});
