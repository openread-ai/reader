import { test, expect } from '../fixtures/auth';
import { navigateToBookReader } from '../helpers/navigate-to-reader';

/**
 * Enhancement #9 — Recovery & re-planning probe (mock).
 *
 * Simulates step exhaustion where the agent ran out of steps but has
 * partial results. The server should re-plan and grant bonus steps.
 */

const BOOK_HASH = '65c789be32848655bc89109cb69cc712';

const REPLANNING_NDJSON = [
  JSON.stringify({ type: 'tool-call', toolName: 'search_content' }),
  JSON.stringify({ type: 'tool-call', toolName: 'read_chapter' }),
  JSON.stringify({ type: 'tool-call', toolName: 'search_content' }),
  JSON.stringify({ type: 'tool-call', toolName: 'read_chapter' }),
  JSON.stringify({ type: 'tool-call', toolName: 're-planning' }),
  JSON.stringify({ type: 'tool-call', toolName: 'read_chapter' }),
  JSON.stringify({
    type: 'text',
    text:
      'After reviewing multiple chapters, the book presents a comprehensive ' +
      'marketing framework. The key themes are: 1) Finding your niche, ' +
      '2) Pricing based on value, and 3) Building customer relationships.',
  }),
].join('\n');

test('ENH9 — Recovery: re-planning produces comprehensive answer after step exhaustion', async ({
  authenticatedPage: page,
}) => {
  test.setTimeout(120_000);

  await page.route('**/api/ai/agentic-chat', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/x-ndjson',
      body: REPLANNING_NDJSON + '\n',
    });
  });

  const inlineInput = await navigateToBookReader(page, BOOK_HASH);
  await inlineInput.click();
  await inlineInput.fill('Compare the main themes across all chapters of this book');
  await inlineInput.press('Enter');

  const messageArea = page
    .locator('[data-message-role="assistant"], .aui-assistant-message')
    .first();
  await expect(messageArea).toBeVisible({ timeout: 30_000 });

  const responseText = await messageArea.textContent();
  expect(responseText).toBeTruthy();
  expect(responseText!.length).toBeGreaterThan(100);
  expect(responseText!.toLowerCase()).toContain('theme');
});
