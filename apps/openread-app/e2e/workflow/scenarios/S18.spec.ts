// apps/openread-app/e2e/workflow/scenarios/S18.spec.ts
//
// Probe-driven workflow · E2E scenario (§8.1, J1).
//
// S18 — Auto self-escalates for one gate
//
// Validates the self-escalation path: in full-auto mode, if the agent's
// confidence for a gate verdict is below the configured floor (e.g. ambiguous
// Figma alignment), the agent must escalate THAT gate to a human without
// dropping the whole feature back to hybrid.

import { test, expect } from '../../_helpers/probe.playwright.ts';

test.describe('S18 — Auto self-escalates for one gate', () => {
  test('escalates a single low-confidence gate without changing overall mode', async ({
    testDb,
    testWorktree,
    mockFigma,
  }) => {
    // GIVEN: a T0 feature running in auto mode, all gates nominally agent-scored
    //   - testDb: features.mode = 'auto'
    //   - mockFigma: returns a frame with deliberately ambiguous token usage
    //
    // WHEN: P2b gate runs
    //   - agent's confidence (judge score) falls below the escalation floor
    //   - agent emits a 'self-escalate' decision with rationale
    //   - conductor routes P2b (and only P2b) to human
    //   - human approves
    //
    // THEN:
    //   - gates.P2b.decided_by = 'human', evidence.reason = 'self-escalate'
    //   - gates for all other Pn retain decided_by = 'agent'
    //   - features.mode stays 'auto' (does NOT demote to hybrid)
    //   - bypass_audit has no entry (escalation is not a bypass)

    test.skip(true, 'S18 — pending agent self-escalation path (§E6) and confidence floor config');

    // TODO: assert gates.P2b.decided_by = 'human'
    // TODO: assert gates.P1/P2a/P3/P4/P5/P6.decided_by = 'agent'
    // TODO: assert features.mode = 'auto' post-completion
    expect(testDb).toBeDefined();
    expect(testWorktree).toBeDefined();
    expect(mockFigma).toBeDefined();
  });
});
