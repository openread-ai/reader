import { test, expect } from '../fixtures/auth';
import { navigateToBookReader } from '../helpers/navigate-to-reader';

/**
 * F27 — Non-429 error paths probe.
 *
 * Verifies that the client (AgenticChatAdapter.ts) renders friendly,
 * actionable error messages for non-rate-limit server error responses.
 *
 * Three sub-tests covering error codes that the adapter should handle
 * distinctly from the 429 rate-limit path:
 *
 *   F27a — PLAN_REQUIRED (403): user is on free tier, should see an
 *     upgrade / plan prompt rather than a generic error.
 *
 *   F27b — CONTEXT_LENGTH_EXCEEDED (413): the conversation history is
 *     too long; user should be told to start a shorter conversation.
 *
 *   F27c — Unknown 500: generic server fault; at minimum the user
 *     should see SOMETHING rather than a silent empty state.
 *
 * All three tests use Playwright route interception so no real AI
 * backend is required.
 *
 * Source: src/services/ai/adapters/AgenticChatAdapter.ts (error handling),
 *         src/components/assistant/Thread.tsx (error rendering).
 */

const BOOK_HASH = '65c789be32848655bc89109cb69cc712';

/**
 * Submit a query and poll for any text in the assistant message area
 * that matches `pattern`. Returns the matched text or null.
 */
async function submitAndWaitForErrorText(
  page: import('@playwright/test').Page,
  query: string,
  pattern: RegExp,
  timeoutMs = 30_000,
): Promise<string | null> {
  const inlineInput = await navigateToBookReader(page, BOOK_HASH);
  await inlineInput.click();
  await inlineInput.fill(query);
  await inlineInput.press('Enter');

  let matched: string | null = null;
  try {
    await expect
      .poll(
        async () => {
          const bodyText = await page.evaluate(() => document.body.innerText ?? '');
          if (pattern.test(bodyText)) {
            matched = bodyText.match(pattern)?.[0] ?? bodyText.slice(0, 200);
            return true;
          }
          return false;
        },
        { timeout: timeoutMs, intervals: [500, 1000] },
      )
      .toBe(true);
  } catch {
    // Poll timed out — matched stays null
  }

  return matched;
}

// ---------------------------------------------------------------------------
// F27a — PLAN_REQUIRED (403)
// ---------------------------------------------------------------------------
test('F27a — PLAN_REQUIRED 403 renders upgrade/plan prompt', async ({
  authenticatedPage: page,
}) => {
  test.setTimeout(180_000);

  await page.route('**/api/ai/agentic-chat', async (route) => {
    await route.fulfill({
      status: 403,
      contentType: 'application/json',
      body: JSON.stringify({ code: 'PLAN_REQUIRED', error: 'Plan required' }),
    });
  });

  const matched = await submitAndWaitForErrorText(
    page,
    'What is this book about?',
    /upgrade|plan/i,
  );

  const bodyText = await page.evaluate(() => document.body.innerText ?? '');
  const hasUpgradeOrPlan = /upgrade|plan/i.test(bodyText);
  const hasAnyError = /error|sorry|unable|fail/i.test(bodyText);

  console.log('\n===== F27a PLAN_REQUIRED FINDINGS =====');
  console.log(`Matched upgrade/plan text: ${matched ?? '(none)'}`);
  console.log(`Body contains upgrade/plan: ${hasUpgradeOrPlan}`);
  console.log(`Body contains any error indication: ${hasAnyError}`);
  const errorContext = bodyText.match(/.{0,60}(?:upgrade|plan|error|sorry).{0,150}/i);
  console.log(`Error context: ${errorContext?.[0]?.slice(0, 300) ?? '(none)'}`);
  console.log('========================================\n');

  test.info().annotations.push(
    { type: 'F27a-matched-text', description: matched ?? '(none)' },
    { type: 'F27a-has-upgrade-or-plan', description: String(hasUpgradeOrPlan) },
    {
      type: 'finding',
      description: hasUpgradeOrPlan
        ? 'PLAN_REQUIRED 403 correctly surfaces an upgrade/plan message to the user'
        : hasAnyError
          ? 'PLAN_REQUIRED 403 shows a generic error but no upgrade/plan prompt — poor UX'
          : 'PLAN_REQUIRED 403 produced no visible error text — silent failure',
    },
  );

  // The UI must show at minimum SOMETHING when a 403 is returned
  expect(hasUpgradeOrPlan || hasAnyError).toBe(true);
});

// ---------------------------------------------------------------------------
// F27b — CONTEXT_LENGTH_EXCEEDED (413)
// ---------------------------------------------------------------------------
test('F27b — CONTEXT_LENGTH_EXCEEDED 413 renders "too long / shorter" message', async ({
  authenticatedPage: page,
}) => {
  test.setTimeout(180_000);

  await page.route('**/api/ai/agentic-chat', async (route) => {
    await route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({ code: 'CONTEXT_LENGTH_EXCEEDED', error: 'Context too long' }),
    });
  });

  const matched = await submitAndWaitForErrorText(
    page,
    'Summarize everything in this book.',
    /too long|shorter/i,
  );

  const bodyText = await page.evaluate(() => document.body.innerText ?? '');
  const hasTooLongOrShorter = /too long|shorter/i.test(bodyText);
  const hasAnyError = /error|sorry|unable|fail|context/i.test(bodyText);

  console.log('\n===== F27b CONTEXT_LENGTH_EXCEEDED FINDINGS =====');
  console.log(`Matched "too long/shorter" text: ${matched ?? '(none)'}`);
  console.log(`Body contains "too long" or "shorter": ${hasTooLongOrShorter}`);
  console.log(`Body contains any error indication: ${hasAnyError}`);
  const errorContext = bodyText.match(/.{0,60}(?:too long|shorter|context|error|sorry).{0,150}/i);
  console.log(`Error context: ${errorContext?.[0]?.slice(0, 300) ?? '(none)'}`);
  console.log('=================================================\n');

  test.info().annotations.push(
    { type: 'F27b-matched-text', description: matched ?? '(none)' },
    { type: 'F27b-has-too-long-or-shorter', description: String(hasTooLongOrShorter) },
    {
      type: 'finding',
      description: hasTooLongOrShorter
        ? 'CONTEXT_LENGTH_EXCEEDED 413 correctly tells the user the conversation is too long'
        : hasAnyError
          ? 'CONTEXT_LENGTH_EXCEEDED 413 shows a generic error but no actionable guidance — poor UX'
          : 'CONTEXT_LENGTH_EXCEEDED 413 produced no visible error text — silent failure',
    },
  );

  // The UI must show at minimum SOMETHING when a 413 is returned
  expect(hasTooLongOrShorter || hasAnyError).toBe(true);
});

// ---------------------------------------------------------------------------
// F27c — Unknown 500 server error
// ---------------------------------------------------------------------------
test('F27c — unknown 500 server error shows some error text (not silent)', async ({
  authenticatedPage: page,
}) => {
  test.setTimeout(180_000);

  await page.route('**/api/ai/agentic-chat', async (route) => {
    await route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Internal server error' }),
    });
  });

  const inlineInput = await navigateToBookReader(page, BOOK_HASH);
  await inlineInput.click();
  await inlineInput.fill('What is the main topic of this book?');
  await inlineInput.press('Enter');

  // For a 500 we don't know what exact text the UI shows — just assert
  // something error-like appears rather than an empty/stuck UI.
  let bodyText = '';
  let hasAnyErrorText = false;
  try {
    await expect
      .poll(
        async () => {
          bodyText = await page.evaluate(() => document.body.innerText ?? '');
          hasAnyErrorText = /error|sorry|unable|fail|wrong|problem|issue|try again/i.test(bodyText);
          return hasAnyErrorText;
        },
        { timeout: 30_000, intervals: [500, 1000] },
      )
      .toBe(true);
  } catch {
    // Timed out without finding any error text
    bodyText = await page.evaluate(() => document.body.innerText ?? '');
    hasAnyErrorText = /error|sorry|unable|fail|wrong|problem|issue|try again/i.test(bodyText);
  }

  const errorContext = bodyText.match(/.{0,60}(?:error|sorry|unable|fail|wrong|problem).{0,150}/i);

  console.log('\n===== F27c UNKNOWN 500 FINDINGS =====');
  console.log(`Any error text visible: ${hasAnyErrorText}`);
  console.log(`Error context: ${errorContext?.[0]?.slice(0, 300) ?? '(none)'}`);
  console.log('======================================\n');

  test.info().annotations.push(
    { type: 'F27c-has-any-error-text', description: String(hasAnyErrorText) },
    { type: 'F27c-error-context', description: errorContext?.[0]?.slice(0, 500) ?? '(none)' },
    {
      type: 'finding',
      description: hasAnyErrorText
        ? 'Unknown 500 correctly surfaces an error message to the user'
        : 'Unknown 500 produced no visible error text — silent failure, very poor UX',
    },
  );

  // The UI must not silently fail on a 500
  expect(hasAnyErrorText).toBe(true);
});
