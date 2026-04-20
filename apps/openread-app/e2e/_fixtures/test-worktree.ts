// apps/openread-app/e2e/_fixtures/test-worktree.ts
//
// Ephemeral git worktree fixture for E2E tests (§3 Bundle C, C3).
//
// Spins up a throwaway worktree rooted at a new tmp dir and tracked branch,
// so tests that manipulate git state (DNM trailer checks, branch-protection
// scenarios, cleanup flows) don't dirty the caller's checkout.
//
// Teardown removes the worktree via `git worktree remove --force` and rms
// any residual files.

import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const exec = promisify(execFile);

export type TestWorktreeFixture = {
  /** Absolute path to the ephemeral worktree root. */
  path: string;
  /** The branch name checked out in the worktree. */
  branch: string;
  /**
   * Run a git command inside the worktree. Returns { stdout, stderr }.
   */
  git: (args: string[]) => Promise<{ stdout: string; stderr: string }>;
};

// Playwright parses the first parameter to detect fixture dependencies — it
// MUST be an object-destructuring pattern even when no built-in fixtures are
// consumed. See: https://playwright.dev/docs/test-fixtures#creating-a-fixture
export const testWorktreeFixture = async (
  {}: Record<string, never>,
  // Playwright's fixture callback is conventionally named `use`. We alias it
  // to `provide` to avoid eslint-plugin-react-hooks misidentifying the call
  // as React's `use()` hook (these files are pure Playwright, never React).
  provide: (value: TestWorktreeFixture) => Promise<void>,
) => {
  const parent = await mkdtemp(join(tmpdir(), 'openread-probe-wt-'));
  const path = join(parent, 'wt');
  const branch = `probe-test/${Date.now()}`;

  // TODO: this assumes CWD is inside a valid git repo. Parameterize the
  // source repo path once `scripts/config/load.ts` (F2) exposes it.
  await exec('git', ['worktree', 'add', '-b', branch, path], { cwd: process.cwd() });

  const fixture: TestWorktreeFixture = {
    path,
    branch,
    git: async (args) => {
      const { stdout, stderr } = await exec('git', args, { cwd: path });
      return { stdout, stderr };
    },
  };

  await provide(fixture);

  // Teardown — best-effort; don't fail the test if cleanup hiccups.
  try {
    await exec('git', ['worktree', 'remove', '--force', path], { cwd: process.cwd() });
  } catch {
    // ignore
  }
  await rm(parent, { recursive: true, force: true });
};
