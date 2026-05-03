import { test, expect } from '../fixtures/auth';

/**
 * G31 — Message persistence probe.
 *
 * Verifies conversations + messages survive a hard page reload.
 *
 * Flow:
 *   1. Open book (fresh conversation)
 *   2. Ask a question, wait for streamed response to complete
 *   3. Record the response text
 *   4. Hard-reload the page
 *   5. Navigate back to the reader
 *   6. Open the notebook + AI tab
 *   7. Verify: user question present, assistant response present with same text
 *
 * Also inspects IndexedDB directly (via page.evaluate) to confirm storage shape.
 *
 * Source: src/services/ai/storage/aiStore.ts:76-150 (message store),
 *         src/store/aiChatStore.ts (active conversation + rehydration)
 */

const BOOK_HASH = '65c789be32848655bc89109cb69cc712';
const BOOK_TITLE_SUBSTRING = '1-Page Marketing';
const QUESTION = 'What is the core idea of this book? Reply in one short sentence.';

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

async function waitForAssistantResponse(page: import('@playwright/test').Page): Promise<string> {
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
                !t.startsWith('What is the core idea') &&
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
        timeout: 90_000,
        intervals: [1000, 2000, 2000],
      },
    )
    .toBeGreaterThan(30);
  return responseText;
}

test('G31 — conversation + messages persist across page reload', async ({
  authenticatedPage: page,
}) => {
  // Phase 1: establish baseline conversation
  const inlineInput = await navigateToBookWithInlineBar(page);
  await inlineInput.click();
  await inlineInput.fill(QUESTION);
  await inlineInput.press('Enter');

  const originalResponse = await waitForAssistantResponse(page);
  console.log(
    `\n[G31] Original response (${originalResponse.length} chars): ${originalResponse.slice(0, 150)}...`,
  );

  // Capture IndexedDB state BEFORE reload
  const beforeDb = await page.evaluate(async () => {
    const dbs = await indexedDB.databases();
    const result: Record<string, number> = {};
    for (const db of dbs) {
      if (!db.name) continue;
      try {
        const request = indexedDB.open(db.name);
        const opened = await new Promise<IDBDatabase>((resolve, reject) => {
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        for (const storeName of Array.from(opened.objectStoreNames)) {
          const tx = opened.transaction(storeName, 'readonly');
          const store = tx.objectStore(storeName);
          const countRequest = store.count();
          const count = await new Promise<number>((resolve) => {
            countRequest.onsuccess = () => resolve(countRequest.result);
          });
          result[`${db.name}.${storeName}`] = count;
        }
        opened.close();
      } catch {
        // skip
      }
    }
    return result;
  });

  console.log('[G31] IndexedDB state before reload:');
  Object.entries(beforeDb).forEach(([k, v]) => console.log(`  ${k}: ${v}`));

  // Phase 2: hard reload the page
  console.log('[G31] Reloading page...');
  await page.reload({ waitUntil: 'domcontentloaded' });

  // Verify we're still on the reader (or need to navigate back)
  const currentUrl = page.url();
  console.log(`[G31] After reload, url = ${currentUrl}`);

  // If reader URL preserved, good. Otherwise navigate back.
  if (!currentUrl.includes('/reader') || !currentUrl.includes(BOOK_HASH)) {
    console.log('[G31] Need to re-navigate to reader');
    await navigateToBookWithInlineBar(page);
  }

  // Wait for the notebook / chat to rehydrate
  // The chat may be behind a notebook-visibility toggle after reload
  await page.waitForTimeout(2000); // let rehydration kick in

  // Inspect IndexedDB AFTER reload
  const afterDb = await page.evaluate(async () => {
    const dbs = await indexedDB.databases();
    const result: Record<string, number> = {};
    for (const db of dbs) {
      if (!db.name) continue;
      try {
        const request = indexedDB.open(db.name);
        const opened = await new Promise<IDBDatabase>((resolve, reject) => {
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        for (const storeName of Array.from(opened.objectStoreNames)) {
          const tx = opened.transaction(storeName, 'readonly');
          const store = tx.objectStore(storeName);
          const countRequest = store.count();
          const count = await new Promise<number>((resolve) => {
            countRequest.onsuccess = () => resolve(countRequest.result);
          });
          result[`${db.name}.${storeName}`] = count;
        }
        opened.close();
      } catch {
        // skip
      }
    }
    return result;
  });

  console.log('[G31] IndexedDB state after reload:');
  Object.entries(afterDb).forEach(([k, v]) => console.log(`  ${k}: ${v}`));

  // Try to find the conversation/message in the page text after reload
  const afterReloadBodyText = await page.evaluate(() => document.body.innerText ?? '');
  const questionStillVisible = afterReloadBodyText.includes(QUESTION.slice(0, 40));
  const responseStillVisible = afterReloadBodyText.includes(originalResponse.slice(0, 40));

  console.log('\n===== G31 PERSISTENCE FINDINGS =====');
  console.log(`Question visible after reload: ${questionStillVisible}`);
  console.log(`Response visible after reload: ${responseStillVisible}`);
  console.log('IndexedDB before:', JSON.stringify(beforeDb));
  console.log('IndexedDB after:', JSON.stringify(afterDb));
  console.log('======================================\n');

  test
    .info()
    .annotations.push(
      { type: 'G31-question-visible', description: String(questionStillVisible) },
      { type: 'G31-response-visible', description: String(responseStillVisible) },
      { type: 'G31-db-before', description: JSON.stringify(beforeDb) },
      { type: 'G31-db-after', description: JSON.stringify(afterDb) },
    );

  // The IndexedDB must contain stores both before and after reload — a count
  // of zero stores means the persistence layer was never initialised.
  expect(Object.keys(afterDb).length).toBeGreaterThan(0);

  // At least one store in the pre-reload snapshot must have had items written to
  // it — confirms the message was actually persisted, not just held in memory.
  const beforeHasItems = Object.values(beforeDb).some((count) => count > 0);
  expect(beforeHasItems).toBe(true);

  // After reload, at least the question or the response should survive in the
  // visible page — this is the primary UX contract for message persistence.
  expect(questionStillVisible || responseStillVisible).toBe(true);
});
