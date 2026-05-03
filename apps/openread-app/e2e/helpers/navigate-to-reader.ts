import { expect, type Page } from '@playwright/test';

const LIBRARY_TITLE_MATCH = /1-Page Marketing/i;

/**
 * Navigate an authenticated page to the reader for a specific book, reliably.
 *
 * Why not just `page.goto('/reader?ids=...')`? The reader route depends on
 * IndexedDB having the book row written by the sync worker. On a fresh
 * Playwright context the DB starts empty, sync fires async after auth, and
 * /reader briefly renders then resolves to a no-op if the book isn't there
 * yet. The /home → click path has the same race plus a separate /home →
 * /library auto-redirect that snapshots have shown.
 *
 * So: land on /library (which natively waits for sync via useSync), verify
 * the book link is present (proves IndexedDB is populated), then click it
 * and wait for the inline question bar.
 *
 * IMPORTANT: The dev server MUST be started with NEXT_PUBLIC_APP_PLATFORM=web
 * (via .env.web). Without it, the app uses Tauri download APIs which fail in
 * headless Chromium. Use: `dotenv -e .env.web -e .env.test.local -- next dev`
 */
export async function navigateToBookReader(
  page: Page,
  bookHash: string,
): Promise<ReturnType<Page['getByPlaceholder']>> {
  await page.goto('/library');

  await expect(page.getByRole('link', { name: LIBRARY_TITLE_MATCH }).first()).toBeVisible({
    timeout: 45_000,
  });

  await page.getByRole('link', { name: LIBRARY_TITLE_MATCH }).first().click();

  await page.waitForURL(
    (url) => url.pathname.startsWith('/reader') && url.search.includes(bookHash),
    { timeout: 30_000 },
  );

  const inlineInput = page.getByPlaceholder('Ask about this book...').first();
  await expect(inlineInput).toBeVisible({ timeout: 45_000 });
  return inlineInput;
}
