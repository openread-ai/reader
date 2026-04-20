// apps/openread-app/e2e/workflow/scenarios/S15.spec.ts
//
// Probe-driven workflow · E2E scenario (§8.1, J1).
//
// S15 — Pure manual mode — all 7 gates human
//
// Validates the strictest mode: every pause gate (P1, P2a, P2b, P3, P4, P5,
// P6) is routed to a human. No LLM-judge decisions are recorded; the agent
// surfaces evidence but never issues a verdict. Used when auditability
// outweighs throughput (e.g. security-sensitive change).

import { test, expect } from '../../_helpers/probe.playwright.ts';

test.describe('S15 — Pure manual mode — all 7 gates human', () => {
  test('routes every gate decision to a human, no agent verdicts', async ({
    testDb,
    testWorktree,
    mockFigma,
  }) => {
    // GIVEN: clean main, user invokes /start-dev with --mode=manual explicitly
    //   - testDb: fresh state
    //   - testWorktree: clean main
    //   - mockFigma: returns a valid frame (UI feature)
    //
    // WHEN: feature progresses through all 7 gates
    //   - at each gate the agent presents evidence and waits for human input
    //   - simulated human approves each gate sequentially
    //   - LLM-judge is NOT invoked anywhere
    //
    // THEN:
    //   - gates rows for P1..P6 all have decided_by='human'
    //   - no rows in agent_verdicts table for this feature
    //   - features.mode = 'manual', features.tier unchanged from intake
    //   - shadow-mode logger records zero agent-human comparisons

    test.skip(true, 'S15 — pending pure-manual router (§E1) and agent-verdict suppression');

    // TODO: assert every gates.decided_by = 'human' for this feature
    // TODO: assert agent_verdicts.count WHERE feature_id=? === 0
    // TODO: assert shadow_log entries for this feature === 0
    expect(testDb).toBeDefined();
    expect(testWorktree).toBeDefined();
    expect(mockFigma).toBeDefined();
  });
});
