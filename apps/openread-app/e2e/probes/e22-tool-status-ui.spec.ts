import { test, expect } from '../fixtures/auth';

/**
 * E22 — Tool-call status UI probe.
 *
 * Verifies the user can see what the agent is doing during tool calls
 * via the TypingIndicator at src/components/assistant/Thread.tsx:336-367.
 *
 * The indicator shows `chatStatus || 'Thinking...'` — driven by
 * `setChatStatus(toolCallToStatus(toolName))` in AgenticChatAdapter.ts:71-86.
 *
 * Status mappings known from code:
 *   search_content     → 'Searching the book...'
 *   read_passage       → 'Reading passage...'
 *   read_chapter       → 'Reading passage...'
 *   get_structure      → 'Checking book structure...'
 *   get_headings       → 'Scanning headings...'
 *   multi_hop_search   → (no case → falls back to 'Thinking...')  ← known gap
 *
 * Visibility: the indicator hides as soon as the assistant starts streaming
 * text (Thread.tsx:352). So the visible window is: submit → first token.
 *
 * Capture strategy: poll document.body.innerText every 200ms during the
 * query, record every DISTINCT status string observed. That gives us the
 * timeline of what the user saw.
 */

const BOOK_HASH = '65c789be32848655bc89109cb69cc712';
const BOOK_TITLE_SUBSTRING = '1-Page Marketing';

// Known status strings we care about
const STATUS_STRINGS = [
  'Searching the book...',
  'Reading passage...',
  'Checking book structure...',
  'Scanning headings...',
  'Reading page...',
  'Thinking...',
];

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

test('E22 — tool-call status UI appears during agent execution', async ({
  authenticatedPage: page,
}) => {
  const inlineInput = await navigateToBookWithInlineBar(page);

  // Use a tool-forcing query so we know tools WILL fire (from B6 evidence)
  const query = "Search the book for every mention of the word 'niche'.";
  await inlineInput.click();
  await inlineInput.fill(query);
  await inlineInput.press('Enter');

  // Poll the DOM every 200ms for status text. Collect all distinct strings seen.
  const seenStatuses = new Set<string>();
  const startTs = Date.now();
  const maxDuration = 60_000;
  let streamStartedAt: number | null = null;

  while (Date.now() - startTs < maxDuration) {
    const snapshot = await page.evaluate(
      ({ statuses }) => {
        const body = document.body.innerText ?? '';
        const found: string[] = [];
        for (const s of statuses as string[]) {
          if (body.includes(s)) found.push(s);
        }
        // Also capture any substantive assistant response content (to detect stream start)
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
        const longestResponse = responses.sort((a, b) => b.length - a.length)[0] ?? '';
        return {
          found,
          responseLen: longestResponse.length,
          responsePreview: longestResponse.slice(0, 100),
        };
      },
      { statuses: STATUS_STRINGS },
    );

    for (const s of snapshot.found) {
      if (!seenStatuses.has(s)) {
        const elapsed = Date.now() - startTs;
        console.log(`[E22] +${elapsed}ms  NEW STATUS: "${s}"`);
        seenStatuses.add(s);
      }
    }

    if (snapshot.responseLen > 30 && streamStartedAt === null) {
      streamStartedAt = Date.now() - startTs;
      console.log(
        `[E22] +${streamStartedAt}ms  STREAM STARTED (responseLen=${snapshot.responseLen})`,
      );
    }

    // Stop polling when the stream has been going for 3s (plenty of time for all transitions)
    if (streamStartedAt !== null && Date.now() - startTs - streamStartedAt > 3_000) {
      break;
    }

    await page.waitForTimeout(200);
  }

  console.log('\n===== E22 STATUS UI FINDINGS =====');
  console.log(`Distinct statuses seen: ${seenStatuses.size}`);
  seenStatuses.forEach((s) => console.log(`  - "${s}"`));
  console.log(`Stream started at: ${streamStartedAt === null ? 'never' : `+${streamStartedAt}ms`}`);
  console.log(`Total poll duration: ${Date.now() - startTs}ms`);
  console.log('===================================\n');

  test
    .info()
    .annotations.push(
      { type: 'E22-distinct-statuses', description: Array.from(seenStatuses).join(' | ') },
      { type: 'E22-stream-started-ms', description: String(streamStartedAt) },
    );

  // At minimum "Thinking..." must have appeared — it is the unconditional
  // default shown before any tool-specific status fires, and before the first
  // streaming token arrives.  If this fails it means the typing indicator is
  // broken entirely (regression in Thread.tsx TypingIndicator).
  expect(seenStatuses.size).toBeGreaterThan(0);
  expect(seenStatuses.has('Thinking...')).toBe(true);
});
