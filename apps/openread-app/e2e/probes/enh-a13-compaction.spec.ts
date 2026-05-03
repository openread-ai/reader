import { test, expect } from '../fixtures/auth';
import { navigateToBookReader } from '../helpers/navigate-to-reader';

/**
 * A13 — Conversation compaction probe (mock).
 *
 * Verifies that the client handles compacted conversations correctly.
 * When the server compacts old messages, it sends a summary in place
 * of the original messages. The client should still render normally.
 */

const BOOK_HASH = '65c789be32848655bc89109cb69cc712';

const COMPACTED_NDJSON = [
  JSON.stringify({ type: 'tool-call', toolName: 'search_content' }),
  JSON.stringify({
    type: 'text',
    text:
      'Based on our previous discussion about marketing strategies, ' +
      'the book also covers pricing in Chapter 4.',
  }),
].join('\n');

test('A13 — Compaction: response renders normally after conversation compaction', async ({
  authenticatedPage: page,
}) => {
  test.setTimeout(120_000);

  await page.route('**/api/ai/agentic-chat', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/x-ndjson',
      body: COMPACTED_NDJSON + '\n',
    });
  });

  const inlineInput = await navigateToBookReader(page, BOOK_HASH);
  await inlineInput.click();
  await inlineInput.fill('What else does the book say about pricing?');
  await inlineInput.press('Enter');

  const messageArea = page
    .locator('[data-message-role="assistant"], .aui-assistant-message')
    .first();
  await expect(messageArea).toBeVisible({ timeout: 30_000 });

  const responseText = await messageArea.textContent();
  expect(responseText).toBeTruthy();
  expect(responseText!.toLowerCase()).toContain('pricing');
});
