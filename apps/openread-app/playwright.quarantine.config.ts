// apps/openread-app/playwright.quarantine.config.ts
//
// Quarantine lane config for flaky Playwright tests.
//
// Tests tagged `@quarantine` in their title run here instead of the main
// matrix. This lane runs with `continue-on-error: true` in CI (see
// `.github/workflows/pr.yml#quarantine-lane`) so flakes surface without
// blocking merges.
//
// Promotion/demotion rules (see docs/probe-driven-workflow-implementation.md
// §8.5 `testFlakeQuarantineRate`):
//   - If a main-lane test fails > 2% over rolling 100 runs, move it here
//     by adding `@quarantine` to its title.
//   - If a quarantined test passes 100% for 50 consecutive runs, promote
//     it back to the main lane by removing the tag.
//   - Tests that remain quarantined > 30 days without remediation must be
//     fixed or deleted — never left rotting.
//
// Reference: docs/probe-driven-workflow-implementation.md §3 Bundle B (B6)

import { defineConfig, devices } from '@playwright/test';
import { resolve } from 'path';
import { homedir } from 'os';

const BUCKET = process.env.OPENREAD_BUCKET_DIR ?? resolve(homedir(), '.openread-dev/artifacts');

export default defineConfig({
  testDir: './e2e',

  // Only run tests tagged @quarantine. Anything else is a no-op here.
  grep: /@quarantine/,

  // Flakes are expected in this lane — give them room.
  retries: 2,
  // Keep quarantine deterministic-ish: single worker avoids cross-test
  // interference masquerading as flake.
  workers: 1,
  fullyParallel: false,

  // Reporters keep the quarantine observable even though it doesn't block.
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report-quarantine', open: 'never' }],
    ['json', { outputFile: 'quarantine-results.json' }],
  ],

  // Baselines + diffs still go to the shared bucket so we can compare
  // against the main lane if/when a quarantined test is promoted back.
  snapshotDir: `${BUCKET}/baselines`,
  snapshotPathTemplate: '{snapshotDir}/{testFileName}/{arg}-{projectName}{ext}',

  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on',
    video: 'retain-on-failure',
    // Diff output path is controlled by snapshotPathTemplate above, not by
    // the screenshot option (which in recent @playwright/test no longer
    // accepts a `path` field on the object form).
    screenshot: 'only-on-failure',
  },

  // Same 5-project surface as the main config — a flake on iOS Safari
  // is a different bug than a flake on Chromium, and we want both
  // surfaced.
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    {
      name: 'msedge',
      use: { ...devices['Desktop Edge'], channel: 'msedge' },
    },
    { name: 'mobile-chromium', use: { ...devices['Pixel 8'] } },
    { name: 'mobile-webkit', use: { ...devices['iPhone 15 Pro'] } },
  ],
});
