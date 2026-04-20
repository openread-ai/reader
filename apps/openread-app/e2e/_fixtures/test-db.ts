// apps/openread-app/e2e/_fixtures/test-db.ts
//
// Ephemeral SQLite state-db fixture for E2E tests (§3 Bundle C, C3).
//
// Each test gets an isolated SQLite file under the OS temp dir; teardown
// removes it. The DB is seeded from the canonical `0001-initial.sql`
// migration under `.claude/state-schema/` (created by Bundle F).
//
// TODO (post-F1): pull migration SQL from `.claude/state-schema/0001-initial.sql`
//                 and apply via the conductor-api migrations runner (F2) rather
//                 than raw `.exec(fs.readFileSync(...))`.

import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

export type TestDbFixture = {
  /** Absolute path to the ephemeral SQLite file. */
  path: string;
  /**
   * Open a connection. The caller is responsible for closing it.
   * Returns `unknown` so this fixture stays dependency-free until
   * `better-sqlite3` is added by Bundle F (see §4.1).
   */
  connect: () => Promise<unknown>;
};

// Playwright parses the first parameter to detect fixture dependencies — it
// MUST be an object-destructuring pattern even when no built-in fixtures are
// consumed. See: https://playwright.dev/docs/test-fixtures#creating-a-fixture
export const testDbFixture = async (
  {}: Record<string, never>,
  // Playwright's fixture callback is conventionally named `use`. We alias it
  // to `provide` to avoid eslint-plugin-react-hooks misidentifying the call
  // as React's `use()` hook (these files are pure Playwright, never React).
  provide: (value: TestDbFixture) => Promise<void>,
) => {
  const dir = await mkdtemp(join(tmpdir(), 'openread-probe-state-'));
  const path = join(dir, 'state.db');

  const fixture: TestDbFixture = {
    path,
    connect: async () => {
      // TODO(F2): replace with `new Database(path)` from better-sqlite3
      //           and apply 0001-initial.sql via the migrations runner.
      throw new Error('test-db.connect() is a stub — wire to better-sqlite3 once Bundle F lands');
    },
  };

  await provide(fixture);

  // Teardown: remove the temp directory tree.
  await rm(dir, { recursive: true, force: true });
};
