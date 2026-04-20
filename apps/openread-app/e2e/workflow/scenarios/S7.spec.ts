// apps/openread-app/e2e/workflow/scenarios/S7.spec.ts
//
// Probe-driven workflow · E2E scenario (§8.1, J1).
//
// S7 — Test-corrector (parameterized: stale + real bug)
//
// Validates the Test-OK inner loop: when a pre-existing test fails during L3,
// the test-corrector agent must distinguish a STALE test (assertion drifted
// from current intended behaviour) from a REAL BUG (implementation is wrong).
// Parameterized so the same harness exercises both verdicts.

import { test, expect } from '../../_helpers/probe.playwright.ts';

type Case = {
  name: string;
  failureKind: 'stale' | 'real-bug';
  expectedResolution: 'test-updated' | 'impl-fixed';
};

const cases: Case[] = [
  {
    name: 'stale assertion · expected label text changed intentionally',
    failureKind: 'stale',
    expectedResolution: 'test-updated',
  },
  {
    name: 'real bug · impl regressed contract',
    failureKind: 'real-bug',
    expectedResolution: 'impl-fixed',
  },
];

test.describe('S7 — Test-corrector (parameterized: stale + real bug)', () => {
  for (const c of cases) {
    test(`classifies and resolves: ${c.name}`, async ({ testDb, testWorktree }) => {
      // GIVEN: an in-flight feature at L3 with one failing test
      //   - testDb: feature row at stage='L3', gate P3 in-progress
      //   - testWorktree: synthetic failing test injected matching `failureKind`
      //
      // WHEN: /tests-before-code dispatches the test-sweep → test-corrector agents
      //   - agent runs the failing test, inspects the diff, invokes LLM-judge
      //   - classification: stale vs real-bug
      //   - stale → rewrites assertion, re-runs, passes
      //   - real-bug → leaves test, fixes impl, re-runs, passes
      //
      // THEN:
      //   - SQLite gates.P3.evidence records the classification verdict
      //   - the resolution matches `expectedResolution`
      //   - no silent assertion weakening ("delete assertion to pass" forbidden)

      test.skip(
        true,
        `S7/${c.failureKind} — pending test-corrector agent (§E8) and LLM-judge (§E7)`,
      );

      // TODO: assert gates.P3.classification === failureKind
      // TODO: assert git log touches only test files for stale, only impl for real-bug
      // TODO: assert no removed `expect(...)` lines in the diff
      expect(c.expectedResolution).toMatch(/test-updated|impl-fixed/);
      expect(testDb).toBeDefined();
      expect(testWorktree).toBeDefined();
    });
  }
});
