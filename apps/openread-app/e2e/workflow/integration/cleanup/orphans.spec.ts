// apps/openread-app/e2e/workflow/integration/cleanup/orphans.spec.ts
//
// Probe-driven workflow · orphan detection + removal (§8.2, J2).
//
// Covers: [axis 34] orphan-detection · [axis 35] cleanup-dry-run ·
//         [axis 36] refcount-integrity
//
// Validates that /cleanup detects artifact_objects rows with refcount=0 (or
// files on disk with no index row) and removes them on confirmation. The
// `--dry-run` flag lists targets without deleting.
//
// Reference: docs/probe-driven-workflow-implementation.md §7.5 (/cleanup),
//            scripts/bucket/orphans.ts + scripts/cleanup/*.

import { test, expect } from '../../../_helpers/probe.playwright.ts';

test.describe('cleanup · orphans', () => {
  test('[axis 34] put + drop refcount → orphan detected → removed', async ({
    testDb,
  }) => {
    // GIVEN: an artifact put into the bucket then dereferenced (feature
    //        archived; refcount decremented to 0).
    // WHEN:  /cleanup runs (non-dry-run).
    // THEN:  on-disk file removed, artifact_objects row deleted, reclaim
    //        bytes counter returned.

    test.skip(
      true,
      'cleanup-orphans — pending bucket/orphans.ts + cleanup runner',
    );

    // TODO: put fixture artifact, decrement refcount via conductor API
    // TODO: run cleanup dry-run → assert target listed, nothing deleted
    // TODO: run cleanup (real) → assert file absent, row absent
    // TODO: assert bucket stats returns reclaimed bytes
    expect(testDb.path).toBeTruthy();
  });
});
