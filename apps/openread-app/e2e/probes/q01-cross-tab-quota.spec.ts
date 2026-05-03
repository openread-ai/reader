import { test, expect } from '../fixtures/auth';
import { navigateToBookReader } from '../helpers/navigate-to-reader';

/**
 * Q01 — Cross-tab quota bypass probe.
 *
 * Tests whether client-side quota gating can be circumvented by opening the
 * app in multiple browser tabs simultaneously.
 *
 * The quota state lives in a Zustand store (useAIQuotaStore) which is local
 * to the JavaScript execution context of each tab — it is NOT shared via
 * SharedWorker, BroadcastChannel, or localStorage synchronisation. This means:
 *
 *   - Tab A at limit (used=100, limit=100) will block submissions in Tab A
 *   - Tab B (fresh context, used=0) will allow submissions freely
 *   - Tab B's submission does NOT update Tab A's quota counter
 *
 * This is a known architectural gap: the server enforces the true quota via
 * the Supabase `ai_usage` table, so the bypass only affects the client-side
 * early-exit gate. However:
 *   1. Users who hit the soft-limit dialog can sidestep it by opening a new tab
 *   2. The client may show a stale "X messages left" count in both tabs
 *
 * Observation points:
 *   1. Can Tab B send a request even when Tab A's store says limit is reached?
 *      (Expected: yes — the server will ultimately enforce it, but the client
 *      should ideally prevent the duplicate submission)
 *   2. Does Tab A's quota counter update when Tab B submits?
 *      (Expected: no — Zustand state is not cross-tab)
 *   3. Does the server accept Tab B's submission?
 *
 * Source: src/store/useAIQuotaStore.ts, src/services/ai/adapters/AgenticChatAdapter.ts
 *         quota check at adapter entry.
 */

const BOOK_HASH = '65c789be32848655bc89109cb69cc712';

// Zustand store key as it appears in localStorage / sessionStorage (if
// persisted). The exact key depends on the store name — we try common forms.
const QUOTA_STORE_KEYS = ['ai-quota-store', 'aiQuotaStore', 'openread-ai-quota', 'ai_quota'];

/** Read the Zustand AI quota store values from localStorage (any matching key). */
async function readQuotaFromStorage(page: import('@playwright/test').Page) {
  return page.evaluate((keys: string[]) => {
    for (const key of keys) {
      const raw = localStorage.getItem(key);
      if (raw) {
        try {
          return { key, parsed: JSON.parse(raw) };
        } catch {
          return { key, parsed: null };
        }
      }
    }
    return { key: null, parsed: null };
  }, QUOTA_STORE_KEYS);
}

/** Attempt to set the AI quota store's used/limit values via localStorage. */
async function setQuotaInStorage(
  page: import('@playwright/test').Page,
  used: number,
  limit: number,
) {
  await page.evaluate(
    ({ keys, used, limit }: { keys: string[]; used: number; limit: number }) => {
      // First try to patch an existing entry
      for (const key of keys) {
        const raw = localStorage.getItem(key);
        if (raw) {
          try {
            const parsed = JSON.parse(raw);
            // Zustand persist wraps state under 'state'
            if (parsed.state) {
              parsed.state.used = used;
              parsed.state.limit = limit;
              parsed.state.limitReached = used >= limit;
            } else {
              parsed.used = used;
              parsed.limit = limit;
              parsed.limitReached = used >= limit;
            }
            localStorage.setItem(key, JSON.stringify(parsed));
            return key;
          } catch {
            // skip
          }
        }
      }
      // If no key found, write a plausible shape under the first key
      const value = {
        state: { used, limit, limitReached: used >= limit },
        version: 0,
      };
      localStorage.setItem(keys[0]!, JSON.stringify(value));
      return keys[0];
    },
    { keys: QUOTA_STORE_KEYS, used, limit },
  );
}

test('Q01 — cross-tab quota: Tab B can bypass Tab A client-side limit', async ({
  authenticatedPage: page,
}) => {
  test.setTimeout(180_000);

  // -----------------------------------------------------------------------
  // Phase 1: Navigate Tab A (page) to the book reader and establish baseline
  // -----------------------------------------------------------------------
  await navigateToBookReader(page, BOOK_HASH);

  // Read initial quota state from Tab A's localStorage
  const initialQuotaA = await readQuotaFromStorage(page);
  console.log(`[Q01] Tab A initial quota storage key: ${initialQuotaA.key ?? '(not found)'}`);
  console.log(`[Q01] Tab A initial quota value: ${JSON.stringify(initialQuotaA.parsed)}`);

  // Set Tab A's quota to near-limit so the client-side gate would block it
  await setQuotaInStorage(page, 99, 100);
  const afterSetQuotaA = await readQuotaFromStorage(page);
  console.log(`[Q01] Tab A quota after manual set: ${JSON.stringify(afterSetQuotaA.parsed)}`);

  // -----------------------------------------------------------------------
  // Phase 2: Create Tab B in the same browser context (shares cookies but
  // NOT localStorage — each Page has its own JS heap)
  // -----------------------------------------------------------------------
  const page2 = await page.context().newPage();

  // Inject session into Tab B. Since localStorage is not automatically shared
  // between Pages even in the same context, we copy it manually via addInitScript.

  // Copy auth-related localStorage items from page1 to page2
  const storageState = await page.evaluate(() => {
    const items: Record<string, string> = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)!;
      const value = localStorage.getItem(key);
      if (value !== null) {
        items[key] = value;
      }
    }
    return items;
  });

  console.log(`[Q01] Copying ${Object.keys(storageState).length} localStorage keys to Tab B`);

  await page2.addInitScript((items: Record<string, string>) => {
    for (const [key, value] of Object.entries(items)) {
      // Skip quota-store keys so Tab B starts with a fresh quota
      if (
        key.includes('quota') ||
        key.includes('Quota') ||
        key.includes('ai-quota') ||
        key.includes('aiQuota')
      ) {
        continue;
      }
      localStorage.setItem(key, value);
    }
    // Suppress welcome / onboarding dialogs
    localStorage.setItem('has_seen_welcome', 'true');
    localStorage.setItem('openread_onboarding_completed', new Date().toISOString());
  }, storageState);

  // Track whether Tab B makes a network request to agentic-chat
  let tab2RequestMade = false;
  let tab2RequestUrl = '';
  page2.on('request', (req) => {
    if (req.url().includes('/api/ai/agentic-chat')) {
      tab2RequestMade = true;
      tab2RequestUrl = req.url();
      console.log(`[Q01] Tab B network request fired: ${req.url().slice(-60)}`);
    }
  });
  page2.on('requestfailed', (req) => {
    if (req.url().includes('/api/ai/agentic-chat')) {
      console.log(`[Q01] Tab B request FAILED: ${req.failure()?.errorText}`);
    }
  });

  // Navigate Tab B to the book reader
  let inlineInputB: ReturnType<typeof page2.getByPlaceholder> | null = null;
  try {
    inlineInputB = await navigateToBookReader(page2, BOOK_HASH);
    console.log('[Q01] Tab B navigated to reader successfully');
  } catch (e) {
    console.log(`[Q01] Tab B navigation failed: ${e}`);
  }

  // -----------------------------------------------------------------------
  // Phase 3: Verify Tab B's quota store is fresh (independent from Tab A)
  // -----------------------------------------------------------------------
  const quotaB_before = await readQuotaFromStorage(page2);
  console.log(
    `[Q01] Tab B quota before submit (should be fresh/0): ${JSON.stringify(quotaB_before.parsed)}`,
  );

  const tab2QuotaIsIndependent =
    quotaB_before.parsed === null ||
    (quotaB_before.parsed?.state?.used ?? quotaB_before.parsed?.used ?? 0) < 99;

  // -----------------------------------------------------------------------
  // Phase 4: Submit a query from Tab B — should succeed (not gated by Tab A)
  // -----------------------------------------------------------------------
  let tab2SubmitSucceeded = false;
  if (inlineInputB) {
    try {
      await inlineInputB.click();
      await inlineInputB.fill('What is this book about? One sentence.');
      await inlineInputB.press('Enter');
      console.log('[Q01] Tab B submitted query');

      // Wait briefly for a network request or UI response
      await page2.waitForTimeout(5000);

      tab2SubmitSucceeded = tab2RequestMade;
    } catch (e) {
      console.log(`[Q01] Tab B submit error: ${e}`);
    }
  } else {
    console.log('[Q01] Skipping Tab B submit — navigation failed');
  }

  // -----------------------------------------------------------------------
  // Phase 5: Check Tab A's quota after Tab B's submission
  // -----------------------------------------------------------------------
  const quotaA_after = await readQuotaFromStorage(page);
  const quotaA_usedBefore = 99; // what we set manually
  const quotaA_usedAfter = quotaA_after.parsed?.state?.used ?? quotaA_after.parsed?.used ?? null;

  const tab1QuotaUnchangedByTab2 =
    quotaA_usedAfter === null || quotaA_usedAfter === quotaA_usedBefore;

  console.log('\n===== Q01 CROSS-TAB QUOTA FINDINGS =====');
  console.log(`Tab A quota after manual set (used/limit): 99/100 (limitReached=true intended)`);
  console.log(
    `Tab B quota store independent from Tab A: ${tab2QuotaIsIndependent} (value: ${JSON.stringify(quotaB_before.parsed)})`,
  );
  console.log(
    `Tab B was able to fire the network request (bypass client gate): ${tab2SubmitSucceeded}`,
  );
  console.log(
    `Tab A quota unchanged after Tab B's submission (no cross-tab sync): ${tab1QuotaUnchangedByTab2}`,
  );
  console.log(`Tab A quota after Tab B submitted: ${JSON.stringify(quotaA_after.parsed)}`);
  console.log('=========================================\n');

  test.info().annotations.push(
    {
      type: 'finding',
      description:
        'Client-side quota is per-tab (Zustand in-memory). No cross-tab synchronization. ' +
        `Tab B (fresh quota) ${tab2SubmitSucceeded ? 'successfully bypassed' : 'could not verify bypass of'} ` +
        `Tab A client-side limit. Tab A quota ${tab1QuotaUnchangedByTab2 ? 'was NOT updated' : 'WAS updated (unexpected)'} by Tab B submission.`,
    },
    {
      type: 'Q01-tab2-quota-independent',
      description: String(tab2QuotaIsIndependent),
    },
    {
      type: 'Q01-tab2-request-made',
      description: String(tab2RequestMade),
    },
    {
      type: 'Q01-tab2-request-url',
      description: tab2RequestUrl || '(none)',
    },
    {
      type: 'Q01-tab1-quota-unchanged',
      description: String(tab1QuotaUnchangedByTab2),
    },
    {
      type: 'Q01-tab1-quota-after',
      description: JSON.stringify(quotaA_after.parsed),
    },
    {
      type: 'Q01-tab2-quota-before',
      description: JSON.stringify(quotaB_before.parsed),
    },
  );

  // Cleanup Tab B
  await page2.close().catch(() => {});

  // Tab B's quota store MUST be independent from Tab A's — if they share the
  // same in-memory state the architecture would be fundamentally broken. The
  // key observation is that the quota IS per-tab (which is the expected Zustand
  // behaviour), confirming the bypass vector exists.
  expect(tab2QuotaIsIndependent).toBe(true);

  // Tab A's quota must not have been silently updated by Tab B's activity —
  // there is no synchronisation mechanism, so it should remain at 99.
  expect(tab1QuotaUnchangedByTab2).toBe(true);
});
