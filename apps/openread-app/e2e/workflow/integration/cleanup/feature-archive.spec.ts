// apps/openread-app/e2e/workflow/integration/cleanup/feature-archive.spec.ts
//
// Probe-driven workflow · feature archive on completed_at (§8.2, J2).
//
// Covers: [axis 34] cleanup-feature-archive · [axis 35] bucket-refcount-drop
//
// Validates that when a feature row transitions to stage='done' with a
// completed_at timestamp, `/cleanup --feature` drops every per-feature
// artifact (captures, diffs, temp uploads) AND decrements refcount on
// shared objects (baselines kept). Baselines stay until the baselines.
// manifest.json that references them is removed.
//
// Reference: docs/probe-driven-workflow-implementation.md §7.5 (/cleanup),
//            scripts/cleanup/feature.ts, §5.2 artifacts-index refcount.

import { test, expect } from '../../../_helpers/probe.playwright.ts';

test.describe('cleanup · feature-archive on completed_at', () => {
  test('[axis 34] archive completed feature → drop captures, keep baselines', async ({
    testDb,
  }) => {
    // GIVEN: feature row stage='done', completed_at=now.
    //        Bucket has 3 captures + 2 baselines for this feature.
    // WHEN:  /cleanup --feature=<slug> runs.
    // THEN:  captures removed, diffs removed, baselines preserved
    //        (referenced by committed manifest), refcount on baselines = 1.

    test.skip(
      true,
      'feature-archive — pending cleanup/feature.ts + completed_at transitions',
    );

    // TODO: seed feature stage=done, completed_at=now
    // TODO: seed 3 capture artifacts + 2 baseline artifacts
    // TODO: run /cleanup --feature
    // TODO: assert captures gone, baselines present
    // TODO: assert refcount = 1 on baseline rows
    expect(testDb.path).toBeTruthy();
  });
});
