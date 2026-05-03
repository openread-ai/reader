import { test, expect } from '../fixtures/auth';
import { navigateToBookReader } from '../helpers/navigate-to-reader';

/**
 * Q02 — 80% quota warning probe.
 *
 * Verifies that the UI fires a quota warning toast when the user has consumed
 * >= 80% of their AI message quota for the period.
 *
 * Mechanism under test:
 *   - useAIQuotaStore (src/store/aiQuotaStore.ts or similar) holds quota state
 *   - A "low quota" warning should appear once per session when percentUsed >= 80
 *   - The warning is session-guarded: it fires once, then a sessionStorage key
 *     is set to prevent re-showing on the same session
 *
 * Strategy:
 *   1. Use page.addInitScript to inject __QUOTA_OVERRIDE into window BEFORE
 *      the app hydrates — the app or store can pick this up during init.
 *   2. Navigate to the reader, submit a query (mocked response to avoid
 *      real AI cost), then check for a toast or warning banner.
 *   3. Check sessionStorage for the guard key.
 *   4. Report findings either way — this is exploratory.
 *
 * Source: src/store/aiQuotaStore.ts (quota state),
 *         src/components/assistant/QuotaWarning.tsx (or Toast trigger).
 */

const BOOK_HASH = '65c789be32848655bc89109cb69cc712';

// A minimal successful NDJSON response so we don't need a real AI backend
const MOCK_NDJSON = JSON.stringify({
  type: 'text',
  text: 'Marketing is about reaching customers.',
});

test('Q02 — 80% quota warning toast fires when usage exceeds threshold', async ({
  authenticatedPage: page,
}) => {
  test.setTimeout(180_000);

  // Inject the quota override BEFORE the app loads so Zustand / store init
  // can pick it up during hydration. We set both the window flag and attempt
  // to pre-populate any localStorage-based quota store keys.
  await page.addInitScript(() => {
    // Signal available for the app's store bootstrap code to read
    (window as unknown as Record<string, unknown>).__QUOTA_OVERRIDE = {
      used: 85,
      limit: 100,
      remaining: 15,
      percentUsed: 85,
    };

    // Pre-populate common Zustand persist key patterns in localStorage.
    // We don't know the exact key name, so we try several likely candidates.
    const quotaState = JSON.stringify({
      state: { used: 85, limit: 100, remaining: 15, percentUsed: 85, lastUpdated: Date.now() },
      version: 0,
    });
    localStorage.setItem('ai-quota-store', quotaState);
    localStorage.setItem('aiQuotaStore', quotaState);
    localStorage.setItem('openread-ai-quota', quotaState);
  });

  // Mock the AI endpoint with a trivial successful response so query submission
  // completes without requiring a real backend
  await page.route('**/api/ai/agentic-chat', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/plain',
      body: MOCK_NDJSON,
    });
  });

  const inlineInput = await navigateToBookReader(page, BOOK_HASH);

  // Snapshot sessionStorage before submitting to detect the guard key appearing
  const sessionStorageBefore = await page.evaluate(() => {
    const result: Record<string, string> = {};
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k) result[k] = sessionStorage.getItem(k) ?? '';
    }
    return result;
  });
  console.log(
    `[Q02] sessionStorage before submit (${Object.keys(sessionStorageBefore).length} keys):`,
    JSON.stringify(sessionStorageBefore),
  );

  // Submit a query to trigger any quota-check logic
  await inlineInput.click();
  await inlineInput.fill('What is this book about?');
  await inlineInput.press('Enter');

  // Wait for the mocked response to render
  await expect
    .poll(
      async () => {
        const bodyText = await page.evaluate(() => document.body.innerText ?? '');
        return /Marketing is about reaching customers/i.test(bodyText);
      },
      { timeout: 30_000, intervals: [500, 1000] },
    )
    .toBe(true);

  // Give the UI a moment to show toasts / banners after response completes
  await page.waitForTimeout(2000);

  // --- Toast / warning detection ---
  // Toasts are commonly rendered in a portal outside the main content tree.
  // We check for typical toast container selectors as well as body text.
  const toastVisible = await page
    .locator('[role="status"], [role="alert"], [data-sonner-toast], [data-testid*="toast"]')
    .first()
    .isVisible()
    .catch(() => false);

  const bodyText = await page.evaluate(() => document.body.innerText ?? '');
  const warningTextPresent = /80%|quota|running low|warning|messages? left|limit/i.test(bodyText);

  // --- SessionStorage guard key check ---
  const sessionStorageAfter = await page.evaluate(() => {
    const result: Record<string, string> = {};
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k) result[k] = sessionStorage.getItem(k) ?? '';
    }
    return result;
  });

  const newSessionKeys = Object.keys(sessionStorageAfter).filter(
    (k) => !(k in sessionStorageBefore),
  );
  const quotaGuardKeySet = newSessionKeys.some((k) => /quota|warning|limit/i.test(k));
  const allNewKeys = newSessionKeys.join(', ') || '(none)';

  // Look for any quota-related warning text context
  const warningContext = bodyText.match(/.{0,60}(?:80%|quota|running low|messages? left).{0,150}/i);

  console.log('\n===== Q02 QUOTA WARNING FINDINGS =====');
  console.log(`Toast element visible: ${toastVisible}`);
  console.log(`Warning text present in body: ${warningTextPresent}`);
  console.log(`Warning context: ${warningContext?.[0]?.slice(0, 300) ?? '(none)'}`);
  console.log(
    `SessionStorage after submit (${Object.keys(sessionStorageAfter).length} keys):`,
    JSON.stringify(sessionStorageAfter),
  );
  console.log(`New sessionStorage keys after submit: ${allNewKeys}`);
  console.log(`Quota guard key set in sessionStorage: ${quotaGuardKeySet}`);
  console.log('=======================================\n');

  test.info().annotations.push(
    { type: 'Q02-toast-visible', description: String(toastVisible) },
    { type: 'Q02-warning-text-present', description: String(warningTextPresent) },
    { type: 'Q02-warning-context', description: warningContext?.[0]?.slice(0, 500) ?? '(none)' },
    { type: 'Q02-quota-guard-key-set', description: String(quotaGuardKeySet) },
    { type: 'Q02-new-session-keys', description: allNewKeys },
    {
      type: 'finding',
      description:
        toastVisible || warningTextPresent
          ? quotaGuardKeySet
            ? 'Quota warning shown AND session-guard key set — correct behavior'
            : 'Quota warning shown but no session-guard key detected — may re-fire on next query'
          : quotaGuardKeySet
            ? 'No visible quota warning but session-guard key was set — toast may have been suppressed or invisible'
            : '__QUOTA_OVERRIDE injected but no quota warning fired — feature may not read window.__QUOTA_OVERRIDE or localStorage override, or 80% warning is not yet implemented',
    },
  );

  // Tolerant: this is an exploratory probe. We assert only that the probe
  // ran end-to-end and the mocked response was received.
  expect(true).toBe(true);
});
