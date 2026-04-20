// apps/openread-app/e2e/workflow/integration/gates/P2a-ascii.spec.ts
//
// Probe-driven workflow · P2a ASCII gate integration test (§8.2, J2).
//
// Covers: [axis 3] ascii-drafter · [axis 4] llm-judge-rubric ·
//         [axis 6] edge-case-coverage
//
// Validates the P2a pause gate (ASCII wireframe quality). The gate runs the
// LLM-judge rubric on three dimensions (layout-clarity · flow-completeness ·
// edge-case-coverage) and gates advancement at threshold 0.80. Missing edge
// cases drop the edge-case-coverage score and force escalation even when
// the other two sub-scores are high.
//
// Reference: docs/probe-driven-workflow-implementation.md §8.5 (P2a row),
//            §7.2 (/design-consensus), `ascii-drafter.md` agent.

import { test, expect } from '../../../_helpers/probe.playwright.ts';

test.describe('P2a · ASCII gate', () => {
  test('[axis 3] happy path · score ≥ 0.80 across all sub-rubrics', async ({ testDb }) => {
    // GIVEN: ASCII wireframe artifact committed under
    //        docs/design/<feat>/wireframe.ascii with layout + edge cases.
    // WHEN:  pause-gate-p2a-ascii runs LLM-judge with rubric.
    // THEN:  scorecard entry { p2a: 0.85 (say) }, gates.P2a = 'passed'.

    test.skip(
      true,
      'P2a-ascii happy path — pending pause-gate-p2a-ascii agent (E6) + ascii-drafter (G5)',
    );

    // TODO: seed artifact with well-formed ASCII wireframe
    // TODO: assert scorecards.P2a.score >= 0.80
    // TODO: assert gates.P2a.status = 'passed'
    expect(testDb.path).toMatch(/state\.db$/);
  });

  test('[axis 6] missing edge cases · score < 0.80 → escalation', async ({ testDb }) => {
    // GIVEN: wireframe that covers happy path only — no empty state, error,
    //        loading, or long-content variants.
    // WHEN:  judge evaluates.
    // THEN:  edge-case-coverage sub-score < 0.80 drags composite below the
    //        p2aLLMJudge threshold; gates.P2a.status = 'escalated'.

    test.skip(true, 'P2a-ascii escalation — pending LLM-judge contract + failure-modes-agent (G6)');

    // TODO: seed wireframe missing edge states
    // TODO: assert scorecards.P2a.score < 0.80
    // TODO: assert gates.P2a.status = 'escalated' with reason including
    //       'edge-case-coverage'
    expect(testDb).toBeDefined();
  });
});
