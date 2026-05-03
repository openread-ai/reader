import { test, expect } from '../fixtures/auth';

/**
 * ENH2 — Internal step policy probe placeholder.
 *
 * This probe is intentionally deferred. The runtime may adapt internal agent
 * step policy server-side, but that policy must not be exposed through client
 * NDJSON events or browser console output.
 */

test.skip('ENH2 — internal step policy remains server-side', async () => {
  expect(true).toBe(true);
});
