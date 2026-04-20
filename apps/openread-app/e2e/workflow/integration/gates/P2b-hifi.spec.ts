// apps/openread-app/e2e/workflow/integration/gates/P2b-hifi.spec.ts
//
// Probe-driven workflow · P2b HiFi gate integration test (§8.2, J2).
//
// Covers: [axis 7] figma-mcp · [axis 8] token-compliance · [axis 9] platform-conventions
//
// Validates the P2b pause gate (HiFi pixel-accurate design). The gate runs
// two checks in AND: (a) 0 hardcoded hex values in the emitted code, and
// (b) LLM-judge on platform-convention alignment ≥ 0.80. A hardcoded hex
// colour fails check (a) regardless of judge score → rejection (not escalation).
//
// Reference: docs/probe-driven-workflow-implementation.md §8.5 (P2b row),
//            §7.2, `pause-gate-p2b-figma.md`, `figma-mcp-drafter.md`.

import { test, expect } from '../../../_helpers/probe.playwright.ts';

test.describe('P2b · HiFi gate', () => {
  test('[axis 7] happy path · tokens only + judge ≥ 0.80 → passes', async ({
    testDb,
    mockFigma,
  }) => {
    // GIVEN: Figma MCP returns code using only daisyUI/token classnames
    //        (`bg-primary`, `text-base-content`) — zero hex literals.
    //        Tokens Studio variables present; Code Connect mapping resolves.
    // WHEN:  pause-gate-p2b-figma runs both sub-checks.
    // THEN:  gates.P2b = 'passed', scorecards.P2b.hexCount = 0,
    //        scorecards.P2b.judge >= 0.80.

    test.skip(
      true,
      'P2b-hifi happy path — pending pause-gate-p2b-figma agent (E6) + figma-mcp-drafter (G1)',
    );

    // TODO: mockFigma.stub returns token-only code for (fileKey, nodeId)
    // TODO: assert scorecards.P2b.hexCount = 0
    // TODO: assert gates.P2b.status = 'passed'
    expect(mockFigma.callCount()).toBe(0); // pre-gate: untouched
    expect(testDb.path).toBeTruthy();
  });

  test('[axis 8] hardcoded #F5F5F5 in emitted code → rejection', async ({ testDb, mockFigma }) => {
    // GIVEN: MCP response contains `className="bg-[#F5F5F5]"` despite tokens
    //        being available.
    // WHEN:  gate runs.
    // THEN:  token-compliance detects 1 hex → gates.P2b.status = 'rejected'
    //        (NOT 'escalated' — rejection is immediate, see §8.5 P2b row
    //        "reject with specific reason").

    test.skip(true, 'P2b-hifi hex rejection — pending token-compliance probe (§3.B HiFi)');

    // TODO: mockFigma.stub returns code containing 'bg-[#F5F5F5]'
    // TODO: assert gates.P2b.status = 'rejected'
    // TODO: assert scorecards.P2b.hexCount >= 1
    // TODO: assert rejection reason includes the offending hex token
    expect(testDb).toBeDefined();
    expect(mockFigma).toBeDefined();
  });
});
