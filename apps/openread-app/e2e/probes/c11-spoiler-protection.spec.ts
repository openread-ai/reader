import { test, expect } from '../fixtures/auth';

/**
 * C11 — Spoiler protection probe.
 *
 * Verifies that when a reader is at an early position in a book, the agent
 * CANNOT retrieve or expose content from later chapters via read_chapter /
 * read_passage tool calls. Spoiler protection is ON by default
 * (`DEFAULT_AI_SETTINGS.spoilerProtection === true` in
 * src/services/ai/constants.ts:77).
 *
 * Mechanism under test (src/services/ai/tools/bookTools.ts:497-544):
 *   - read_passage / read_chapter compare absolute offset against ctx.maxCharOffset
 *   - When beyond, return { found: false, message: 'beyond what the reader has read so far.' }
 *
 * Observation strategy:
 *   1. Capture console output from AgenticChatAdapter — it logs position as
 *      "[AI] Position: section ... char-page N"
 *   2. Capture network response body from /api/ai/agentic-chat — NDJSON stream
 *      contains tool-call results; look for 'beyond what the reader has read'
 *      vs. actual late-chapter content leaking through
 *   3. Assert: response text does NOT contain specific late-chapter markers
 *
 * We ask for an EXACT QUOTE from the book's final content because:
 *   - Agent cannot hallucinate an exact quote from training data
 *   - Forces a tool call to read_chapter or read_passage
 *   - Makes spoiler-leak detection concrete (match specific strings)
 */

const BOOK_TITLE_SUBSTRING = '1-Page Marketing';
const BOOK_HASH = '65c789be32848655bc89109cb69cc712';

test('C11 — spoiler protection blocks tool access to late chapters', async ({
  authenticatedPage: page,
}) => {
  // Capture all console logs — look for position debug + tool-call logs
  const consoleLogs: string[] = [];
  page.on('console', (msg) => {
    const text = msg.text();
    consoleLogs.push(text);
    if (text.includes('[AI]') || text.includes('spoiler') || text.includes('beyond')) {
      console.log(`[probe console] ${text}`);
    }
  });

  // Capture network responses to the agentic-chat endpoint
  const agenticChatResponses: string[] = [];
  page.on('response', async (response) => {
    if (response.url().includes('/api/ai/agentic-chat')) {
      try {
        const body = await response.text();
        agenticChatResponses.push(body);
      } catch {
        // stream may not be readable
      }
    }
  });

  // Open book via library (same flow as smoke test)
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

  // Ask a question designed to FORCE a tool call to a late chapter.
  // "1-Page Marketing Plan" has ~9 chapters ('squares'). Asking about the
  // final one requires read_chapter on a late section.
  await inlineInput.click();
  await inlineInput.fill(
    'Quote the first two sentences from the final chapter (Square 9) of this book exactly.',
  );
  await inlineInput.press('Enter');

  // Poll for response — either spoiler protection refusal OR leak
  let responseText = '';
  await expect
    .poll(
      async () => {
        const result = await page.evaluate(() => {
          const candidates = Array.from(
            document.querySelectorAll('p, div[class*="message"], div[class*="Message"]'),
          );
          const responses = candidates
            .map((el) => (el as HTMLElement).innerText?.trim() ?? '')
            .filter(
              (t) =>
                t.length > 30 &&
                !t.startsWith('Quote the first') &&
                !t.includes('AI can make mistakes') &&
                !t.startsWith('8 messages left') &&
                !t.startsWith('Ask about this book'),
            );
          return responses.sort((a, b) => b.length - a.length)[0] ?? '';
        });
        responseText = result;
        return result.length;
      },
      {
        message: 'waiting for assistant response',
        timeout: 120_000,
        intervals: [1000, 2000, 2000],
      },
    )
    .toBeGreaterThan(30);

  // Dump full findings for the Phase B doc
  const positionLogs = consoleLogs.filter((l) => l.includes('[AI] Position'));
  const spoilerProtectionHits = consoleLogs.filter(
    (l) =>
      l.includes('beyond what the reader has read') ||
      l.includes('Beyond what the reader has read'),
  );

  console.log('\n===== C11 SPOILER PROTECTION FINDINGS =====');
  console.log(`Position logs captured: ${positionLogs.length}`);
  positionLogs.forEach((l) => console.log(`  ${l}`));
  console.log(`Spoiler protection trigger messages: ${spoilerProtectionHits.length}`);
  spoilerProtectionHits.forEach((l) => console.log(`  ${l}`));
  console.log(`\nFinal response text (${responseText.length} chars):`);
  console.log(`  ${responseText.slice(0, 500)}`);
  console.log(`\nNetwork response bodies captured: ${agenticChatResponses.length}`);

  // Scan network bodies for the spoiler-protection message
  const bodyHasSpoilerBlock = agenticChatResponses.some((body) =>
    body.includes('beyond what the reader has read'),
  );
  console.log(`Tool returned spoiler-block message: ${bodyHasSpoilerBlock}`);
  console.log('============================================\n');

  // The AI must respond with an explicit spoiler-safe refusal, not blank text
  // and not leaked content from the final chapter.
  expect(responseText.length).toBeGreaterThan(30);

  // The response must NOT contain the verbatim Square 9 opener that would
  // only appear if the spoiler-protection tool block was bypassed.
  // Known Square 9 content marker from the book (first ~60 chars of final chapter).
  // If this starts failing it means the tool barrier leaked late-chapter content.
  // NOTE: after finding #1/#2 (tool path bug) is fixed, strengthen this to also
  // assert that the response contains the spoiler-block refusal message (e.g.
  // /beyond what you.*read|spoiler/i) when the tool call path is exercised.
  const SQUARE_9_LEAK_MARKER = 'Your Marketing Infrastructure';
  expect(responseText).not.toContain(SQUARE_9_LEAK_MARKER);
  expect(bodyHasSpoilerBlock).toBe(true);
  expect(responseText).toMatch(
    /beyond what (?:the )?reader has read|haven't read that far|spoiler|not reached yet/i,
  );

  // Attach findings to test annotations for later analysis
  test
    .info()
    .annotations.push(
      { type: 'C11-response-text', description: responseText.slice(0, 1000) },
      { type: 'C11-position-logs', description: JSON.stringify(positionLogs) },
      { type: 'C11-spoiler-blocks', description: String(spoilerProtectionHits.length) },
      { type: 'C11-tool-blocked', description: String(bodyHasSpoilerBlock) },
    );
});
