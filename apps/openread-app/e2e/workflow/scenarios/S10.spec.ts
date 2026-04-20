// apps/openread-app/e2e/workflow/scenarios/S10.spec.ts
//
// Probe-driven workflow · E2E scenario (§8.1, J1).
//
// S10 — L2b Figma timeout → retry → permanent abort
//
// Validates failure handling in the HiFi design stage when the Figma MCP
// endpoint is unreachable. Policy: retry with backoff up to the configured
// limit, then abort permanently (no silent downgrade to auto-score) and
// record the abort so the scorecard surfaces it.

import { test, expect } from '../../_helpers/probe.playwright.ts';

test.describe('S10 — L2b Figma timeout → retry → permanent abort', () => {
  test('retries Figma MCP then aborts permanently on repeated timeout', async ({
    testDb,
    testWorktree,
    mockFigma,
  }) => {
    // GIVEN: feature at L2b awaiting HiFi frame from Figma MCP
    //   - mockFigma: configured to hang indefinitely on all calls
    //   - testDb: feature row at stage='L2b'
    //
    // WHEN: /design-consensus Stage 2 invoked
    //   - first call: times out after configured duration
    //   - retry 1/N: same result
    //   - retry N/N: same result
    //   - conductor emits permanent abort verdict for P2b
    //
    // THEN:
    //   - gates.P2b.verdict = 'aborted-timeout'
    //   - features.stage = 'L2b' (NOT advanced)
    //   - no fallback to auto-score (P2b must stay hostile on timeout)
    //   - abort reason recorded with the retry count

    test.skip(true, 'S10 — pending Figma MCP drafter retry policy (§G1) and P2b abort path (§E6)');

    // TODO: assert mockFigma.calls >= configured retry ceiling
    // TODO: assert gates.P2b.verdict === 'aborted-timeout'
    // TODO: assert features.stage did NOT advance to L3
    expect(testDb).toBeDefined();
    expect(testWorktree).toBeDefined();
    expect(mockFigma).toBeDefined();
  });
});
