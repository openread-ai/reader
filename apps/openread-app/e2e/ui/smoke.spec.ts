// apps/openread-app/e2e/ui/smoke.spec.ts
//
// Probe-driven workflow — ui-regression lane minimum-viable spec.
// Source: docs/probe-driven-workflow-implementation.md §9 (visual-regression C4)
//
// The `ui-regression` Playwright project is dedicated to screenshot baselines.
// Until this file existed the project resolved to 0 tests and the L4 pre-push
// gate had nothing to run. This spec gives the lane a single heartbeat case
// that:
//   1. captures a first-run baseline (committed to the artifact bucket, NOT
//      the repo — see playwright.config.ts snapshotDir/snapshotPathTemplate);
//   2. asserts subsequent runs against that baseline with a tiny pixel ratio
//      tolerance to absorb non-deterministic font hinting.
//
// Scope is intentionally small. Broader visual coverage (auth flow, reader,
// library) is a separate bundle — see probe-driven-workflow roadmap.

import { test, expect } from '@playwright/test';

test.describe('@ui-regression @smoke', () => {
  test('homepage renders and matches baseline', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    // Visual baseline captured on first run; subsequent runs assert against it.
    await expect(page).toHaveScreenshot('homepage.png', {
      // Baseline path handled by playwright.config.ts snapshotDir pointing at
      // ~/.openread-dev/artifacts/baselines/ (see playwright.config.ts).
      maxDiffPixelRatio: 0.002,
    });
  });
});
