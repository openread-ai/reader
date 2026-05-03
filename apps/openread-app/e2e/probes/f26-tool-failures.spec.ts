import { test, expect } from '../fixtures/auth';
import { navigateToBookReader } from '../helpers/navigate-to-reader';

/**
 * F26 — Tool failures probe.
 *
 * Forces the agent into a situation where a tool call will return
 * `{found: false, message: "No chapter matching ... found."}` — i.e. a
 * read_chapter / read_passage call for a chapter title that doesn't exist.
 *
 * Observation points:
 *
 *   1. Does the agent actually call the failing tool? (expected: yes if
 *      the question names a specific chapter)
 *   2. What does the agent do after receiving `{found: false}`?
 *      a. Gracefully fall back to search_content — IDEAL
 *      b. Try read_chapter again with a different spelling — OK
 *      c. Hallucinate content that doesn't exist — BAD
 *      d. Apologise and ask the user — BAD (matches C11 finding)
 *   3. Does the final user-facing response explain that the chapter wasn't
 *      found? Or does it silently paper over the failure?
 *
 * Source: src/services/ai/tools/bookTools.ts:491-514 (read_passage),
 *         bookTools.ts:517-560 (read_chapter), findChapter() fuzzy matching.
 */

const BOOK_HASH = '65c789be32848655bc89109cb69cc712';

test('F26 — agent handles read_chapter returning {found: false}', async ({
  authenticatedPage: page,
}) => {
  const responseBodies: string[] = [];
  page.on('response', async (response) => {
    if (response.url().includes('/api/ai/agentic-chat')) {
      try {
        const body = await response.text();
        responseBodies.push(body);
      } catch {
        // stream may not be readable
      }
    }
  });

  const consoleLines: string[] = [];
  page.on('console', (msg) => consoleLines.push(msg.text()));

  const inlineInput = await navigateToBookReader(page, BOOK_HASH);

  // Ask for a chapter that does NOT exist in The 1-Page Marketing Plan.
  // "Flibbertigibbet" is a nonsense string that won't fuzzy-match anything.
  // The read_chapter tool uses findChapter() which does substring match;
  // no substring of "Flibbertigibbet" will appear in any chapter title.
  const query =
    'Please read the chapter titled "Flibbertigibbet Quantum Mechanics" from this book and summarize it.';

  await inlineInput.click();
  await inlineInput.fill(query);
  await inlineInput.press('Enter');

  // Wait for response to complete (or give up)
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
                  !t.startsWith('Please read the chapter'),
              );
            return responses.sort((a, b) => b.length - a.length)[0] ?? '';
          });
          responseText = result;
          return result.length;
        },
        { timeout: 90_000, intervals: [1000, 2000] },
      )
      .toBeGreaterThan(30);
  } catch {
    // Poll gave up — still useful data
  }

  // Parse tool calls from NDJSON bodies
  const toolsCalled: { name: string; raw: string }[] = [];
  const toolResults: { name: string; result: string }[] = [];
  for (const body of responseBodies) {
    for (const line of body.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const event = JSON.parse(trimmed);
        if (event.type === 'tool-call' && typeof event.toolName === 'string') {
          toolsCalled.push({ name: event.toolName, raw: trimmed });
        }
        if (event.type === 'tool-result' && typeof event.toolName === 'string') {
          toolResults.push({
            name: event.toolName,
            result: JSON.stringify(event.result).slice(0, 200),
          });
        }
      } catch {
        // skip
      }
    }
  }

  // Detect failure-handling signals in response text
  const mentionsNotFound =
    /not (?:found|exist|in this book)|no (?:such|chapter)|couldn['’]?t find|doesn['’]?t (?:exist|contain|have)/i.test(
      responseText,
    );
  const mentionsFlibbertigibbet = /flibbertigibbet/i.test(responseText);
  const hallucinatedSummary = responseText.length > 200 && !mentionsNotFound;

  console.log('\n===== F26 TOOL FAILURES FINDINGS =====');
  console.log(`Query: "${query}"`);
  console.log(`Tools called (${toolsCalled.length}): ${toolsCalled.map((t) => t.name).join(', ')}`);
  console.log(`Tool results (${toolResults.length}):`);
  toolResults.forEach((t) => console.log(`  ${t.name}: ${t.result}`));
  console.log(`Response length: ${responseText.length}`);
  console.log(`Response mentions "not found" style: ${mentionsNotFound}`);
  console.log(`Response mentions 'Flibbertigibbet' (echoed query): ${mentionsFlibbertigibbet}`);
  console.log(`Possibly hallucinated content: ${hallucinatedSummary}`);
  console.log(`Response preview: ${responseText.slice(0, 300)}`);
  console.log('=========================================\n');

  test.info().annotations.push(
    {
      type: 'F26-tools-called',
      description: toolsCalled.map((t) => t.name).join(',') || '(none)',
    },
    { type: 'F26-mentions-not-found', description: String(mentionsNotFound) },
    { type: 'F26-possibly-hallucinated', description: String(hallucinatedSummary) },
    { type: 'F26-response-preview', description: responseText.slice(0, 500) },
  );

  // The agent must respond with something substantive — even if the chapter
  // doesn't exist, it should acknowledge the failure rather than hang silently.
  // A length of 0 means the AI produced no output at all (broken pipeline).
  // A length of <=10 means only whitespace / a single word slipped through.
  expect(responseText.length).toBeGreaterThan(10);
  expect(
    toolsCalled.some((tool) => tool.name === 'read_chapter' || tool.name === 'read_passage'),
  ).toBe(true);
  expect(mentionsNotFound).toBe(true);
  expect(hallucinatedSummary).toBe(false);
});
