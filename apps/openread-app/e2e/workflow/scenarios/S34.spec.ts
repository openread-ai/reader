// apps/openread-app/e2e/workflow/scenarios/S34.spec.ts
//
// Probe-driven workflow · E2E scenario (§8.1, J1).
//
// S34 — Bucket 1 keyboard probe (pipeline proof · real iOS bug)
//
// The first real feature pushed through the pipeline after bootstrap: the
// iOS keyboard-bounce regression previously reproduced on iPhone TRP. The
// scenario proves that the pipeline can detect a real, known-reproducible
// iOS bug — not just pass on synthetic inputs.

import { test, expect } from '../../_helpers/probe.playwright.ts';
import { simulateKeyboard } from '../../_helpers/probe.playwright.ts';

test.describe('S34 — Bucket 1 keyboard probe (pipeline proof · real iOS bug)', () => {
  test('detects iOS keyboard-bounce regression end-to-end', async ({
    page,
    testDb,
    testWorktree,
    makeBook,
  }) => {
    // GIVEN: the iOS keyboard-bounce bug is present on mobile-webkit project
    //   - testWorktree: checkout pinned at the bug-present commit
    //   - makeBook: preloads a book so the reader is reachable
    //   - page: launched under mobile-webkit (iPhone 15 Pro profile)
    //
    // WHEN: /start-dev intent "fix iOS keyboard bounce on reader search"
    //   - platforms: [ios]
    //   - ui_change: yes (visible behaviour change)
    //   - tier: T1
    //   - mode: hybrid
    //   - test-first: a failing e2e that simulates tapping the search field
    //     and checks the header position does not bounce
    //   - agent implements the fix (pin scroll position on focus)
    //   - P5 baseline captured post-fix on mobile-webkit
    //
    // THEN:
    //   - the failing test from L3 now passes after the impl commit
    //   - P5 baseline for 'reader-search-keyboard-open' exists in bucket
    //   - SQLite features.stage = 'done' for this feature
    //   - a non-trivial diff (not a no-op) landed in the reader component

    // A fragment of the future live probe, so imports and helpers stay used:
    if (process.env.S34_SMOKE === '1') {
      await page.goto('/reader/demo');
      await simulateKeyboard(page, 'Meta+F');
      await expect(page.locator('[data-testid="reader-header"]')).toBeVisible();
    }

    test.skip(
      true,
      'S34 — pending bootstrap (S33), mobile-webkit profile wiring, and real fix commit',
    );

    // TODO: seed bug-present commit in testWorktree
    // TODO: assert L3 test flipped red→green across a single impl commit
    // TODO: assert P5 baseline for this feature exists in bucket
    expect(testDb).toBeDefined();
    expect(testWorktree).toBeDefined();
    expect(makeBook).toBeDefined();
  });
});
