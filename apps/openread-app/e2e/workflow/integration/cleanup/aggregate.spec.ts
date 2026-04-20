// apps/openread-app/e2e/workflow/integration/cleanup/aggregate.spec.ts
//
// Probe-driven workflow · aggregate rollup past the 90-day retention
// boundary (§8.2, J2).
//
// File is named `aggregate.spec.ts` (the reference calls it "91d-aggregate-
// rollup" — name is intentional, not a typo: it tests the behavior ONE DAY
// past the 90-day `gatesDetailDays` boundary defined in Appendix D).
//
// Covers: [axis 37] retention-rollup · [axis 38] aggregate-projection
//
// Validates that gate detail rows older than `gatesDetailDays` (90) are
// compacted into a monthly aggregate row and the per-row detail is dropped.
// A gate row aged exactly 91 days must be rolled up; a gate row at 89 days
// must remain detail-preserved.
//
// Reference: docs/probe-driven-workflow-implementation.md §8.2 comment block,
//            Appendix D (retention.gatesDetailDays = 90).

import { test, expect } from '../../../_helpers/probe.playwright.ts';

const DAY_MS = 24 * 60 * 60 * 1000;

test.describe('cleanup · aggregate (91d past retention boundary)', () => {
  test('[axis 37] 91d-old detail row rolled up into monthly aggregate', async ({
    testDb,
  }) => {
    // GIVEN: testDb seeded with two gate rows:
    //          - rowA inserted 89 days ago
    //          - rowB inserted 91 days ago
    //        retention.gatesDetailDays = 90.
    // WHEN:  /cleanup scheduled runs rollup.
    // THEN:  rowA detail preserved; rowB detail removed but captured in
    //        gates_aggregate (month, feature_id, gate, pass/fail counts).

    test.skip(
      true,
      'aggregate-rollup — pending cleanup/scheduled.ts + gates_aggregate table',
    );

    // TODO: insert rowA with decided_at = Date.now() - 89*DAY_MS
    // TODO: insert rowB with decided_at = Date.now() - 91*DAY_MS
    // TODO: run cleanup scheduled rollup
    // TODO: assert SELECT rowA.id → present
    // TODO: assert SELECT rowB.id → gone
    // TODO: assert gates_aggregate row for rowB's month has counter = 1
    expect(DAY_MS).toBe(86400000);
    expect(testDb.path).toBeTruthy();
  });
});
