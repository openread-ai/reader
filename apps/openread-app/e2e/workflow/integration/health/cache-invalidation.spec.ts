// apps/openread-app/e2e/workflow/integration/health/cache-invalidation.spec.ts
//
// Probe-driven workflow · health cache invalidation (§8.2, J2).
//
// Covers: [axis 28] cache-invalidation · [axis 29] cache-key-composition ·
//         [axis 30] ttl-policy
//
// Validates that the phase-1 health cache is keyed by
//   { gitHead, pnpmLockHash, skillsHash, schemaVersion }
// and that a change to git HEAD invalidates the cached row and forces a
// full phase-1 re-run.
//
// Reference: docs/probe-driven-workflow-implementation.md §7.4,
//            scripts/health/cache.ts + phase1-universal.ts.

import { test, expect } from '../../../_helpers/probe.playwright.ts';

test.describe('health · cache-invalidation', () => {
  test('[axis 28] git HEAD change → cache miss → re-run', async ({
    testDb,
    testWorktree,
  }) => {
    // GIVEN: health run #1 caches phase-1 verdict under keyA (gitHead=SHA_A).
    // WHEN:  commit something in testWorktree (HEAD moves to SHA_B),
    //        re-run health.
    // THEN:  readCache returns null for keyA' (new key), full phase-1 runs,
    //        new row inserted under SHA_B.

    test.skip(
      true,
      'cache-invalidation — pending scripts/health/cache.ts completion',
    );

    // TODO: run phase1 → persist under gitHead=SHA_A
    // TODO: commit empty file in testWorktree → SHA_B
    // TODO: re-run phase1
    // TODO: assert distinct cache rows, second run NOT from cache
    expect(testDb.path).toBeTruthy();
    expect(testWorktree.branch).toBeTruthy();
  });
});
