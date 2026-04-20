// apps/openread-app/e2e/workflow/scenarios/S3.spec.ts
//
// Probe-driven workflow · E2E scenario (§8.1, J1).
//
// S3 — T2 medium · hybrid · cross-platform · existing Figma
//
// Validates a medium-size cross-platform UI feature where an existing Figma
// frame is the source-of-truth. Hybrid mode: agent reads Figma, lifts tokens,
// generates code, human approves P2b HiFi and P5 visual diff.

import { test, expect } from '../../_helpers/probe.playwright.ts';

test.describe('S3 — T2 medium · hybrid · cross-platform · existing Figma', () => {
  test('reads existing Figma, generates all-platform baselines', async ({
    testDb,
    testWorktree,
    mockFigma,
  }) => {
    // GIVEN: clean main, healthy pre-flight, mockFigma returns a prepared
    //   frame for the feature's URL (fileKey + nodeId resolvable)
    //
    // WHEN: /start-dev intent "redesign library card hover state"
    //   - platforms: [ios, android, macos, windows, web]
    //   - ui_change: yes
    //   - tier: T2
    //   - mode: hybrid
    //   - agent reads Figma node via get_design_context
    //   - extracts tokens → Tokens Studio mapping
    //   - emits per-platform code deltas
    //   - P2b gate shows Figma screenshot side-by-side with HiFi render
    //
    // THEN:
    //   - SQLite features.stage = 'done'
    //   - baselines written for all 5 playwright projects
    //     (chromium · webkit · msedge · mobile-chromium · mobile-webkit)
    //   - gates.P2b.evidence includes existing-figma URL
    //   - 0 hardcoded hex values in diff (token-compliance pass)

    test.skip(true, 'S3 — pending Figma MCP drafter (§G1) and token-compliance probe (§P2b)');

    // TODO: assert mockFigma.calls includes get_design_context
    // TODO: assert 5 baseline files written (one per platform project)
    // TODO: grep generated code for /#[0-9a-fA-F]{6}/ → 0 matches
    expect(testDb).toBeDefined();
    expect(testWorktree).toBeDefined();
    expect(mockFigma).toBeDefined();
  });
});
