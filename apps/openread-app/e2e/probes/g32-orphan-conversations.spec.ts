import { test, expect } from '../fixtures/auth';
import { navigateToBookReader } from '../helpers/navigate-to-reader';

/**
 * G32 — Orphan conversations probe.
 *
 * Tests whether InlineQuestionBar creates a NEW conversation on every submit
 * instead of appending to the existing one. The expected behaviour is that
 * a second submit after a page reload should reuse (or cleanly replace) the
 * previous conversation, not accumulate independent conversations in IndexedDB.
 *
 * Bug hypothesis:
 *   InlineQuestionBar calls useAIChatStore.newConversation() on every submit
 *   without first checking whether an active conversation already exists for
 *   this book. After a reload the store rehydrates but the inline bar still
 *   fires newConversation() on first submit → orphan accumulation.
 *
 * Flow:
 *   1. Navigate to book reader, verify inline bar is visible
 *   2. Submit question 1 ("What is this book about?")
 *   3. Wait for assistant response
 *   4. Count conversations in IndexedDB
 *   5. Hard-reload + re-navigate
 *   6. Submit question 2 ("Who is the author?")
 *   7. Wait for assistant response
 *   8. Count conversations in IndexedDB again
 *   9. Annotate findings — count 1→2 confirms orphan creation
 *
 * Source: src/store/aiChatStore.ts (newConversation, activeConversationId)
 *         src/components/assistant/InlineQuestionBar.tsx (submit handler)
 *         src/services/ai/storage/aiStore.ts (IndexedDB conversations store)
 */

test.setTimeout(180_000);

const BOOK_HASH = '65c789be32848655bc89109cb69cc712';

async function countConversationsInIndexedDB(page: import('@playwright/test').Page): Promise<{
  count: number;
  dbName: string;
  allDbs: string[];
}> {
  return page.evaluate(async () => {
    // First discover all IndexedDB databases matching /ai|chat/ pattern
    let availableDbs: string[] = [];
    try {
      const dbs = await indexedDB.databases();
      availableDbs = dbs.map((d) => d.name ?? '').filter(Boolean);
    } catch {
      // indexedDB.databases() not available in all browsers — fall through
    }

    const aiDbNames = availableDbs.filter((name) => /ai|chat/i.test(name));

    // If no matching DBs found, try the known name directly
    const dbNamesToTry = aiDbNames.length > 0 ? aiDbNames : ['openread-ai', 'ai-chat', 'chat'];

    for (const dbName of dbNamesToTry) {
      try {
        const count = await new Promise<number>((resolve, reject) => {
          const req = indexedDB.open(dbName);
          req.onerror = () => reject(req.error);
          req.onsuccess = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains('conversations')) {
              db.close();
              resolve(-1); // -1 = DB exists but no conversations store
              return;
            }
            const tx = db.transaction('conversations', 'readonly');
            const store = tx.objectStore('conversations');
            const countReq = store.count();
            countReq.onsuccess = () => {
              db.close();
              resolve(countReq.result);
            };
            countReq.onerror = () => {
              db.close();
              reject(countReq.error);
            };
          };
        });
        if (count >= 0) {
          return { count, dbName, allDbs: availableDbs };
        }
      } catch {
        // try next db name
      }
    }

    // Fallback: scan all discovered DBs for a conversations store
    for (const dbName of availableDbs) {
      try {
        const count = await new Promise<number>((resolve, reject) => {
          const req = indexedDB.open(dbName);
          req.onerror = () => reject(req.error);
          req.onsuccess = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains('conversations')) {
              db.close();
              resolve(-1);
              return;
            }
            const tx = db.transaction('conversations', 'readonly');
            const store = tx.objectStore('conversations');
            const countReq = store.count();
            countReq.onsuccess = () => {
              db.close();
              resolve(countReq.result);
            };
            countReq.onerror = () => {
              db.close();
              reject(countReq.error);
            };
          };
        });
        if (count >= 0) {
          return { count, dbName, allDbs: availableDbs };
        }
      } catch {
        // skip
      }
    }

    return { count: 0, dbName: '(none found)', allDbs: availableDbs };
  });
}

async function waitForAssistantResponse(
  page: import('@playwright/test').Page,
  excludePrefix: string,
): Promise<string> {
  let responseText = '';
  await expect
    .poll(
      async () => {
        try {
          const result = await page.evaluate(
            ({ excludePrefix }) => {
              const candidates = Array.from(
                document.querySelectorAll('p, div[class*="message"], div[class*="Message"]'),
              );
              const responses = candidates
                .map((el) => (el as HTMLElement).innerText?.trim() ?? '')
                .filter(
                  (t) =>
                    t.length > 30 &&
                    !t.startsWith(excludePrefix) &&
                    !t.includes('AI can make mistakes') &&
                    !t.startsWith('8 messages left') &&
                    !t.startsWith('Ask about this book'),
                );
              return responses.sort((a, b) => b.length - a.length)[0] ?? '';
            },
            { excludePrefix: excludePrefix.slice(0, 20) },
          );
          responseText = result;
          return result.length;
        } catch {
          return 0;
        }
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

test('G32 — InlineQuestionBar orphan-conversation audit', async ({ authenticatedPage: page }) => {
  // Phase 1 — First question
  const inlineInput1 = await navigateToBookReader(page, BOOK_HASH);

  const question1 = 'What is this book about?';
  await inlineInput1.click();
  await inlineInput1.fill(question1);
  await inlineInput1.press('Enter');

  const response1 = await waitForAssistantResponse(page, question1);
  console.log(`[G32] Response 1 (${response1.length} chars): ${response1.slice(0, 100)}...`);

  // Count conversations after first submit
  const dbState1 = await countConversationsInIndexedDB(page);
  console.log(`[G32] After Q1 — DB="${dbState1.dbName}" conversations=${dbState1.count}`);
  console.log(`[G32] All discovered DBs: [${dbState1.allDbs.join(', ')}]`);

  // Phase 2 — Hard reload
  console.log('[G32] Hard-reloading page...');
  await page.reload({ waitUntil: 'domcontentloaded' });

  // Re-navigate to reader (reload may have left us on reader URL but with empty state)
  const inlineInput2 = await navigateToBookReader(page, BOOK_HASH);

  // Second question
  const question2 = 'Who is the author?';
  await inlineInput2.click();
  await inlineInput2.fill(question2);
  await inlineInput2.press('Enter');

  const response2 = await waitForAssistantResponse(page, question2);
  console.log(`[G32] Response 2 (${response2.length} chars): ${response2.slice(0, 100)}...`);

  // Count conversations after second submit
  const dbState2 = await countConversationsInIndexedDB(page);
  console.log(`[G32] After Q2 — DB="${dbState2.dbName}" conversations=${dbState2.count}`);

  // Determine whether orphan bug is present
  const orphanBugConfirmed = dbState1.count === 1 && dbState2.count === 2;
  const countGrew = dbState2.count > dbState1.count;

  console.log('\n===== G32 ORPHAN CONVERSATION FINDINGS =====');
  console.log(`DB name used: ${dbState2.dbName}`);
  console.log(`All discovered DBs: [${dbState2.allDbs.join(', ')}]`);
  console.log(`Conversations after Q1: ${dbState1.count}`);
  console.log(`Conversations after Q2: ${dbState2.count}`);
  console.log(`Count grew between submits: ${countGrew}`);
  console.log(
    `Orphan bug confirmed (1→2): ${orphanBugConfirmed}`,
    orphanBugConfirmed
      ? '← BUG: each submit creates a new conversation'
      : '← behaviour varies from expected orphan pattern',
  );
  console.log('=============================================\n');

  test.info().annotations.push(
    { type: 'G32-db-name', description: dbState2.dbName },
    { type: 'G32-all-dbs', description: dbState2.allDbs.join(', ') },
    { type: 'G32-conv-count-after-q1', description: String(dbState1.count) },
    { type: 'G32-conv-count-after-q2', description: String(dbState2.count) },
    { type: 'G32-count-grew', description: String(countGrew) },
    {
      type: 'finding',
      description: orphanBugConfirmed
        ? 'ORPHAN BUG CONFIRMED: InlineQuestionBar creates a new conversation on each submit (count went from 1 to 2 across reload)'
        : `Conversation count: ${dbState1.count} → ${dbState2.count}. ${countGrew ? 'Count grew (possible orphan accumulation).' : 'Count stable (no orphan on this run).'}`,
    },
  );

  // Tolerant: both AI responses must be substantive — proves the probe ran end-to-end
  expect(response1.length).toBeGreaterThan(30);
  expect(response2.length).toBeGreaterThan(30);
});
