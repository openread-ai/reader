import { test, expect } from '../fixtures/auth';

/**
 * B6 simple — single-query tool-selection probe.
 *
 * Rewrote from b6-tool-selection.spec.ts which failed to capture data
 * (polls errored out in ~5s per iteration — likely navigation-related
 * page.evaluate context destruction). This version asks ONE tool-forcing
 * question with no navigation between attempts.
 *
 * Question: "Search the book for every mention of the word 'niche'."
 * Expected tool: search_content (or multi_hop_search)
 *
 * Captures:
 *   - Tool calls from NDJSON response stream
 *   - Final response text
 */

const BOOK_HASH = '65c789be32848655bc89109cb69cc712';
const BOOK_TITLE_SUBSTRING = '1-Page Marketing';

test('B6 — single tool-forcing query captures agent behavior', async ({
  authenticatedPage: page,
}) => {
  const responseBodies: string[] = [];
  const responseBodyReads: Promise<void>[] = [];
  const consoleLines: string[] = [];

  page.on('console', (msg) => {
    consoleLines.push(msg.text());
  });

  page.on('response', (response) => {
    if (response.url().includes('/api/ai/agentic-chat')) {
      const bodyRead = response
        .text()
        .then((body) => {
          responseBodies.push(body);
          console.log(`[B6] Captured response body, length=${body.length}`);
        })
        .catch((e) => {
          console.log(`[B6] Failed to read response body: ${e}`);
        });
      responseBodyReads.push(bodyRead);
    }
  });

  // Navigate
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

  const query = "Search the book for every mention of the word 'niche' and list the passages.";
  await inlineInput.click();
  await inlineInput.fill(query);
  await inlineInput.press('Enter');

  // Poll for ANY substantive response
  let responseText = '';
  try {
    await expect
      .poll(
        async () => {
          try {
            const result = await page.evaluate(() => {
              const candidates = Array.from(
                document.querySelectorAll('p, div[class*="message"], div[class*="Message"]'),
              );
              const responses = candidates
                .map((el) => (el as HTMLElement).innerText?.trim() ?? '')
                .filter(
                  (t) =>
                    t.length > 30 &&
                    !t.includes('AI can make mistakes') &&
                    !t.startsWith('8 messages left') &&
                    !t.startsWith('Ask about this book') &&
                    !t.startsWith('Search the book'),
                );
              return responses.sort((a, b) => b.length - a.length)[0] ?? '';
            });
            responseText = result;
            return result.length;
          } catch (e) {
            console.log(`[B6] page.evaluate error: ${e}`);
            return 0;
          }
        },
        { timeout: 120_000, intervals: [1000, 2000, 3000] },
      )
      .toBeGreaterThan(30);
  } catch (e) {
    console.log(`[B6] Poll gave up: ${e}`);
  }

  await expect
    .poll(() => responseBodies.length, { timeout: 30_000, intervals: [250, 500, 1000] })
    .toBeGreaterThan(0);
  await Promise.allSettled(responseBodyReads);

  // Parse tool calls
  const toolsCalled: string[] = [];
  for (const body of responseBodies) {
    for (const line of body.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const event = JSON.parse(trimmed);
        if (event.type === 'tool-call' && typeof event.toolName === 'string') {
          toolsCalled.push(event.toolName);
        }
      } catch {
        // skip
      }
    }
  }

  // Count console lines containing "[AI]" for additional signal.
  const aiLogLines = consoleLines.filter((l) => l.includes('[AI]'));

  console.log('\n===== B6 SIMPLE FINDINGS =====');
  console.log(`Query: "${query}"`);
  console.log(
    `Tools called (count=${toolsCalled.length}): [${toolsCalled.join(', ') || '(none)'}]`,
  );
  console.log(`Response length: ${responseText.length}`);
  console.log(`Response preview: ${responseText.slice(0, 200)}`);
  console.log(`Response bodies captured: ${responseBodies.length}`);
  console.log(`AI log lines: ${aiLogLines.length}`);
  aiLogLines.forEach((l) => console.log(`  ${l}`));
  console.log('================================\n');

  test
    .info()
    .annotations.push(
      { type: 'B6-query', description: query },
      { type: 'B6-tools-called', description: toolsCalled.join(',') },
      { type: 'B6-response-preview', description: responseText.slice(0, 500) },
    );

  // Assert the AI actually responded with substantive text
  expect(responseText.length).toBeGreaterThan(0);
  // Assert at least one NDJSON response body was captured from the stream
  expect(responseBodies.length).toBeGreaterThan(0);
});
