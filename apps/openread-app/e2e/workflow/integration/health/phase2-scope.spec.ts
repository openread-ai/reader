// apps/openread-app/e2e/workflow/integration/health/phase2-scope.spec.ts
//
// Probe-driven workflow · phase-2 conditional checks by platform (§8.2, J2).
//
// Covers: [axis 31] phase2-feature-scope · [axis 32] conditional-checks ·
//         [axis 33] platform-dependencies
//
// Validates that phase-2 health runs only the checks relevant to the
// feature's declared platforms. An iOS-only feature must require an
// iPhone device paired (devicectl / ios-deploy reachable); a web-only
// feature must NOT require it.
//
// Reference: docs/probe-driven-workflow-implementation.md §7.4 (phase-2),
//            scripts/health/phase2-feature.ts.

import { test, expect } from '../../../_helpers/probe.playwright.ts';

test.describe('health · phase2-scope', () => {
  test('[axis 31] iOS feature requires iPhone; absence → RED', async ({ testDb }) => {
    // GIVEN: feature row { platforms: ['ios'] } seeded in testDb.
    //        Test env simulates no paired iPhone (ios-deploy returns []).
    // WHEN:  runPhase2({ featureId }) executes.
    // THEN:  layer H5 integrations = 'red', details include 'no-ios-device'.

    test.skip(true, 'phase2-scope iOS — pending scripts/health/phase2-feature.ts + H5 layer');

    // TODO: seed feature platforms=['ios']
    // TODO: stub ios-deploy to return no devices
    // TODO: call runPhase2
    // TODO: assert H5.status = 'red'
    expect(testDb.path).toBeTruthy();
  });

  test('[axis 32] web-only feature skips iOS device check entirely', async ({ testDb }) => {
    // GIVEN: feature { platforms: ['web'] }.
    // WHEN:  phase-2 runs.
    // THEN:  H5 details DO NOT include any ios-device check; overall GREEN.

    test.skip(true, 'phase2-scope web — pending conditional-check routing in phase2-feature.ts');

    // TODO: seed feature platforms=['web']
    // TODO: call runPhase2
    // TODO: assert no 'ios-device' check appeared in layer.details
    expect(testDb).toBeDefined();
  });
});
