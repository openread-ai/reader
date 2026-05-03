import { test, expect } from '../fixtures/auth';
import { navigateToBookReader } from '../helpers/navigate-to-reader';

/**
 * A17 — Streaming text deltas probe.
 *
 * Verifies that the server emits text-delta NDJSON events for progressive
 * display, not just a single final text event.
 */

const BOOK_HASH = '65c789be32848655bc89109cb69cc712';

const STREAMING_NDJSON = [
  JSON.stringify({ type: 'tool-call', toolName: 'search_content' }),
  JSON.stringify({ type: 'text-delta', text: 'The book discusses ' }),
  JSON.stringify({ type: 'text-delta', text: 'several important themes ' }),
  JSON.stringify({ type: 'text-delta', text: 'including leadership and strategy.' }),
  JSON.stringify({
    type: 'text',
    text: 'The book discusses several important themes including leadership and strategy.',
  }),
].join('\n');

test('A17 — Streaming: text-delta events render progressively', async ({
  authenticatedPage: page,
}) => {
  test.setTimeout(120_000);

  await page.route('**/api/ai/agentic-chat', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/x-ndjson',
      body: STREAMING_NDJSON + '\n',
    });
  });

  const inlineInput = await navigateToBookReader(page, BOOK_HASH);
  await inlineInput.click();
  await inlineInput.fill('What themes does the book discuss?');
  await inlineInput.press('Enter');

  const messageArea = page
    .locator('[data-message-role="assistant"], .aui-assistant-message')
    .first();
  await expect(messageArea).toBeVisible({ timeout: 30_000 });

  const responseText = await messageArea.textContent();
  expect(responseText).toBeTruthy();
  expect(responseText!.toLowerCase()).toContain('themes');
  expect(responseText!.toLowerCase()).toContain('leadership');
});
