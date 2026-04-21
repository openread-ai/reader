import { test } from '../../fixtures';
import { LibraryPage } from '../../pages/LibraryPage';

test('authenticated user lands on /library', async ({ authenticatedPage }) => {
  const library = new LibraryPage(authenticatedPage);
  await library.goto();
  await library.expectLoaded();
});
