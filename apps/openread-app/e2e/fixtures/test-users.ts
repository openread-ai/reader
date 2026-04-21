// Test user credentials loaded from .env.test.local — see e2e/README.md.
// Validates at module load so tests fail fast with a clear error.

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `E2E test env var ${name} is missing.\n` +
        `Add it to apps/openread-app/.env.test.local and retry.\n` +
        `See apps/openread-app/e2e/README.md for the full list.`,
    );
  }
  return value;
}

export const TEST_USER = {
  email: requireEnv('TEST_USER_EMAIL'),
  password: requireEnv('TEST_USER_PASSWORD'),
} as const;

export const SUPABASE_CONFIG = {
  url: requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
  anonKey: requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
} as const;

// e.g. `https://qxnavppqosndhfgitdsi.supabase.co` → `qxnavppqosndhfgitdsi`
// Used to build the `sb-<ref>-auth-token` key @supabase/supabase-js reads.
export function getSupabaseProjectRef(): string {
  const hostname = new URL(SUPABASE_CONFIG.url).hostname;
  const ref = hostname.split('.')[0];
  if (!ref) {
    throw new Error(`Could not derive project ref from ${SUPABASE_CONFIG.url}`);
  }
  return ref;
}
