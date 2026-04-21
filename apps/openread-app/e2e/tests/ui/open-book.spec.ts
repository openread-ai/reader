// Requires the test account (TEST_USER_EMAIL) to have at least one book
// in its Supabase library — an empty account fails with a timeout on the
// book-link wait. See e2e/README.md for the seed/check procedure.

import { test, expect } from '../../fixtures';
import { LibraryPage } from '../../pages/LibraryPage';
import { ReaderPage } from '../../pages/ReaderPage';

test('user opens a book and reader renders with inline question bar', async ({
  authenticatedPage,
}) => {
  const library = new LibraryPage(authenticatedPage);
  const reader = new ReaderPage(authenticatedPage);

  await library.goto();
  await library.expectBooksVisible();
  await library.clickFirstBook();

  await reader.waitForReaderUrl();
  await expect(reader.inlineQuestionBar()).toBeVisible({ timeout: 45_000 });
});
