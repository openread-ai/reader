// apps/openread-app/e2e/workflow/integration/migration.spec.ts
//
// Probe-driven workflow · baselines-to-bucket migration (§8.2, J2).
//
// Covers: [axis 28] migration-idempotency · [axis 29] baseline-migration ·
//         [axis 30] manifest-rewrite
//
// Validates the one-shot `/migrate-baselines-to-bucket` skill. Existing
// Playwright baseline PNGs living under
//   apps/openread-app/e2e/**/__snapshots__/**.png
// are copied into the CAS bucket, a baselines.manifest.json is written,
// and a second invocation is a no-op (idempotent).
//
// Reference: docs/probe-driven-workflow-implementation.md §7.7
//            (migrate-baselines-to-bucket).

import { test, expect } from '../../_helpers/probe.playwright.ts';

test.describe('migration · baselines-to-bucket', () => {
  test('[axis 28] one-shot run · new baselines copied + manifest written', async ({ testDb }) => {
    // GIVEN: 5 fixture PNGs under a simulated __snapshots__ directory.
    //        No prior baselines.manifest.json.
    // WHEN:  /migrate-baselines-to-bucket runs once.
    // THEN:  5 objects appear in bucket, manifest committed, artifact_objects
    //        rows have refcount = 1.

    test.skip(true, 'migration · first run — pending migrate-baselines skill + bucket/put');

    // TODO: seed 5 PNGs in fixture __snapshots__
    // TODO: run skill entry point
    // TODO: assert 5 rows in artifact_objects
    // TODO: assert baselines.manifest.json exists with 5 entries
    expect(testDb.path).toBeTruthy();
  });

  test('[axis 29] second invocation is a no-op (idempotent)', async ({ testDb }) => {
    // GIVEN: migration already ran once (state from prior run).
    // WHEN:  /migrate-baselines-to-bucket runs again.
    // THEN:  zero new artifact_objects rows, zero manifest changes,
    //        exit code 0 with message "nothing to do".

    test.skip(true, 'migration · idempotency — pending skill idempotency guard');

    // TODO: invoke twice; snapshot bucket state between
    // TODO: assert no new rows, no manifest churn, exit 0
    expect(testDb).toBeDefined();
  });
});
