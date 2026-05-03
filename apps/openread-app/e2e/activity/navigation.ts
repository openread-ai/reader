import { expect, type Page } from '@playwright/test';
import { LibraryPage } from '../pages/LibraryPage';
import { ReaderPage } from '../pages/ReaderPage';

export type ActivityFixtureMode = 'anonymous' | 'authenticated';

export type ActivityTarget = {
  route: string;
  screen: string;
};

/**
 * Reusable activity navigation entrypoint. Keep screen-state setup here so every
 * agent and capture/validation spec reaches the same UI state the same way.
 */
export async function navigateToActivityTarget(page: Page, target: ActivityTarget): Promise<void> {
  if (target.screen === 'reader') {
    await navigateToReaderWithAnyBook(page);
    return;
  }

  await page.goto(target.route, { waitUntil: 'networkidle' });
}

export async function navigateToReaderWithAnyBook(page: Page): Promise<void> {
  const library = new LibraryPage(page);
  const reader = new ReaderPage(page);

  await library.goto();
  await library.expectBooksVisible();
  await library.clickFirstBook();
  await reader.waitForReaderUrl();
  await expect(page.getByTestId('reader-content-ready')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('reader-loading')).toHaveCount(0, { timeout: 15_000 });
  await expect(page.getByText(/Unable to open book/i)).toHaveCount(0);
  await expect(reader.inlineQuestionBar()).toBeVisible({ timeout: 15_000 });
}
