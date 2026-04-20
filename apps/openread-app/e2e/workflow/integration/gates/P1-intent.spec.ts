// apps/openread-app/e2e/workflow/integration/gates/P1-intent.spec.ts
//
// Probe-driven workflow · P1 intent gate integration test (§8.2, J2).
//
// Covers: [axis 1] intent-capture · [axis 2] pause-point-semantics ·
//         [axis 5] escalation-policy
//
// Validates the P1 pause gate (intent completeness). The gate checks that
// the 4 required fields (what · why · platforms · success-criteria) are
// populated before the workflow can advance to P2a. Missing fields trigger
// an escalation whose payload lists the specific gaps.
//
// Reference: docs/probe-driven-workflow-implementation.md §8.5 (P1 row),
//            §7.1 (/start-dev), and the `pause-gate-p1-intent.md` agent.

import { test, expect } from '../../../_helpers/probe.playwright.ts';

test.describe('P1 · intent gate', () => {
  test('[axis 1] happy path · all 4 fields present → passes', async ({ testDb }) => {
    // GIVEN: conductor state seeded with a fresh feature row whose
    //        intent contains { what, why, platforms, success_criteria }.
    // WHEN:  P1 pause-gate agent evaluates.
    // THEN:  gate row status = 'passed', advances stage pointer to P2a.

    test.skip(
      true,
      'P1-intent happy path — pending conductor API (E2) + pause-gate-p1-intent agent (E6)',
    );

    // TODO: seed feature { intent: { what, why, platforms, success } } in testDb
    // TODO: invoke pause-gate runner with featureId
    // TODO: assert gates row { gate: 'P1', status: 'passed', decided_by: 'agent' }
    expect(testDb.path).toMatch(/state\.db$/);
  });

  test('[axis 5] ambiguous intent · missing platforms → escalation', async ({ testDb }) => {
    // GIVEN: feature row intent has what+why+success but NO platforms array.
    // WHEN:  P1 evaluates.
    // THEN:  gate row status = 'escalated', payload.missing = ['platforms'],
    //        workflow halts pending human clarification.

    test.skip(true, 'P1-intent escalation — pending pause-gate-p1-intent agent (E6)');

    // TODO: seed feature with intent missing platforms
    // TODO: assert gates.status = 'escalated' AND gates.payload JSON contains
    //       missing=['platforms']
    // TODO: assert stage pointer unchanged (still at P1)
    expect(testDb).toBeDefined();
  });
});
