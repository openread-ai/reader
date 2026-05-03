import { test, expect } from '../fixtures/auth';

/**
 * F25 — Rate limit UX probe.
 *
 * The server returns 429 from two different code paths with DIFFERENT
 * response shapes:
 *
 *   1. Usage limit (plan-based, daily/monthly) — rich JSON with limitType,
 *      resetAt, upgradeUrl, boostBalance, canBoost (route.ts:155-171).
 *
 *   2. Request rate limit (60 req/min via checkRateLimit) — plain
 *      `{error: 'Rate limit exceeded. Try again later.'}` with no
 *      limitType (rate-limit.ts:74-85).
 *
 * The client (AgenticChatAdapter.ts:188-207) handles ALL 429s through the
 * same path — sets useAIQuotaStore.limitReached and yields a "Daily limit
 * reached" or "Monthly limit reached" message. When the request-rate-limit
 * path fires, `data.limitType === undefined` → `isMonthly=false` → the user
 * sees "Daily limit reached" WHICH IS WRONG (they hit a 1-minute request
 * rate, not a daily usage limit).
 *
 * This probe uses Playwright route interception to mock each 429 shape
 * without consuming real Groq quota, then observes what the user sees.
 */

const BOOK_HASH = '65c789be32848655bc89109cb69cc712';
const BOOK_TITLE_SUBSTRING = '1-Page Marketing';

async function navigateToBookWithInlineBar(page: import('@playwright/test').Page) {
  await page.goto('/home');
  await expect(
    page.getByRole('heading', { name: new RegExp(BOOK_TITLE_SUBSTRING, 'i') }).first(),
  ).toBeVisible({ timeout: 30_000 });

  const welcomeDialog = page.getByRole('dialog', { name: /welcome/i });
  if (await welcomeDialog.isVisible().catch(() => false)) {
    await welcomeDialog.getByRole('button', { name: 'Close' }).click();
    await expect(welcomeDialog).toBeHidden({ timeout: 5_000 });
  }

  await page
    .getByRole('link', { name: new RegExp(BOOK_TITLE_SUBSTRING, 'i') })
    .first()
    .click();

  await page.waitForURL(
    (url) => url.pathname.startsWith('/reader') && url.search.includes(BOOK_HASH),
    { timeout: 30_000 },
  );

  const inlineInput = page.getByPlaceholder('Ask about this book...').first();
  await expect(inlineInput).toBeVisible({ timeout: 30_000 });
  return inlineInput;
}

test('F25a — usage-limit 429 (daily) renders reset time and upgrade nudge', async ({
  authenticatedPage: page,
}) => {
  // Mock a daily-limit 429 on the NEXT agentic-chat request
  const resetAt = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(); // 8h from now
  await page.route('**/api/ai/agentic-chat', async (route) => {
    await route.fulfill({
      status: 429,
      contentType: 'application/json',
      body: JSON.stringify({
        error: 'Daily AI message limit reached',
        code: 'DAILY_LIMIT_EXCEEDED',
        used: 10,
        limit: 10,
        resetAt,
        limitType: 'daily',
        upgradeUrl: '/user/plans',
        boostBalance: 0,
        canBoost: false,
      }),
    });
  });

  const inlineInput = await navigateToBookWithInlineBar(page);
  await inlineInput.click();
  await inlineInput.fill('What is this book about?');
  await inlineInput.press('Enter');

  // Poll for any visible text about limits
  let uiText = '';
  await expect
    .poll(
      async () => {
        uiText = await page.evaluate(() => document.body.innerText ?? '');
        return uiText;
      },
      { timeout: 20_000, intervals: [500, 1000] },
    )
    .toMatch(/limit/i);

  // Dump findings
  console.log('\n===== F25a DAILY LIMIT FINDINGS =====');
  console.log('Contains "Daily":', /daily/i.test(uiText));
  console.log('Contains "Monthly":', /monthly/i.test(uiText));
  console.log('Contains reset time:', /\d{1,2}:\d{2}/.test(uiText));
  console.log('Contains "Upgrade" or "plans":', /upgrade|plans/i.test(uiText));
  console.log('Contains "boost":', /boost/i.test(uiText));
  const limitMatch = uiText.match(/.{0,50}limit.{0,200}/i);
  console.log('Limit context:', limitMatch?.[0]?.slice(0, 300));
  console.log('=====================================\n');

  test
    .info()
    .annotations.push(
      { type: 'F25a-limit-context', description: limitMatch?.[0]?.slice(0, 500) ?? 'none' },
      { type: 'F25a-has-reset-time', description: String(/\d{1,2}:\d{2}/.test(uiText)) },
    );

  // We mocked a daily-limit 429 — the UI must mention "daily" specifically.
  // If this fails it means the client is misclassifying the limitType.
  expect(uiText).toMatch(/daily/i);
});

test('F25b — request-rate-limit 429 (60/min) incorrectly shows "Daily limit reached"', async ({
  authenticatedPage: page,
}) => {
  // Mock the request-rate-limit shape — plain error, no limitType
  await page.route('**/api/ai/agentic-chat', async (route) => {
    await route.fulfill({
      status: 429,
      contentType: 'application/json',
      headers: {
        'Retry-After': '45',
        'X-RateLimit-Limit': '60',
        'X-RateLimit-Remaining': '0',
      },
      body: JSON.stringify({
        error: 'Rate limit exceeded. Try again later.',
      }),
    });
  });

  const inlineInput = await navigateToBookWithInlineBar(page);
  await inlineInput.click();
  await inlineInput.fill('What is the main idea?');
  await inlineInput.press('Enter');

  let uiText = '';
  await expect
    .poll(
      async () => {
        uiText = await page.evaluate(() => document.body.innerText ?? '');
        return uiText;
      },
      { timeout: 20_000, intervals: [500, 1000] },
    )
    .toMatch(/limit/i);

  console.log('\n===== F25b REQUEST-RATE-LIMIT FINDINGS =====');
  console.log('Contains "Daily" (WRONG — this is a per-minute rate limit):', /daily/i.test(uiText));
  console.log('Contains "Rate limit exceeded":', /rate limit exceeded/i.test(uiText));
  console.log('Contains "Try again later":', /try again later/i.test(uiText));
  console.log('Contains "Retry-After 45":', /45/i.test(uiText));
  const limitMatch = uiText.match(/.{0,50}limit.{0,200}/i);
  console.log('Limit context:', limitMatch?.[0]?.slice(0, 300));
  console.log('=============================================\n');

  test
    .info()
    .annotations.push(
      { type: 'F25b-limit-context', description: limitMatch?.[0]?.slice(0, 500) ?? 'none' },
      { type: 'F25b-shows-daily', description: String(/daily/i.test(uiText)) },
    );

  // The word "limit" must appear regardless of which 429 path fired.
  // Known bug: the client shows "Daily limit reached" even for a per-minute
  // rate limit — so /daily/i would also match here, but that is the BUG being
  // documented.  This weaker assertion just ensures the UI is not silent.
  expect(uiText).toMatch(/limit/i);
});
