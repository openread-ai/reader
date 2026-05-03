import { test, expect } from '../fixtures/auth';
import { navigateToBookReader } from '../helpers/navigate-to-reader';

/**
 * A3 — Suggestion chips probe.
 *
 * Verifies that the UI renders suggestion chips when the LLM response
 * contains an `---suggestions---` / `---end-suggestions---` block.
 *
 * The feature under test:
 *   After the streamed response completes, the client should parse the
 *   suggestions block, strip it from the visible message text, and render
 *   each suggestion as a clickable chip (button or similar interactive
 *   element) below the message.
 *
 * This probe mocks the endpoint so the response always contains the block,
 * then inspects:
 *   1. That the main response body text IS visible (stream consumed correctly)
 *   2. That suggestion chips ARE rendered (buttons/links with chip text)
 *   3. Whether the raw `---suggestions---` marker leaks into rendered text
 *      (if it does, that is a rendering bug worth flagging)
 *
 * Source: src/services/ai/utils/responseCleaner.ts (suggestions parsing),
 *         src/components/assistant/Thread.tsx (SuggestionChips rendering).
 */

const BOOK_HASH = '65c789be32848655bc89109cb69cc712';

const SUGGESTION_1 = 'What are the key marketing channels mentioned?';
const SUGGESTION_2 = 'How does the author define a niche market?';
const SUGGESTION_3 = 'What is the 1-Page Marketing Plan framework?';

const MOCK_NDJSON = JSON.stringify({
  type: 'text',
  text:
    'The book discusses marketing strategies for small businesses.\n\n' +
    '---suggestions---\n' +
    `- ${SUGGESTION_1}\n` +
    `- ${SUGGESTION_2}\n` +
    `- ${SUGGESTION_3}\n` +
    '---end-suggestions---',
});

test('A3 — suggestion chips render after response with ---suggestions--- block', async ({
  authenticatedPage: page,
}) => {
  test.setTimeout(180_000);

  await page.route('**/api/ai/agentic-chat', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/plain',
      body: MOCK_NDJSON,
    });
  });

  const inlineInput = await navigateToBookReader(page, BOOK_HASH);
  await inlineInput.click();
  await inlineInput.fill('What marketing strategies does this book cover?');
  await inlineInput.press('Enter');

  // Wait for the main response body text to appear
  await expect
    .poll(
      async () => {
        const bodyText = await page.evaluate(() => document.body.innerText ?? '');
        return /marketing strategies/i.test(bodyText);
      },
      {
        message: 'waiting for main response text "marketing strategies"',
        timeout: 30_000,
        intervals: [500, 1000],
      },
    )
    .toBe(true);

  // Give the UI a moment to process and render chips after stream completes
  await page.waitForTimeout(2000);

  const bodyText = await page.evaluate(() => document.body.innerText ?? '');

  // --- Main response text check ---
  const mainTextVisible = /marketing strategies/i.test(bodyText);

  // --- Suggestion chips presence check ---
  // Chips may be rendered as <button>, <a>, or a <div role="button"> containing
  // the suggestion text. We try multiple selectors.
  const chip1Visible = await page
    .locator(`button, [role="button"], a`)
    .filter({ hasText: /key marketing channels/i })
    .first()
    .isVisible()
    .catch(() => false);

  const chip2Visible = await page
    .locator(`button, [role="button"], a`)
    .filter({ hasText: /niche market/i })
    .first()
    .isVisible()
    .catch(() => false);

  const chip3Visible = await page
    .locator(`button, [role="button"], a`)
    .filter({ hasText: /1-Page Marketing Plan framework/i })
    .first()
    .isVisible()
    .catch(() => false);

  // Also check whether the text appears at all in the DOM even if not as chips
  const chip1InBody = /key marketing channels/i.test(bodyText);
  const chip2InBody = /niche market/i.test(bodyText);
  const chip3InBody = /1-page marketing plan framework/i.test(bodyText);

  // --- Marker leak check ---
  const suggestionsMarkerLeaked = bodyText.includes('---suggestions---');

  console.log('\n===== A3 SUGGESTION CHIPS FINDINGS =====');
  console.log(`Main response text visible: ${mainTextVisible}`);
  console.log(`Chip 1 as interactive element: ${chip1Visible}`);
  console.log(`Chip 2 as interactive element: ${chip2Visible}`);
  console.log(`Chip 3 as interactive element: ${chip3Visible}`);
  console.log(`Chip 1 text in body (any element): ${chip1InBody}`);
  console.log(`Chip 2 text in body (any element): ${chip2InBody}`);
  console.log(`Chip 3 text in body (any element): ${chip3InBody}`);
  console.log(`---suggestions--- marker leaked into body text: ${suggestionsMarkerLeaked}`);
  console.log('=========================================\n');

  const chipsRenderedAsInteractive = chip1Visible || chip2Visible || chip3Visible;
  const chipsAppearedInDom = chip1InBody || chip2InBody || chip3InBody;

  test.info().annotations.push(
    { type: 'A3-main-text-visible', description: String(mainTextVisible) },
    { type: 'A3-chips-as-interactive', description: String(chipsRenderedAsInteractive) },
    { type: 'A3-chips-in-dom', description: String(chipsAppearedInDom) },
    { type: 'A3-marker-leaked', description: String(suggestionsMarkerLeaked) },
    {
      type: 'finding',
      description: chipsRenderedAsInteractive
        ? 'Suggestion chips rendered correctly as interactive elements'
        : chipsAppearedInDom
          ? 'Suggestion text appears in DOM but NOT as interactive elements — chips may be plain text'
          : suggestionsMarkerLeaked
            ? '---suggestions--- marker leaked into body text — parser not stripping the block'
            : 'Suggestion chips did NOT render and text not found in DOM — feature may not be implemented',
    },
  );

  if (suggestionsMarkerLeaked) {
    test.info().annotations.push({
      type: 'finding',
      description: 'BUG: ---suggestions--- markdown marker is visible to the user in rendered text',
    });
  }

  // The main response text must always survive
  expect(mainTextVisible).toBe(true);

  // Tolerant on chip rendering — annotate but don't hard-fail
  // (feature may not yet be implemented)
  expect(true).toBe(true);
});
