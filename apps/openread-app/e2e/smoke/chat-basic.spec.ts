import { test, expect } from '../fixtures/auth';

/**
 * Full-stack smoke test: Supabase auth → library sync → reader → inline
 * question bar → notebook → real Groq LLM → streamed response render.
 *
 * InlineQuestionBar is the primary chat entry, not the sidebar — submitting
 * sets pendingQuestion, creates a conversation, opens the notebook on the AI
 * tab, and AIAssistant mounts Thread which auto-sends the pending question.
 *
 * Assertions are tolerant of real-LLM variance (length range + alpha regex,
 * never exact strings). Book: "The 1-Page Marketing Plan" by Allan Dib.
 */

const BOOK_HASH = '65c789be32848655bc89109cb69cc712';
const BOOK_TITLE_SUBSTRING = '1-Page Marketing';

test('authenticated user can open a book and get a chat response', async ({
  authenticatedPage: page,
}) => {
  // Land on /home so auth + sync hydrate before any route-guarded navigation.
  await page.goto('/home');

  await expect(
    page.getByRole('heading', { name: new RegExp(BOOK_TITLE_SUBSTRING, 'i') }).first(),
  ).toBeVisible({ timeout: 30_000 });

  const welcomeDialog = page.getByRole('dialog', { name: /welcome/i });
  if (await welcomeDialog.isVisible().catch(() => false)) {
    await welcomeDialog.getByRole('button', { name: 'Close' }).click();
    await expect(welcomeDialog).toBeHidden({ timeout: 5_000 });
  }

  // Click the book card — direct /reader URL races the route guard and
  // redirects back to /home.
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

  await inlineInput.click();
  await inlineInput.fill('What is this book about? Reply in one short sentence.');
  await inlineInput.press('Enter');

  // Poll for substantive text anywhere in the doc that isn't the echoed
  // question or known boilerplate. DOM-attribute selectors would couple us
  // to assistant-ui internals.
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
                t.length > 50 &&
                !t.startsWith('What is this book about') &&
                !t.includes('AI can make mistakes. Verify with the book') &&
                !t.startsWith('8 messages left') &&
                !t.startsWith('Ask about this book'),
            );
          return responses.sort((a, b) => b.length - a.length)[0] ?? '';
        });
        responseText = result;
        return result.length;
      },
      {
        message: 'waiting for assistant response paragraph to exceed 50 chars',
        timeout: 90_000,
        intervals: [1000, 2000, 2000],
      },
    )
    .toBeGreaterThan(50);

  expect(responseText.length).toBeLessThan(5000);
  expect(responseText).toMatch(/[a-zA-Z]{4,}/);
});
