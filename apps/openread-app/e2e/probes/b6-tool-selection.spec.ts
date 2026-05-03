import { test, expect } from '../fixtures/auth';

/**
 * B6 — Tool selection probe.
 *
 * Asks 3 question types each designed to trigger a different tool, captures
 * the NDJSON stream from /api/ai/agentic-chat, and records which tools were
 * actually called.
 *
 * Expected tool mapping (from src/services/ai/tools/bookTools.ts):
 *   "List all chapters and their titles"          → get_headings / get_structure
 *   "Search the book for every mention of 'niche'" → search_content / multi_hop_search
 *   "Summarize chapter 2"                          → read_chapter
 *
 * Capture strategy: listen to page.on('response') for the agentic-chat URL
 * and call response.text() to drain the streamed body, then parse it as
 * line-delimited JSON to extract `{type: "tool-call", toolName: "..."}` events.
 *
 * Finding template per question:
 *   - Query
 *   - Tools actually called (in order)
 *   - Expected tool(s)
 *   - Match? Y/N
 *   - Response length (sanity)
 */

const BOOK_HASH = '65c789be32848655bc89109cb69cc712';
const BOOK_TITLE_SUBSTRING = '1-Page Marketing';

const QUERIES: { query: string; expectedTools: string[] }[] = [
  {
    query: 'List all the chapters and their titles in this book.',
    expectedTools: ['get_headings', 'get_structure'],
  },
  {
    query: "Search the book for every mention of the word 'niche' and list them.",
    expectedTools: ['search_content', 'multi_hop_search'],
  },
  {
    query: 'Summarize chapter 2 in two sentences.',
    expectedTools: ['read_chapter', 'read_passage'],
  },
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

interface QueryResult {
  query: string;
  expectedTools: string[];
  toolsCalled: string[];
  responseLen: number;
  plannerTier: string;
  expandedTerms: string[];
}

test('B6 — agent selects appropriate tool for different question types', async ({
  authenticatedPage: page,
}) => {
  // Captured responses: for each /api/ai/agentic-chat response, we drain the
  // body and parse NDJSON events, collecting tool-call toolNames in order.
  const responseBodies: string[] = [];
  page.on('response', async (response) => {
    if (response.url().includes('/api/ai/agentic-chat')) {
      try {
        const body = await response.text();
        responseBodies.push(body);
      } catch {
        // stream may have been consumed already
      }
    }
  });

  // Console capture: Planner: ... tier=X and Terms: [...]
  const consoleLines: string[] = [];
  page.on('console', (msg) => {
    consoleLines.push(msg.text());
  });

  const inlineInput = await navigateToBookWithInlineBar(page);

  const results: QueryResult[] = [];

  for (let i = 0; i < QUERIES.length; i++) {
    const { query, expectedTools } = QUERIES[i]!;
    console.log(`\n[B6] Query ${i + 1}/${QUERIES.length}: "${query}"`);

    // Snapshot before submit so we can diff responses/logs after
    const snapshotIdx = responseBodies.length;
    const consoleSnapshot = consoleLines.length;

    // For queries after the first, use the notebook's composer (inline bar
    // creates a new conversation each time). Actually — we want isolation
    // so each query IS a new conversation. The inline bar does that.
    const inputForThisQuery = await page
      .getByPlaceholder('Ask about this book...')
      .first()
      .isVisible()
      .catch(() => false);
    const freshInput = inputForThisQuery
      ? page.getByPlaceholder('Ask about this book...').first()
      : inlineInput;

    await freshInput.click();
    await freshInput.fill(query);
    await freshInput.press('Enter');

    // Wait for response to complete — poll until we see text longer than 30 chars
    let responseText = '';
    try {
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
                    !t.includes('AI can make mistakes') &&
                    !t.startsWith('8 messages left') &&
                    !t.startsWith('Ask about this book') &&
                    !t.startsWith(query.slice(0, 20)),
                );
              return responses.sort((a, b) => b.length - a.length)[0] ?? '';
            });
            responseText = result;
            return result.length;
          },
          { timeout: 90_000, intervals: [1000, 2000, 2000] },
        )
        .toBeGreaterThan(30);
    } catch {
      console.log(`[B6] Query ${i + 1} timed out waiting for response`);
    }

    // Parse NDJSON from the new response(s) to extract tool-call events
    const newBodies = responseBodies.slice(snapshotIdx);
    const toolsCalled: string[] = [];
    for (const body of newBodies) {
      for (const line of body.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const event = JSON.parse(trimmed);
          if (event.type === 'tool-call' && typeof event.toolName === 'string') {
            toolsCalled.push(event.toolName);
          }
        } catch {
          // skip malformed lines
        }
      }
    }

    // Extract planner tier + expanded terms from console output
    const newConsole = consoleLines.slice(consoleSnapshot);
    const tierLine = newConsole.find((l) => l.includes('Planner:')) ?? '';
    const tierMatch = tierLine.match(/tier=(\w+)/);
    const plannerTier = tierMatch?.[1] ?? 'unknown';

    const termsLine = newConsole.find((l) => l.includes('Terms:')) ?? '';
    const termsMatch = termsLine.match(/\[([^\]]*)\]/);
    const expandedTerms = termsMatch?.[1]?.split(',').map((s) => s.trim()) ?? [];

    results.push({
      query,
      expectedTools,
      toolsCalled,
      responseLen: responseText.length,
      plannerTier,
      expandedTerms,
    });

    console.log(`[B6]   Tools called: [${toolsCalled.join(', ') || '(none)'}]`);
    console.log(`[B6]   Expected: [${expectedTools.join(' or ')}]`);
    console.log(`[B6]   Tier: ${plannerTier}`);
    console.log(`[B6]   Response length: ${responseText.length}`);

    // Before next query: navigate back to /home and re-open the book for
    // a FRESH conversation. This keeps each probe isolated.
    if (i < QUERIES.length - 1) {
      await navigateToBookWithInlineBar(page);
    }
  }

  console.log('\n===== B6 TOOL SELECTION FINDINGS =====');
  for (const r of results) {
    const match = r.toolsCalled.some((t) => r.expectedTools.includes(t));
    console.log(`Q: "${r.query}"`);
    console.log(
      `   tier=${r.plannerTier}  tools=[${r.toolsCalled.join(',') || '(none)'}]  expected=[${r.expectedTools.join('|')}]  match=${match}  respLen=${r.responseLen}`,
    );
  }
  console.log('=======================================\n');

  test
    .info()
    .annotations.push({ type: 'B6-results', description: JSON.stringify(results, null, 2) });

  // Tolerant: just verify all 3 queries ran to completion
  expect(results.length).toBe(QUERIES.length);
});
