import { test, expect } from '../fixtures/auth';
import { navigateToBookReader } from '../helpers/navigate-to-reader';

/**
 * C1 — Safe observability probe.
 *
 * Verifies the client can render streamed responses without receiving internal
 * server telemetry through NDJSON debug events or browser console output.
 */

const BOOK_HASH = '65c789be32848655bc89109cb69cc712';

const OBSERVABLE_NDJSON = [
  JSON.stringify({
    type: 'tool-call',
    toolName: 'search_content',
  }),
  JSON.stringify({
    type: 'text',
    text: 'The answer is in chapter 3.',
  }),
].join('\n');

test('C1 — Observability: client stream excludes internal debug telemetry', async ({
  authenticatedPage: page,
}) => {
  test.setTimeout(120_000);

  let debugSeen = false;

  page.on('console', (msg) => {
    const text = msg.text();
    if (text.includes('[AI] Server Debug')) {
      debugSeen = true;
    }
  });

  await page.route('**/api/ai/agentic-chat', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/x-ndjson',
      headers: {
        'x-openread-ai-request-id': 'req-abc-123',
        'x-openread-ai-chat-model': 'test',
        'x-openread-ai-chat-provider': 'test',
        'x-openread-ai-planner-tier': 'search',
      },
      body: OBSERVABLE_NDJSON + '\n',
    });
  });

  const inlineInput = await navigateToBookReader(page, BOOK_HASH);
  await inlineInput.click();
  await inlineInput.fill('What is in chapter 3?');
  await inlineInput.press('Enter');

  const messageArea = page
    .locator('[data-message-role="assistant"], .aui-assistant-message')
    .first();
  await expect(messageArea).toBeVisible({ timeout: 30_000 });

  const responseText = await messageArea.textContent();
  expect(responseText).toBeTruthy();
  expect(responseText!.toLowerCase()).toContain('chapter 3');
  expect(debugSeen).toBe(false);
});
