// apps/openread-app/e2e/_fixtures/login.ts
//
// Mocked auth fixture (§3 Bundle C, C3).
//
// Bypasses Supabase Auth by seeding a deterministic JWT + session into
// localStorage/cookies before the test navigates, so scenarios can focus
// on behavior without hitting live auth infrastructure.
//
// TODO: once the production session shape stabilizes (and Supabase Auth
//       stays — per CLAUDE.md Enterprise Architecture), mirror the real
//       cookie structure (`sb-<project>-auth-token`) rather than the
//       placeholder used here.

import type { BrowserContext, Page } from '@playwright/test';

export type LoginFixture = {
  /**
   * Sign in the given test user by seeding session storage. Call
   * BEFORE navigating to a protected route.
   */
  signInAs: (user: TestUser) => Promise<void>;
  /**
   * Clear the mocked session — useful for signed-out flows mid-test.
   */
  signOut: () => Promise<void>;
};

export type TestUser = {
  id: string;
  email: string;
  displayName?: string;
  tier?: 'free' | 'reader' | 'pro' | 'max';
};

/**
 * Playwright injects `{ page, context }` as dependencies — we rely on that
 * so the fixture can reach the browser context.
 */
export const loginFixture = async (
  { page, context }: { page: Page; context: BrowserContext },
  // Playwright's fixture callback is conventionally named `use`. We alias it
  // to `provide` to avoid eslint-plugin-react-hooks misidentifying the call
  // as React's `use()` hook (these files are pure Playwright, never React).
  provide: (value: LoginFixture) => Promise<void>,
) => {
  const fixture: LoginFixture = {
    signInAs: async (user) => {
      // Seed a deterministic fake session. The app's client-side auth
      // guard reads these keys (see src/utils/supabase.ts) — overriding
      // here skips the OAuth round-trip.
      await context.addInitScript((u) => {
        const fakeToken = `probe-mock-jwt.${btoa(JSON.stringify(u))}.sig`;
        try {
          localStorage.setItem(
            'probe:mock-session',
            JSON.stringify({ user: u, access_token: fakeToken }),
          );
        } catch {
          // localStorage may not be available before navigation — caller
          // should invoke signInAs before the first page.goto().
        }
      }, user);
    },
    signOut: async () => {
      await page.evaluate(() => {
        try {
          localStorage.removeItem('probe:mock-session');
        } catch {
          // ignore
        }
      });
    },
  };

  await provide(fixture);

  // Teardown: clear any cookies we set.
  await context.clearCookies();
};
