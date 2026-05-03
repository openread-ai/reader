// apps/openread-app/e2e/pages/LibraryPage.ts
//
// Page Object for /library.
//
// `expectLoaded()` tolerates either a populated library OR a fresh-account
// empty state — useful for auth smoke tests that only need to prove the
// page renders.
//
// `expectBooksVisible()` waits specifically for a book link to appear —
// use when the test account is known to have books and you need to act on
// one. The empty-state placeholder renders instantly while the sync pull
// takes several seconds, so a plain `.or(emptyState)` matcher can succeed
// prematurely and make book-count assertions look empty.
//
// Book links are matched by href pattern (`/reader?ids=...`) rather than
// by title, so the POM works with any seeded data.

import { expect, type Locator } from '@playwright/test';
import { BasePage } from './BasePage';

const BOOK_LINK_SELECTOR = 'a[href*="/reader?ids="]';

export class LibraryPage extends BasePage {
  async goto(): Promise<void> {
    await this.page.goto('/library', { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await this.page.waitForURL((url) => url.pathname === '/library', { timeout: 30_000 });
  }

  firstBookLink(): Locator {
    return this.page.locator(BOOK_LINK_SELECTOR).first();
  }

  emptyState(): Locator {
    return this.page.getByText(/library is empty/i);
  }

  async expectLoaded(): Promise<void> {
    await expect(this.firstBookLink().or(this.emptyState())).toBeVisible({
      timeout: 45_000,
    });
  }

  async expectBooksVisible(timeout = 60_000): Promise<void> {
    await expect(this.firstBookLink()).toBeVisible({ timeout });
  }

  async clickFirstBook(): Promise<void> {
    await this.firstBookLink().click();
  }
}
