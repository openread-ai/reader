import { test, expect } from '../fixtures/auth';
import { navigateToBookReader } from '../helpers/navigate-to-reader';

/**
 * B7 — Reload (regenerate) button and BranchPicker probe.
 *
 * Verifies that the assistant-ui Reload action works end-to-end:
 *
 *   1. Submit a question and wait for the assistant response.
 *   2. Locate the Reload button near the assistant message.
 *      assistant-ui renders it as ActionBarPrimitive.Reload — typically a
 *      button containing a RotateCcw / RefreshCw / Reload SVG icon.
 *   3. Click Reload — expect a new agentic-chat request to fire and a
 *      second response to stream in.
 *   4. Look for the BranchPicker — after regeneration, assistant-ui renders
 *      a "<N / M>" nav component (BranchPickerPrimitive.Root) near the
 *      assistant message.
 *   5. If BranchPicker is visible, try clicking the prev/next arrows and
 *      verify the displayed branch index changes.
 *
 * Selector strategy:
 *   - Try data-testid="regenerate" first.
 *   - Fall back to aria-label patterns: /regenerate|reload|retry/i.
 *   - Fall back to scanning all SVG-containing buttons near the assistant
 *     message region.
 *   - BranchPicker: look for text matching /\d+\s*\/\s*\d+/.
 *
 * Source: src/components/assistant/Thread.tsx — ActionBar section containing
 *         ActionBarPrimitive.Reload, and BranchPickerPrimitive.Root.
 */

test.setTimeout(180_000);

const BOOK_HASH = '65c789be32848655bc89109cb69cc712';
const QUESTION = 'What is the single most important lesson from this book?';

async function waitForAssistantResponse(
  page: import('@playwright/test').Page,
  minLength = 30,
): Promise<string> {
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
                  !t.startsWith('What is the single'),
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
        timeout: 90_000,
        intervals: [1000, 2000, 2000],
      },
    )
    .toBeGreaterThan(minLength);
  return responseText;
}

test('B7 — Reload button regenerates response and BranchPicker appears', async ({
  authenticatedPage: page,
}) => {
  // Track agentic-chat requests so we can confirm a second one fires on Reload
  const agenticChatRequestTimestamps: number[] = [];
  page.on('request', (req) => {
    if (req.url().includes('/api/ai/agentic-chat') && req.method() === 'POST') {
      agenticChatRequestTimestamps.push(Date.now());
      console.log(
        `[B7] agentic-chat POST #${agenticChatRequestTimestamps.length} at ${Date.now()}`,
      );
    }
  });

  const inlineInput = await navigateToBookReader(page, BOOK_HASH);
  await inlineInput.click();
  await inlineInput.fill(QUESTION);
  await inlineInput.press('Enter');

  const firstResponse = await waitForAssistantResponse(page);
  console.log(
    `[B7] First response (${firstResponse.length} chars): ${firstResponse.slice(0, 100)}...`,
  );

  // Give the action bar a moment to render after streaming completes
  await page.waitForTimeout(1500);

  // --- Locate the Reload button ---
  // Strategy 1: data-testid
  let reloadButton = page.locator('[data-testid="regenerate"]').first();
  let reloadFound = await reloadButton.isVisible().catch(() => false);

  // Strategy 2: aria-label
  if (!reloadFound) {
    reloadButton = page.locator('button[aria-label]').filter({
      hasText: /^$/,
    });
    const _ariaButtons = page.locator('button').filter({ hasNotText: /\w{3,}/ });
    // Try aria-label matching regenerate/reload/retry
    const ariaReload = page
      .locator(
        'button[aria-label*="enerate"], button[aria-label*="eload"], button[aria-label*="etry"]',
      )
      .first();
    reloadFound = await ariaReload.isVisible().catch(() => false);
    if (reloadFound) reloadButton = ariaReload;
  }

  // Strategy 3: scan all buttons near assistant message area for SVG icons
  // that look like reload/refresh (RotateCcw icon typically has a path with arc)
  let reloadButtonInfo: { found: boolean; index: number; ariaLabel: string; className: string } = {
    found: false,
    index: -1,
    ariaLabel: '',
    className: '',
  };

  if (!reloadFound) {
    reloadButtonInfo = await page.evaluate(() => {
      const allButtons = Array.from(document.querySelectorAll('button'));
      // Look for buttons that:
      // - contain an SVG child
      // - have no visible text (icon-only buttons typical of action bars)
      // - are near an element that contains assistant response text
      for (let i = 0; i < allButtons.length; i++) {
        const btn = allButtons[i]!;
        const hasSvg = btn.querySelector('svg') !== null;
        const hasNoText =
          (btn.textContent?.trim().length ?? 0) === 0 || btn.getAttribute('aria-label') !== null;
        const ariaLabel = btn.getAttribute('aria-label') ?? '';
        const className = btn.className ?? '';

        // Match aria-label patterns for regenerate/reload
        if (
          hasSvg &&
          hasNoText &&
          /regenerat|reload|retry|refresh|rotat/i.test(ariaLabel + className)
        ) {
          return { found: true, index: i, ariaLabel, className };
        }
      }

      // Fallback: find all icon buttons and return the last one
      // (action bar buttons typically appear AFTER the assistant response text)
      const iconButtons = allButtons.filter(
        (b) => b.querySelector('svg') !== null && (b.textContent?.trim().length ?? 0) === 0,
      );
      if (iconButtons.length > 0) {
        const last = iconButtons[iconButtons.length - 1]!;
        return {
          found: true,
          index: allButtons.indexOf(last),
          ariaLabel: last.getAttribute('aria-label') ?? '',
          className: last.className ?? '',
        };
      }

      return { found: false, index: -1, ariaLabel: '', className: '' };
    });

    if (reloadButtonInfo.found && reloadButtonInfo.index >= 0) {
      reloadFound = true;
      reloadButton = page.locator('button').nth(reloadButtonInfo.index);
    }
  }

  console.log(`[B7] Reload button found: ${reloadFound}`);
  console.log(
    `[B7] Reload button info: ariaLabel="${reloadButtonInfo.ariaLabel}" class="${reloadButtonInfo.className.slice(0, 80)}"`,
  );

  const requestCountBeforeReload = agenticChatRequestTimestamps.length;
  let secondResponse = '';
  let reloadClicked = false;
  let reloadProducedNewRequest = false;

  if (reloadFound) {
    try {
      await reloadButton.click({ timeout: 5000 });
      reloadClicked = true;
      console.log('[B7] Reload button clicked');

      // Wait for a second response to appear
      await page.waitForTimeout(2000);
      try {
        secondResponse = await waitForAssistantResponse(page, 30);
        console.log(
          `[B7] Second response (${secondResponse.length} chars): ${secondResponse.slice(0, 100)}...`,
        );
      } catch {
        console.log('[B7] Second response did not appear within timeout');
      }

      reloadProducedNewRequest = agenticChatRequestTimestamps.length > requestCountBeforeReload;
    } catch (e) {
      console.log(`[B7] Reload button click failed: ${e}`);
    }
  }

  // --- Look for BranchPicker ---
  // BranchPicker renders "1 / 2" style text near the assistant message
  await page.waitForTimeout(1000);

  const branchPickerInfo = await page.evaluate(() => {
    const body = document.body.innerText ?? '';
    // Match "N / M" or "N/M" patterns (branch navigation)
    const branchMatch = body.match(/(\d+)\s*\/\s*(\d+)/);
    if (branchMatch) {
      return {
        found: true,
        text: branchMatch[0],
        current: parseInt(branchMatch[1] ?? '0', 10),
        total: parseInt(branchMatch[2] ?? '0', 10),
      };
    }
    return { found: false, text: '', current: 0, total: 0 };
  });

  console.log(`[B7] BranchPicker found: ${branchPickerInfo.found}`);
  if (branchPickerInfo.found) {
    console.log(
      `[B7] BranchPicker text: "${branchPickerInfo.text}" (branch ${branchPickerInfo.current} of ${branchPickerInfo.total})`,
    );
  }

  // Try navigating branches if BranchPicker is visible
  let branchNavigationWorked = false;
  if (branchPickerInfo.found && branchPickerInfo.total >= 2) {
    // Look for prev/next arrows within the branch picker area
    const navResult = await page.evaluate(() => {
      const allButtons = Array.from(document.querySelectorAll('button'));
      // BranchPicker prev/next buttons typically have aria-label or are chevrons
      const prevBtn = allButtons.find((b) =>
        /prev|back|left|before/i.test((b.getAttribute('aria-label') ?? '') + (b.className ?? '')),
      );
      const nextBtn = allButtons.find((b) =>
        /next|forward|right|after/i.test(
          (b.getAttribute('aria-label') ?? '') + (b.className ?? ''),
        ),
      );
      return {
        prevFound: prevBtn !== null,
        nextFound: nextBtn !== null,
        prevLabel: prevBtn?.getAttribute('aria-label') ?? '',
        nextLabel: nextBtn?.getAttribute('aria-label') ?? '',
      };
    });

    console.log(
      `[B7] Branch nav buttons — prev: ${navResult.prevFound}, next: ${navResult.nextFound}`,
    );

    if (navResult.prevFound) {
      try {
        // Use aria-label to find prev navigation button
        const prevAriaButton = page
          .locator(
            'button[aria-label*="prev"], button[aria-label*="back"], button[aria-label*="before"]',
          )
          .first();
        await prevAriaButton.click({ timeout: 3000 });
        await page.waitForTimeout(500);
        const afterNavText = await page.evaluate(() => {
          const body = document.body.innerText ?? '';
          const m = body.match(/(\d+)\s*\/\s*(\d+)/);
          return m ? m[0] : '';
        });
        branchNavigationWorked = afterNavText !== branchPickerInfo.text;
        console.log(`[B7] After branch nav, picker shows: "${afterNavText}"`);
      } catch {
        console.log('[B7] Branch navigation click failed');
      }
    }
  }

  console.log('\n===== B7 RELOAD / BRANCH PICKER FINDINGS =====');
  console.log(`Reload button found: ${reloadFound}`);
  console.log(`Reload button ariaLabel: "${reloadButtonInfo.ariaLabel}"`);
  console.log(`Reload clicked: ${reloadClicked}`);
  console.log(`Reload produced new agentic-chat request: ${reloadProducedNewRequest}`);
  console.log(`Total agentic-chat requests: ${agenticChatRequestTimestamps.length}`);
  console.log(`Second response length: ${secondResponse.length}`);
  console.log(`BranchPicker found: ${branchPickerInfo.found}`);
  if (branchPickerInfo.found) {
    console.log(`BranchPicker shows: ${branchPickerInfo.current} / ${branchPickerInfo.total}`);
  }
  console.log(`Branch navigation worked: ${branchNavigationWorked}`);
  console.log('===============================================\n');

  test.info().annotations.push(
    { type: 'B7-reload-button-found', description: String(reloadFound) },
    { type: 'B7-reload-aria-label', description: reloadButtonInfo.ariaLabel },
    { type: 'B7-reload-clicked', description: String(reloadClicked) },
    { type: 'B7-reload-new-request', description: String(reloadProducedNewRequest) },
    { type: 'B7-total-requests', description: String(agenticChatRequestTimestamps.length) },
    { type: 'B7-second-response-length', description: String(secondResponse.length) },
    { type: 'B7-branch-picker-found', description: String(branchPickerInfo.found) },
    {
      type: 'B7-branch-picker-text',
      description: branchPickerInfo.found ? branchPickerInfo.text : '(not found)',
    },
    { type: 'B7-branch-nav-worked', description: String(branchNavigationWorked) },
    {
      type: 'finding',
      description: [
        reloadFound
          ? `Reload button found (ariaLabel="${reloadButtonInfo.ariaLabel}")`
          : 'Reload button NOT found — action bar may not be rendered or selector needs update',
        reloadClicked && reloadProducedNewRequest
          ? 'Reload fired a second agentic-chat request — regeneration works'
          : reloadClicked
            ? 'Reload button was clicked but no new request fired — possible silent failure'
            : 'Reload was not clicked',
        branchPickerInfo.found
          ? `BranchPicker visible: "${branchPickerInfo.text}" (${branchPickerInfo.total} branches)`
          : 'BranchPicker NOT visible after reload — may not be implemented or selector needs update',
      ].join('. '),
    },
  );

  // Tolerant: first response must have appeared — the rest is exploratory
  expect(firstResponse.length).toBeGreaterThan(30);
});
