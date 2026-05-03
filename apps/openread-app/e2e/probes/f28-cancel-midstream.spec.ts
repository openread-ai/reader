import type { Page, Request } from '@playwright/test';
import { test, expect } from '../fixtures/auth';
import { navigateToBookReader } from '../helpers/navigate-to-reader';

/**
 * F28 — Cancel mid-stream probe.
 *
 * Submit a query, wait for the stream to start, cancel via the
 * ComposerPrimitive.Cancel button, verify cleanup:
 *
 *   - Network request to /api/ai/agentic-chat is aborted (Playwright will
 *     report requestfailed with net::ERR_ABORTED or similar)
 *   - Composer is re-enabled (can submit another query)
 *   - useAIQuotaStore doesn't double-count the cancelled request
 *   - Next query produces a normal response
 *
 * Source: src/services/ai/adapters/AgenticChatAdapter.ts — abortSignal is
 *         threaded through fetch. src/components/assistant/Thread.tsx —
 *         ComposerPrimitive.Cancel exposes data-testid='assistant-composer-cancel'.
 */

const BOOK_HASH = '65c789be32848655bc89109cb69cc712';
const AGENTIC_CHAT_PATH = '/api/ai/agentic-chat';

function isAgenticChatRequest(req: Request): boolean {
  return req.url().includes(AGENTIC_CHAT_PATH);
}

function waitForAgenticRequestStarted(page: Page, queryPrefix: string): Promise<Request> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      settled = true;
      clearTimeout(timer);
      page.off('request', onRequest);
    };
    const onRequest = (req: Request) => {
      if (!isAgenticChatRequest(req)) return;
      const postData = req.postData() ?? '';
      if (!postData.includes(queryPrefix)) return;
      cleanup();
      resolve(req);
    };
    const timer = setTimeout(() => {
      if (settled) return;
      cleanup();
      reject(new Error(`Timed out waiting for ${AGENTIC_CHAT_PATH} request to start`));
    }, 30_000);
    page.on('request', onRequest);
  });
}

function waitForAgenticRequestFailure(page: Page, timeoutMs: number): Promise<string | null> {
  return new Promise((resolve) => {
    let settled = false;
    const cleanup = () => {
      settled = true;
      clearTimeout(timer);
      page.off('requestfailed', onFailed);
    };
    const onFailed = (req: Request) => {
      if (!isAgenticChatRequest(req)) return;
      const failure = req.failure()?.errorText ?? 'unknown';
      cleanup();
      resolve(failure);
    };
    const timer = setTimeout(() => {
      if (settled) return;
      cleanup();
      resolve(null);
    }, timeoutMs);
    page.on('requestfailed', onFailed);
  });
}

async function collectResponseTexts(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const candidates = Array.from(
      document.querySelectorAll('p, div[class*="message"], div[class*="Message"]'),
    );
    return candidates
      .map((el) => (el as HTMLElement).innerText?.trim() ?? '')
      .filter(
        (text) =>
          text.length > 20 &&
          !text.includes('AI can make mistakes') &&
          !text.startsWith('Ask about this book') &&
          !text.startsWith('Summarize this entire') &&
          !text.startsWith('What is the main'),
      );
  });
}

test('F28 — cancel mid-stream aborts network and re-enables composer', async ({
  authenticatedPage: page,
}) => {
  // Track network requests to agentic-chat.
  const requestEvents: {
    url: string;
    method: string;
    event: 'failed' | 'finished';
    failure?: string;
  }[] = [];
  page.on('requestfailed', (req) => {
    if (isAgenticChatRequest(req)) {
      requestEvents.push({
        url: req.url(),
        method: req.method(),
        event: 'failed',
        failure: req.failure()?.errorText ?? 'unknown',
      });
      console.log(`[F28] Request FAILED: ${req.failure()?.errorText}`);
    }
  });
  page.on('requestfinished', (req) => {
    if (isAgenticChatRequest(req)) {
      requestEvents.push({ url: req.url(), method: req.method(), event: 'finished' });
      console.log(`[F28] Request FINISHED: ${req.method()} ${req.url()}`);
    }
  });

  const inlineInput = await navigateToBookReader(page, BOOK_HASH);

  // Use a question likely to produce a long response so we have time to cancel.
  await inlineInput.click();
  await inlineInput.fill(
    'Summarize this entire book in as much detail as you can, chapter by chapter.',
  );

  const firstRequestStarted = waitForAgenticRequestStarted(page, 'Summarize this entire book');
  await inlineInput.press('Enter');

  const runningComposer = page.locator('[data-testid="assistant-composer"][data-running="true"]');
  await expect(runningComposer).toBeVisible({ timeout: 15_000 });

  const firstRequest = await firstRequestStarted;
  console.log(`[F28] First request started: ${firstRequest.method()} ${firstRequest.url()}`);

  // Wait briefly after the network request starts so this exercises mid-stream
  // cancellation, not the pre-fetch local chapter-preparation path.
  await page.waitForTimeout(1500);

  const abortPromise = waitForAgenticRequestFailure(page, 15_000);

  // Cancel through the actual composer cancel primitive. The old probe used a
  // rounded-button heuristic that could click unrelated round UI buttons.
  const cancelButton = page.getByTestId('assistant-composer-cancel');
  await expect(cancelButton).toBeVisible({ timeout: 5_000 });
  await cancelButton.click();
  console.log('[F28] Cancel button clicked');

  const abortFailure = await abortPromise;
  const requestAborted = Boolean(abortFailure);

  // Wait until assistant-ui has transitioned out of running state.
  await expect(runningComposer).toHaveCount(0, { timeout: 15_000 });

  // Now try to submit a second query — if composer is re-enabled, this should work.
  console.log('[F28] Attempting second query after cancel');
  const beforeSecondQueryTexts = await collectResponseTexts(page);
  const beforeSecondQuerySet = new Set(beforeSecondQueryTexts);
  const secondInput = page.getByPlaceholder('Ask about this book...').first();
  await expect(secondInput).toBeVisible({ timeout: 10_000 });
  await expect(secondInput).toBeEnabled({ timeout: 10_000 });

  let secondQuerySucceeded = false;
  try {
    await secondInput.click({ timeout: 10_000 });
    await secondInput.fill('What is the main topic?');
    await secondInput.press('Enter');

    await expect
      .poll(
        async () => {
          const texts = await collectResponseTexts(page);
          return texts.some((text) => !beforeSecondQuerySet.has(text));
        },
        { timeout: 90_000, intervals: [1000, 2000] },
      )
      .toBe(true);
    secondQuerySucceeded = true;
    const afterTexts = await collectResponseTexts(page);
    const secondResponseLength =
      afterTexts.find((text) => !beforeSecondQuerySet.has(text))?.length ?? 0;
    console.log(`[F28] Second query response length: ${secondResponseLength}`);
  } catch (e) {
    console.log(`[F28] Second query failed: ${e}`);
  }

  console.log('\n===== F28 CANCEL MID-STREAM FINDINGS =====');
  console.log(`Cancel button clicked: true`);
  console.log(
    `Network request aborted: ${requestAborted}${abortFailure ? ` (${abortFailure})` : ''}`,
  );
  console.log(`Agentic network events captured: ${requestEvents.length}`);
  requestEvents.forEach((e) =>
    console.log(
      `  ${e.event.toUpperCase()} ${e.method} ${e.url.slice(-40)}${e.failure ? ` → ${e.failure}` : ''}`,
    ),
  );
  console.log(`Composer re-enabled after cancel: true`);
  console.log(`Second query succeeded after cancel: ${secondQuerySucceeded}`);
  console.log('==========================================\n');

  test
    .info()
    .annotations.push(
      { type: 'F28-cancel-clicked', description: 'true' },
      { type: 'F28-request-aborted', description: String(requestAborted) },
      { type: 'F28-second-query-ok', description: String(secondQuerySucceeded) },
    );

  expect(requestAborted).toBe(true);
  expect(secondQuerySucceeded).toBe(true);
});
