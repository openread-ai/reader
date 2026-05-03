import { test, expect } from '../fixtures/auth';
import { navigateToBookReader } from '../helpers/navigate-to-reader';

/**
 * Enhancement #8 — Tool execution context probe (mock).
 *
 * Verifies that the agent can efficiently chain tools without redundant reads.
 */

const BOOK_HASH = '65c789be32848655bc89109cb69cc712';

const CHAINED_TOOLS_NDJSON = [
  JSON.stringify({ type: 'tool-call', toolName: 'search_content' }),
  JSON.stringify({ type: 'tool-call', toolName: 'read_chapter' }),
  JSON.stringify({
    type: 'text',
    text:
      'The pricing strategy chapter explains that value-based pricing is more ' +
      'effective than cost-plus pricing. The author recommends starting with ' +
      "the customer's perceived value rather than your costs.",
  }),
].join('\n');

test('ENH8 — Tool context: efficient chaining with only 2 tool calls', async ({
  authenticatedPage: page,
}) => {
  test.setTimeout(120_000);

  await page.route('**/api/ai/agentic-chat', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/x-ndjson',
      body: CHAINED_TOOLS_NDJSON + '\n',
    });
  });

  const inlineInput = await navigateToBookReader(page, BOOK_HASH);
  await inlineInput.click();
  await inlineInput.fill('What does the book say about pricing strategy?');
  await inlineInput.press('Enter');

  const messageArea = page
    .locator('[data-message-role="assistant"], .aui-assistant-message')
    .first();
  await expect(messageArea).toBeVisible({ timeout: 30_000 });

  const responseText = await messageArea.textContent();
  expect(responseText).toBeTruthy();
  expect(responseText!.toLowerCase()).toContain('pricing');
  expect(responseText!.length).toBeGreaterThan(50);
});
