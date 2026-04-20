// apps/openread-app/playwright.config.ts
//
// Probe-driven workflow — canonical Playwright configuration.
// Source: docs/probe-driven-workflow-implementation.md §9
//
// 5 main projects: chromium, webkit, msedge, mobile-chromium, mobile-webkit
// + ui-regression visual-regression lane (C4) as a separate Playwright project.
//
// Snapshot directory points at the local artifact bucket
// (OPENREAD_BUCKET_DIR, default ~/.openread-dev/artifacts) so baselines live
// outside the repo — see §4.2.

import { defineConfig, devices } from '@playwright/test';
import { resolve } from 'path';
import { homedir } from 'os';

const BUCKET = process.env.OPENREAD_BUCKET_DIR ?? resolve(homedir(), '.openread-dev/artifacts');

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,

  snapshotDir: `${BUCKET}/baselines`,
  snapshotPathTemplate: '{snapshotDir}/{testFileName}/{arg}-{projectName}{ext}',

  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    video: 'retain-on-failure',
    // Diff output path is controlled by snapshotPathTemplate above, not by
    // the screenshot option (which in recent @playwright/test no longer
    // accepts a `path` field on the object form). Per-project snapshot
    // directories land under {snapshotDir}/{testFileName}/.
    screenshot: 'only-on-failure',
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } }, // macOS Safari desktop
    {
      name: 'msedge',
      use: { ...devices['Desktop Edge'], channel: 'msedge' },
    },
    { name: 'mobile-chromium', use: { ...devices['Pixel 8'] } }, // Android
    { name: 'mobile-webkit', use: { ...devices['iPhone 15 Pro'] } }, // iOS / iPadOS
    // Visual regression lane (separate project, run from its own command)
    {
      name: 'ui-regression',
      testDir: './e2e/ui',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
      },
    },
  ],
});
