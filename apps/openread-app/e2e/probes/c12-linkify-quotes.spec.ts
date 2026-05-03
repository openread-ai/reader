import { test, expect } from '../fixtures/auth';
import { navigateToBookReader } from '../helpers/navigate-to-reader';

/**
 * C12 — Linkify-quotes probe.
 *
 * Verifies that the `linkifyQuotes` post-processor wraps quoted text in AI
 * responses with `openread://loc/OFFSET` citation links, allowing the reader
 * to jump to the exact book location referenced by the AI.
 *
 * Mechanism under test:
 *   src/services/ai/linkify-quotes.ts — `linkifyQuotes(text, book)` scans
 *   for double-quoted substrings in the AI response, fuzzy-matches them
 *   against the book's indexed content, and replaces them with
 *   <a href="openread://loc/{charOffset}">{quote}</a>.
 *
 * Observation strategy:
 *   1. Submit a tool-forcing query designed to make the AI quote exact
 *      passages: "Search the book for every mention of 'niche' and quote
 *      the exact passages". This forces search_content which returns
 *      verbatim passages the AI then quotes in its response.
 *   2. After the response appears, scan the DOM for
 *      <a href^="openread://loc/"> elements.
 *   3. If links found: record count and href values; try clicking one and
 *      observe whether the reader navigates.
 *   4. Annotate: link count, hrefs sample, click behaviour.
 *
 * Note on "no links" case: if the AI paraphrases rather than quoting
 * verbatim, linkifyQuotes has nothing to match and no links are inserted.
 * This is also a valid (expected) finding — the probe documents either outcome.
 *
 * Source: src/services/ai/linkify-quotes.ts
 *         src/components/assistant/Thread.tsx (applies linkify post-processor)
 */

test.setTimeout(180_000);

const BOOK_HASH = '65c789be32848655bc89109cb69cc712';

// Query designed to force tool use AND verbatim quoting
const TOOL_FORCING_QUERY =
  "Search the book for every mention of 'niche' and quote the exact passages word-for-word in double quotes.";

async function waitForAssistantResponse(page: import('@playwright/test').Page): Promise<string> {
  let responseText = '';
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
        } catch {
          return 0;
        }
      },
      {
        message: 'waiting for assistant response',
        timeout: 120_000,
        intervals: [1000, 2000, 2000],
      },
    )
    .toBeGreaterThan(30);
  return responseText;
}

test('C12 — quoted AI response text is wrapped in openread://loc/ citation links', async ({
  authenticatedPage: page,
}) => {
  // Capture agentic-chat NDJSON to confirm tools were called
  const agenticChatBodies: string[] = [];
  page.on('response', async (response) => {
    if (response.url().includes('/api/ai/agentic-chat')) {
      try {
        const body = await response.text();
        agenticChatBodies.push(body);
      } catch {
        // stream may not be readable
      }
    }
  });

  // Capture console for tool-call and linkify debug output
  const consoleLogs: string[] = [];
  page.on('console', (msg) => {
    const text = msg.text();
    consoleLogs.push(text);
    if (
      text.includes('[AI]') ||
      text.includes('linkify') ||
      text.includes('search_content') ||
      text.includes('openread://')
    ) {
      console.log(`[C12 console] ${text}`);
    }
  });

  const inlineInput = await navigateToBookReader(page, BOOK_HASH);

  await inlineInput.click();
  await inlineInput.fill(TOOL_FORCING_QUERY);
  await inlineInput.press('Enter');

  const responseText = await waitForAssistantResponse(page);
  console.log(`[C12] Response (${responseText.length} chars): ${responseText.slice(0, 200)}...`);

  // Wait a moment for any DOM post-processing (linkify runs after stream completes)
  await page.waitForTimeout(1500);

  // Check for openread://loc/ links in the rendered HTML
  const quoteLinks = await page.locator('a[href^="openread://loc/"]').count();
  console.log(`[C12] openread://loc/ links found: ${quoteLinks}`);

  // Collect hrefs and link text for first few links
  const linkDetails: { href: string; text: string }[] = [];
  if (quoteLinks > 0) {
    const allLinks = page.locator('a[href^="openread://loc/"]');
    const count = Math.min(quoteLinks, 5); // sample up to 5
    for (let i = 0; i < count; i++) {
      const link = allLinks.nth(i);
      const href = (await link.getAttribute('href')) ?? '';
      const text = (await link.textContent()) ?? '';
      linkDetails.push({ href, text: text.slice(0, 100) });
      console.log(`[C12]   link[${i}]: href="${href}" text="${text.slice(0, 80)}"`);
    }
  }

  // Try clicking the first link to see if reader navigates
  let clickBehaviour = 'not attempted — no links found';
  let urlAfterClick = '';

  if (quoteLinks > 0) {
    const _firstLink = page.locator('a[href^="openread://loc/"]').first();
    const urlBefore = page.url();

    try {
      // Use page.evaluate to click so we can intercept the custom protocol handler
      const clickResult = await page.evaluate(() => {
        const link = document.querySelector(
          'a[href^="openread://loc/"]',
        ) as HTMLAnchorElement | null;
        if (!link) return { found: false, href: '' };
        link.click();
        return { found: true, href: link.href };
      });
      console.log(`[C12] Clicked link with href: ${clickResult.href}`);
      await page.waitForTimeout(1000);
      urlAfterClick = page.url();

      if (urlAfterClick !== urlBefore) {
        clickBehaviour = `reader navigated — URL changed from "${urlBefore.slice(-50)}" to "${urlAfterClick.slice(-50)}"`;
      } else {
        clickBehaviour =
          'URL unchanged after click — custom protocol may be handled without navigation (scroll or highlight)';
      }
    } catch (e) {
      clickBehaviour = `click threw: ${e}`;
    }
  }

  // Check response text for double-quoted strings (these are the candidates for linkification)
  const doubleQuotedMatches = responseText.match(/"[^"]{10,200}"/g) ?? [];
  const hasVerbatimQuotes = doubleQuotedMatches.length > 0;

  // Parse NDJSON to check if search_content tool was called
  const toolsCalled: string[] = [];
  for (const body of agenticChatBodies) {
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

  // Check for linkify-related console output
  const linkifyLogs = consoleLogs.filter((l) => /linkify|openread:\/\//i.test(l));

  console.log('\n===== C12 LINKIFY QUOTES FINDINGS =====');
  console.log(`Query: "${TOOL_FORCING_QUERY}"`);
  console.log(`Tools called: [${toolsCalled.join(', ') || '(none)'}]`);
  console.log(`Response length: ${responseText.length}`);
  console.log(`Double-quoted strings in response: ${doubleQuotedMatches.length}`);
  if (doubleQuotedMatches.length > 0) {
    doubleQuotedMatches.slice(0, 3).forEach((q, i) => {
      console.log(`  quote[${i}]: "${q.slice(0, 80)}"`);
    });
  }
  console.log(`openread://loc/ links rendered: ${quoteLinks}`);
  if (linkDetails.length > 0) {
    linkDetails.forEach((l, i) => console.log(`  link[${i}]: ${l.href} — "${l.text}"`));
  }
  console.log(`Click behaviour: ${clickBehaviour}`);
  console.log(`Linkify console logs: ${linkifyLogs.length}`);
  linkifyLogs.forEach((l) => console.log(`  ${l}`));
  console.log('========================================\n');

  test.info().annotations.push(
    { type: 'C12-tools-called', description: toolsCalled.join(', ') || '(none)' },
    { type: 'C12-response-length', description: String(responseText.length) },
    { type: 'C12-double-quoted-strings', description: String(doubleQuotedMatches.length) },
    { type: 'C12-openread-links-count', description: String(quoteLinks) },
    {
      type: 'C12-link-details',
      description: linkDetails.length > 0 ? JSON.stringify(linkDetails) : '(no links)',
    },
    { type: 'C12-click-behaviour', description: clickBehaviour },
    {
      type: 'finding',
      description:
        quoteLinks > 0
          ? `linkifyQuotes is WORKING — ${quoteLinks} openread://loc/ link(s) found in the response. ${hasVerbatimQuotes ? `${doubleQuotedMatches.length} quoted strings were in the raw response text.` : ''} Click: ${clickBehaviour}`
          : hasVerbatimQuotes
            ? `linkifyQuotes NOT working — response contains ${doubleQuotedMatches.length} double-quoted string(s) but zero openread://loc/ links were rendered. linkify post-processor may not be running or fuzzy-match threshold is too strict.`
            : toolsCalled.length > 0
              ? `Tools fired (${toolsCalled.join(', ')}) but AI did not use verbatim double-quotes in response — no candidate strings for linkifyQuotes to match. Try a more explicit quoting instruction.`
              : 'No tools called and no verbatim quotes in response — query did not trigger tool path. linkifyQuotes requires tool-returned passages.',
    },
  );

  // The AI must have responded with something substantive — probe ran end-to-end
  expect(responseText.length).toBeGreaterThan(30);
});
