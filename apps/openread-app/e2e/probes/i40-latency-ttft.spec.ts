import { test, expect } from '../fixtures/auth';
import { navigateToBookReader } from '../helpers/navigate-to-reader';

/**
 * I40 — Latency / time-to-first-token probe.
 *
 * Measures perceived responsiveness: from Enter-press to when the first
 * substantive text appears in the assistant message. Runs three query types
 * to exercise different planner tiers:
 *
 *   Greeting  ("Hi!") ............... planner skipped entirely
 *                                     (contextPlanner.ts:200-204 greeting check)
 *   Local     ("What's this about?") ... tier=local, ~3-5K inline chars
 *   Search    ("search for...") ........ tier=search, tool-only, tools fire
 *
 * For each, three numbers:
 *   - submit_to_status: when the first status text appears ("Thinking...", etc.)
 *   - submit_to_first_token: when the first message text > 20 chars appears
 *   - submit_to_complete: when the response stops growing for 2 consecutive polls
 *
 * Each sub-test is a separate Playwright test to avoid the context-destruction
 * issue that broke the multi-query B6 probe.
 */

const BOOK_HASH = '65c789be32848655bc89109cb69cc712';

interface Timings {
  submitAt: number;
  firstStatusAt: number | null;
  firstTokenAt: number | null;
  completeAt: number | null;
  responseLen: number;
  tier: string;
}

async function measureQuery(
  page: import('@playwright/test').Page,
  query: string,
  maxWaitMs: number,
): Promise<Timings> {
  const consoleLines: string[] = [];
  page.on('console', (msg) => consoleLines.push(msg.text()));

  const inlineInput = await navigateToBookReader(page, BOOK_HASH);
  await inlineInput.click();
  await inlineInput.fill(query);

  const submitAt = Date.now();
  await inlineInput.press('Enter');

  const timings: Timings = {
    submitAt: 0,
    firstStatusAt: null,
    firstTokenAt: null,
    completeAt: null,
    responseLen: 0,
    tier: 'unknown',
  };

  const STATUSES = [
    'Thinking...',
    'Searching the book...',
    'Reading passage...',
    'Scanning headings...',
    'Checking book structure...',
  ];

  let lastLen = 0;
  let stableCount = 0;

  while (Date.now() - submitAt < maxWaitMs) {
    const snapshot = await page
      .evaluate(
        ({ statuses }) => {
          const body = document.body.innerText ?? '';
          const statusFound = (statuses as string[]).find((s) => body.includes(s)) ?? null;
          const candidates = Array.from(
            document.querySelectorAll('p, div[class*="message"], div[class*="Message"]'),
          );
          const responses = candidates
            .map((el) => (el as HTMLElement).innerText?.trim() ?? '')
            .filter(
              (t) =>
                t.length > 20 &&
                !t.includes('AI can make mistakes') &&
                !t.startsWith('8 messages left') &&
                !t.startsWith('Ask about this book'),
            );
          const longest = responses.sort((a, b) => b.length - a.length)[0] ?? '';
          return { statusFound, responseLen: longest.length };
        },
        { statuses: STATUSES },
      )
      .catch(() => ({ statusFound: null as string | null, responseLen: 0 }));

    const elapsed = Date.now() - submitAt;

    if (snapshot.statusFound && timings.firstStatusAt === null) {
      timings.firstStatusAt = elapsed;
    }
    if (snapshot.responseLen > 20 && timings.firstTokenAt === null) {
      timings.firstTokenAt = elapsed;
    }

    timings.responseLen = snapshot.responseLen;

    // Check for stable completion
    if (snapshot.responseLen > 0 && snapshot.responseLen === lastLen) {
      stableCount++;
      if (stableCount >= 2) {
        timings.completeAt = elapsed;
        break;
      }
    } else {
      stableCount = 0;
      lastLen = snapshot.responseLen;
    }

    await page.waitForTimeout(200);
  }

  // Parse tier from console
  const tierLine = consoleLines.find((l) => l.includes('Planner:')) ?? '';
  const tierMatch = tierLine.match(/tier=(\w+)/);
  timings.tier = tierMatch?.[1] ?? 'unknown';

  console.log(`\n[I40] query: "${query}"`);
  console.log(`       tier: ${timings.tier}`);
  console.log(`       first status: ${timings.firstStatusAt ?? '(never)'}ms`);
  console.log(`       first token: ${timings.firstTokenAt ?? '(never)'}ms`);
  console.log(`       complete: ${timings.completeAt ?? '(never)'}ms`);
  console.log(`       response length: ${timings.responseLen}`);

  return timings;
}

test('I40a — greeting latency (planner skipped)', async ({ authenticatedPage: page }) => {
  const timings = await measureQuery(page, 'Hello! Say hi back in one short sentence.', 60_000);
  test
    .info()
    .annotations.push(
      { type: 'I40a-tier', description: timings.tier },
      { type: 'I40a-first-token-ms', description: String(timings.firstTokenAt) },
      { type: 'I40a-complete-ms', description: String(timings.completeAt) },
    );
  expect(timings.responseLen).toBeGreaterThan(0);
  // Latency ceiling: first token must arrive within 30 seconds.
  // Exceeding this ceiling indicates a catastrophic regression (hung planner,
  // broken Groq connection, or infinite tool loop before any text streams).
  if (timings.firstTokenAt !== null) {
    expect(timings.firstTokenAt).toBeLessThan(30_000);
  }
});

test('I40b — local-tier latency', async ({ authenticatedPage: page }) => {
  const timings = await measureQuery(
    page,
    'What is the core idea of this book? Reply in one short sentence.',
    90_000,
  );
  test
    .info()
    .annotations.push(
      { type: 'I40b-tier', description: timings.tier },
      { type: 'I40b-first-token-ms', description: String(timings.firstTokenAt) },
      { type: 'I40b-complete-ms', description: String(timings.completeAt) },
    );
  expect(timings.responseLen).toBeGreaterThan(0);
  // Latency ceiling: first token must arrive within 30 seconds.
  if (timings.firstTokenAt !== null) {
    expect(timings.firstTokenAt).toBeLessThan(30_000);
  }
});

test('I40c — search-tier latency (tools fire)', async ({ authenticatedPage: page }) => {
  const timings = await measureQuery(
    page,
    "Search the book for the word 'customer' and list a couple of mentions.",
    120_000,
  );
  test
    .info()
    .annotations.push(
      { type: 'I40c-tier', description: timings.tier },
      { type: 'I40c-first-token-ms', description: String(timings.firstTokenAt) },
      { type: 'I40c-complete-ms', description: String(timings.completeAt) },
    );
  expect(timings.responseLen).toBeGreaterThan(0);
  // Latency ceiling: first token must arrive within 30 seconds even for
  // search-tier queries that fire tools first.  The ceiling is intentionally
  // generous to accommodate Groq cold starts, but still catches hangs.
  if (timings.firstTokenAt !== null) {
    expect(timings.firstTokenAt).toBeLessThan(30_000);
  }
});
