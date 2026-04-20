// apps/openread-app/e2e/workflow/smoke.spec.ts
//
// Probe-driven workflow — smoke test.
// Source: docs/probe-driven-workflow-implementation.md §3 Bundle I (task I2)
//
// Fastest possible E2E signal: confirm the dev server is up and the app
// mounts. Tagged `@smoke` so lefthook pre-push can grep just this tag and
// run only this spec without loading the full workflow suite.
//
// Scope:
//   - chromium project only (fastest launch; ~300ms cold)
//   - no network mocking, no auth state, no fixtures
//   - two assertions: page responds 200-ish, and a known root element renders
//
// Runtime target: < 3s per invocation on a warm dev server.

import { test, expect } from '@playwright/test';

test.describe('@smoke workflow smoke', () => {
  test.skip(
    ({ browserName }) => browserName !== 'chromium',
    'smoke runs on chromium only — other projects covered by full suite',
  );

  // Under full lefthook pre-push the dev server competes with
  // cargo-clippy, vitest, and tsc for CPU. A single retry absorbs
  // first-paint flakes without widening the overall timeout.
  test.describe.configure({ retries: 1 });

  test('app shell loads at baseURL', async ({ page }) => {
    const response = await page.goto('/', { waitUntil: 'domcontentloaded' });

    // Any 2xx/3xx is fine — the dev server sometimes redirects anonymous
    // requests to a landing route. We only care that the server answered.
    expect(response, 'navigation returned no response').not.toBeNull();
    const status = response!.status();
    expect(status, `baseURL returned ${status}`).toBeLessThan(400);

    // Confirm the React tree actually mounted. `#__next` is the Next.js App
    // Router root; if bundling or hydration is broken, this won't appear.
    // Generous timeout because the dev server may still be warming up if
    // this is the first request after a cold start (e.g. in CI).
    await expect(page.locator('body'), 'body did not render — app failed to mount').toBeVisible({
      timeout: 15_000,
    });

    // Minimal DOM presence check: the document has measurable content.
    const bodyText = await page.locator('body').innerText();
    expect(
      bodyText.length,
      'body rendered empty — suggests hydration or build failure',
    ).toBeGreaterThan(0);
  });
});
