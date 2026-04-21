// apps/openread-app/e2e/pages/ReaderPage.ts
//
// Page Object for /reader. No own `goto()` — callers must arrive via
// LibraryPage because /reader depends on IndexedDB being populated by the
// library sync worker.

import { type Locator } from '@playwright/test';
import { BasePage } from './BasePage';

export class ReaderPage extends BasePage {
  inlineQuestionBar(): Locator {
    return this.page.getByPlaceholder('Ask about this book...').first();
  }

  async waitForReaderUrl(): Promise<void> {
    await this.page.waitForURL(
      (url) => url.pathname.startsWith('/reader') && url.search.includes('ids='),
      { timeout: 30_000 },
    );
  }
}
