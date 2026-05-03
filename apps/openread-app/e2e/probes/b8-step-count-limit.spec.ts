import { test, expect } from '../fixtures/auth';
import { navigateToBookReader } from '../helpers/navigate-to-reader';

/**
 * B8 — Agent step-count limit probe.
 *
 * Tests what the user sees when the agent exhausts MAX_AGENT_STEPS (12 tool
 * calls) without ever emitting a text event.
 *
 * The adapter (AgenticChatAdapter.ts) drains the NDJSON stream and then
 * synthesises a final message from accumulated text events. If there are zero
 * text events the adapter is expected to fall back to a canned message:
 *   "I couldn't find enough information to answer that. Could you try
 *    rephrasing your question?"
 * (as of the current adapter implementation).
 *
 * This scenario is hard to trigger with a real backend because Groq/the model
 * will usually emit at least one text token after 12 tool calls. We use
 * page.route to mock the NDJSON stream with exactly 12 tool-call events and
 * no text events, simulating the step-limit edge case.
 *
 * Observation points:
 *   1. Does the UI show the expected fallback message?
 *   2. Or does it show nothing / leave the composer in a locked state?
 *   3. What was the last visible status line? ("Searching the book...", etc.)
 *
 * Source: src/services/ai/adapters/AgenticChatAdapter.ts (stream drain +
 *         fallback synthesis), src/services/ai/route.ts MAX_AGENT_STEPS const.
 */

const BOOK_HASH = '65c789be32848655bc89109cb69cc712';

// 12 tool-call events, no text events — mirrors hitting MAX_AGENT_STEPS exactly.
const STEP_LIMIT_NDJSON = [
  JSON.stringify({ type: 'tool-call', toolName: 'search_content' }),
  JSON.stringify({ type: 'tool-call', toolName: 'read_passage' }),
  JSON.stringify({ type: 'tool-call', toolName: 'search_content' }),
  JSON.stringify({ type: 'tool-call', toolName: 'read_chapter' }),
  JSON.stringify({ type: 'tool-call', toolName: 'search_content' }),
  JSON.stringify({ type: 'tool-call', toolName: 'read_passage' }),
  JSON.stringify({ type: 'tool-call', toolName: 'search_content' }),
  JSON.stringify({ type: 'tool-call', toolName: 'read_chapter' }),
  JSON.stringify({ type: 'tool-call', toolName: 'search_content' }),
  JSON.stringify({ type: 'tool-call', toolName: 'read_passage' }),
  JSON.stringify({ type: 'tool-call', toolName: 'search_content' }),
  JSON.stringify({ type: 'tool-call', toolName: 'read_chapter' }),
].join('\n');

const QUERY = 'What is the secret of the universe? Search as many times as needed.';

test('B8 — UI shows fallback message when agent exhausts 12 tool calls with no text', async ({
  authenticatedPage: page,
}) => {
  test.setTimeout(180_000);

  // Intercept the agentic-chat endpoint and return 12 tool-call events with no
  // text events, simulating the MAX_AGENT_STEPS exhaustion path.
  await page.route('**/api/ai/agentic-chat', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/x-ndjson',
      body: STEP_LIMIT_NDJSON,
    });
  });

  const inlineInput = await navigateToBookReader(page, BOOK_HASH);

  await inlineInput.click();
  await inlineInput.fill(QUERY);
  await inlineInput.press('Enter');

  // Wait for the UI to settle after the instant mock response. The adapter may
  // debounce or schedule fallback synthesis asynchronously.
  let uiText = '';
  let lastStatusVisible = '';

  // Poll until the response area contains some assistant text, or time out.
  try {
    await expect
      .poll(
        async () => {
          uiText = await page.evaluate(() => document.body.innerText ?? '');

          // Capture any status label currently visible on screen
          const statusMatch = uiText.match(
            /Searching the book\.\.\.|Reading passage\.\.\.|Reading chapter\.\.\.|Thinking\.\.\./,
          );
          if (statusMatch) lastStatusVisible = statusMatch[0];

          // Return the length of the longest candidate response text so the
          // poll can decide when to stop waiting.
          return page.evaluate((query: string) => {
            const candidates = Array.from(
              document.querySelectorAll('p, div[class*="message"], div[class*="Message"]'),
            );
            const responses = candidates
              .map((el) => (el as HTMLElement).innerText?.trim() ?? '')
              .filter(
                (t) =>
                  t.length > 10 &&
                  !t.startsWith(query.slice(0, 20)) &&
                  !t.includes('AI can make mistakes') &&
                  !t.startsWith('8 messages left') &&
                  !t.startsWith('Ask about this book'),
              );
            return responses.sort((a, b) => b.length - a.length)[0]?.length ?? 0;
          }, QUERY);
        },
        { timeout: 30_000, intervals: [500, 1000] },
      )
      .toBeGreaterThan(10);
  } catch {
    // Poll timed out — we still analyse whatever is on screen
  }

  // Final snapshot of the full page text
  uiText = await page.evaluate(() => document.body.innerText ?? '');

  // Determine what the page shows
  const hasFallbackMessage =
    /couldn['']?t find enough information|try rephrasing|no information/i.test(uiText);

  const hasAnyAssistantText = await page.evaluate((query: string) => {
    const candidates = Array.from(
      document.querySelectorAll('p, div[class*="message"], div[class*="Message"]'),
    );
    return candidates.some((el) => {
      const t = (el as HTMLElement).innerText?.trim() ?? '';
      return (
        t.length > 10 &&
        !t.startsWith(query.slice(0, 20)) &&
        !t.includes('AI can make mistakes') &&
        !t.startsWith('8 messages left') &&
        !t.startsWith('Ask about this book')
      );
    });
  }, QUERY);

  const composerIsVisible = await page
    .getByPlaceholder('Ask about this book...')
    .first()
    .isVisible()
    .catch(() => false);

  // Capture any status label still frozen on screen after the stream ended
  const statusOnScreen = uiText.match(
    /Searching the book\.\.\.|Reading passage\.\.\.|Reading chapter\.\.\.|Thinking\.\.\./,
  )?.[0];

  const uiIsEmpty = !hasAnyAssistantText && !hasFallbackMessage;

  const responseContext = uiText.match(/.{0,100}(couldn|rephrasing|information|sorry).{0,200}/i);

  console.log('\n===== B8 STEP COUNT LIMIT FINDINGS =====');
  console.log(`Mock: 12 tool-call events, 0 text events`);
  console.log(`Has fallback message ("couldn't find..."): ${hasFallbackMessage}`);
  console.log(`Has any assistant text: ${hasAnyAssistantText}`);
  console.log(`UI appears completely empty (no response): ${uiIsEmpty}`);
  console.log(`Last status seen during stream: ${lastStatusVisible || '(none captured)'}`);
  console.log(`Status still frozen on screen after stream: ${statusOnScreen ?? '(none)'}`);
  console.log(`Composer re-enabled after stream: ${composerIsVisible}`);
  console.log(`Fallback context: ${responseContext?.[0]?.slice(0, 400) ?? '(no match)'}`);
  console.log('=========================================\n');

  test.info().annotations.push(
    {
      type: 'finding',
      description:
        `Step-limit exhaustion (12 tool calls, 0 text events): ` +
        `hasFallback=${hasFallbackMessage}, hasAnyText=${hasAnyAssistantText}, ` +
        `composerReEnabled=${composerIsVisible}, ` +
        `statusFrozenOnScreen=${statusOnScreen ?? 'none'}`,
    },
    { type: 'B8-has-fallback', description: String(hasFallbackMessage) },
    { type: 'B8-has-any-text', description: String(hasAnyAssistantText) },
    { type: 'B8-ui-empty', description: String(uiIsEmpty) },
    { type: 'B8-status-on-screen', description: statusOnScreen ?? '(none)' },
    { type: 'B8-composer-enabled', description: String(composerIsVisible) },
    {
      type: 'B8-fallback-context',
      description: responseContext?.[0]?.slice(0, 500) ?? '(no match)',
    },
  );

  // The response area must not be completely silent. The adapter MUST emit
  // either the fallback canned message or some other text — a totally blank
  // response area after 12 tool calls is a bug (the user would see a spinner
  // or status label frozen on screen with no resolution).
  expect(hasAnyAssistantText || hasFallbackMessage).toBe(true);
});
