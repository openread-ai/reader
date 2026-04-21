/* eslint-disable react-hooks/rules-of-hooks -- Playwright fixture, not React — `use` is a teardown callback. */
import { test as base, type Page } from '@playwright/test';
import { createClient, type Session } from '@supabase/supabase-js';
import { TEST_USER, SUPABASE_CONFIG, getSupabaseProjectRef } from './test-users';

/**
 * Two localStorage writes are BOTH required — missing either breaks auth silently:
 *
 *   1. Custom keys (`token`, `refresh_token`, `user`) — AuthContext reads these
 *      directly on mount at src/context/AuthContext.tsx:26-38.
 *
 *   2. `sb-<projectRef>-auth-token` — @supabase/supabase-js reads this when
 *      refreshSession() fires on mount (AuthContext.tsx:103). Without it,
 *      refreshSession fails, syncSession(null) fires, and the keys from
 *      step 1 get wiped before first render.
 */

const SESSION_REUSE_BUFFER_MS = 5 * 60 * 1000;
const SUPABASE_STORAGE_KEY = `sb-${getSupabaseProjectRef()}-auth-token`;

let cachedSession: Session | null = null;

export async function getTestSession(): Promise<Session> {
  if (cachedSession?.expires_at) {
    const msUntilExpiry = cachedSession.expires_at * 1000 - Date.now();
    if (msUntilExpiry > SESSION_REUSE_BUFFER_MS) {
      return cachedSession;
    }
  }

  const supabase = createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  const { data, error } = await supabase.auth.signInWithPassword({
    email: TEST_USER.email,
    password: TEST_USER.password,
  });

  if (error) {
    throw new Error(
      `Failed to sign in as test user ${TEST_USER.email}: ${error.message}\n` +
        `Verify TEST_USER_EMAIL and TEST_USER_PASSWORD in .env.test.local.`,
    );
  }
  if (!data.session) {
    throw new Error(`signInWithPassword returned no session for ${TEST_USER.email}`);
  }

  cachedSession = data.session;
  return cachedSession;
}

async function injectSession(page: Page, session: Session): Promise<void> {
  await page.addInitScript(
    ({ session, supabaseStorageKey }) => {
      localStorage.setItem('token', session.access_token);
      localStorage.setItem('refresh_token', session.refresh_token);
      localStorage.setItem('user', JSON.stringify(session.user));
      localStorage.setItem(supabaseStorageKey, JSON.stringify(session));
      // Skip welcome + onboarding dialogs — they block clicks in tests.
      localStorage.setItem('has_seen_welcome', 'true');
      localStorage.setItem('openread_onboarding_completed', new Date().toISOString());
    },
    { session, supabaseStorageKey: SUPABASE_STORAGE_KEY },
  );
}

async function proxyR2Downloads(page: Page): Promise<void> {
  await page.route(/r2\.cloudflarestorage\.com/, async (route) => {
    const url = route.request().url();
    console.log(`[R2 proxy] Fetching: ${url.slice(0, 80)}...`);
    const response = await fetch(url);
    console.log(
      `[R2 proxy] Status: ${response.status}, size: ${response.headers.get('content-length')}`,
    );
    const body = Buffer.from(await response.arrayBuffer());
    await route.fulfill({
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body,
    });
  });
}

export const test = base.extend<{ authenticatedPage: Page }>({
  authenticatedPage: async ({ page }, use) => {
    const session = await getTestSession();
    await injectSession(page, session);
    await proxyR2Downloads(page);
    await use(page);
  },
});

export { expect } from '@playwright/test';
