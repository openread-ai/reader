// apps/openread-app/e2e/_fixtures/make-book.ts
//
// Factory fixture that creates a test book in local state (§3 Bundle C, C3).
//
// Scenarios that need a book in the library (reader tests, sync tests,
// cover-render tests) call `makeBook()` — returns a deterministic Book
// record and inserts it into the app's local Zustand+IndexedDB layer.
//
// TODO: once `/start-dev`'s test harness (Bundle E) exposes a seeding
//       hook via window globals, switch to that rather than hitting
//       IndexedDB directly. Current impl is a stub shape.

import type { Page } from '@playwright/test';

export type MakeBookFixture = {
  /**
   * Create a book with defaults + any overrides. Returns the full record.
   */
  create: (overrides?: Partial<TestBook>) => Promise<TestBook>;
  /**
   * Remove a book by id (used for mid-test cleanup when needed).
   */
  remove: (id: string) => Promise<void>;
  /**
   * All books created during this test (tracked for teardown).
   */
  all: () => ReadonlyArray<TestBook>;
};

export type TestBook = {
  id: string;
  title: string;
  author: string;
  format: 'epub' | 'pdf' | 'mobi' | 'txt';
  filePath: string;
  addedAt: number;
  coverUrl?: string;
};

const DEFAULT: Omit<TestBook, 'id' | 'addedAt'> = {
  title: 'Probe Test Book',
  author: 'Agent C',
  format: 'epub',
  filePath: '/probe/fixtures/test.epub',
};

export const makeBookFixture = async (
  { page }: { page: Page },
  // Playwright's fixture callback is conventionally named `use`. We alias it
  // to `provide` to avoid eslint-plugin-react-hooks misidentifying the call
  // as React's `use()` hook (these files are pure Playwright, never React).
  provide: (value: MakeBookFixture) => Promise<void>,
) => {
  const created: TestBook[] = [];
  let seq = 0;

  const fixture: MakeBookFixture = {
    create: async (overrides) => {
      seq += 1;
      const book: TestBook = {
        ...DEFAULT,
        ...overrides,
        id: overrides?.id ?? `probe-book-${Date.now()}-${seq}`,
        addedAt: overrides?.addedAt ?? Date.now(),
      };

      // Inject into the app's state. Using page.evaluate keeps the
      // fixture browser-agnostic — the `window.__OPENREAD_TEST__` hook
      // will be installed by Bundle E's test harness.
      await page.evaluate((b) => {
        // TODO(E): replace with the real injection API once exposed.
        const globalAny = window as unknown as {
          __OPENREAD_TEST__?: { addBook?: (book: unknown) => void };
        };
        globalAny.__OPENREAD_TEST__?.addBook?.(b);
      }, book);

      created.push(book);
      return book;
    },
    remove: async (id) => {
      await page.evaluate((bookId) => {
        const globalAny = window as unknown as {
          __OPENREAD_TEST__?: { removeBook?: (id: string) => void };
        };
        globalAny.__OPENREAD_TEST__?.removeBook?.(bookId);
      }, id);
      const idx = created.findIndex((b) => b.id === id);
      if (idx >= 0) created.splice(idx, 1);
    },
    all: () => created.slice(),
  };

  await provide(fixture);

  // Teardown — remove anything this test created that's still present.
  for (const book of created) {
    try {
      await page.evaluate((bookId) => {
        const globalAny = window as unknown as {
          __OPENREAD_TEST__?: { removeBook?: (id: string) => void };
        };
        globalAny.__OPENREAD_TEST__?.removeBook?.(bookId);
      }, book.id);
    } catch {
      // page may already be closed — ignore.
    }
  }
};
