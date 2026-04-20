// apps/openread-app/e2e/workflow/integration/gates/P5-visual.spec.ts
//
// Probe-driven workflow · P5 visual-regression gate integration test (§8.2, J2).
//
// Covers: [axis 16] visual-regression · [axis 17] pixel-diff-threshold ·
//         [axis 18] region-intent-classifier
//
// Validates the P5 pause gate (visual regression). The gate passes when
// pixel-diff ratio < p5PixelDiffRatio (default 0.002) OR the optional
// region-intent classifier (p5JudgeOverrideEnabled) rules the diff as
// intentional (judge ≥ p5JudgeThreshold).
//
// Reference: docs/probe-driven-workflow-implementation.md §8.5 (P5 row),
//            `pause-gate-p5-visual.md`, `baseline-exporter.md`.

import { test, expect } from '../../../_helpers/probe.playwright.ts';

test.describe('P5 · visual-regression gate', () => {
  test('[axis 16] approved baseline · diff < 0.002 → passes', async ({ testDb }) => {
    // GIVEN: baseline captured + committed via baseline-exporter (G3).
    //        Current render matches within tolerance.
    // WHEN:  P5 gate runs toHaveScreenshot diff.
    // THEN:  gates.P5.status = 'passed', scorecards.P5.pixelDiffRatio < 0.002.

    test.skip(
      true,
      'P5-visual happy path — pending pause-gate-p5-visual (E6) + baseline-exporter (G3)',
    );

    // TODO: seed baseline PNG in bucket + manifest row
    // TODO: render target page + run diff
    // TODO: assert gates.P5.status = 'passed'
    expect(testDb.path).toBeTruthy();
  });

  test('[axis 17] regression detected · diff > threshold → blocks', async ({ testDb }) => {
    // GIVEN: render has unintended shift (e.g. padding changed globally).
    //        Judge override disabled OR judge score < p5JudgeThreshold.
    // WHEN:  gate runs.
    // THEN:  gates.P5.status = 'blocked', user must review diff image.

    test.skip(true, 'P5-visual regression — pending pixel-diff probe + region-intent classifier');

    // TODO: seed baseline that differs from current render by > 0.002 ratio
    // TODO: assert gates.P5.status = 'blocked'
    // TODO: assert diff image written to bucket under diffs/<feat>/
    expect(testDb).toBeDefined();
  });
});
