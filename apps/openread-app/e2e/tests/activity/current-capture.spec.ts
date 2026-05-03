import { test, expect } from '../../fixtures';
import type { Page, TestInfo } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { navigateToActivityTarget } from '../../activity/navigation';

type CaptureArtifact = {
  project: string;
  route: string;
  selector: string;
  screenshot: string;
  viewport: { width: number; height: number } | null;
  createdAt: string;
};

const artifactDir = process.env.OPENREAD_ACTIVITY_ARTIFACT_DIR;
const route = process.env.OPENREAD_ACTIVITY_ROUTE ?? '/';
const selector = process.env.OPENREAD_ACTIVITY_SELECTOR ?? 'body';
const fixtureMode = process.env.OPENREAD_ACTIVITY_FIXTURE_MODE ?? 'anonymous';
const screen = process.env.OPENREAD_ACTIVITY_SCREEN ?? '';

test.describe('activity current-state capture', () => {
  test.skip(!artifactDir, 'OPENREAD_ACTIVITY_ARTIFACT_DIR is required');

  test('captures anonymous target', async ({ page }, testInfo) => {
    test.skip(fixtureMode !== 'anonymous', 'anonymous capture not requested');
    if (!artifactDir) throw new Error('OPENREAD_ACTIVITY_ARTIFACT_DIR is required');

    mkdirSync(artifactDir, { recursive: true });

    await page.goto(route, { waitUntil: 'networkidle' });
    await captureTarget({ page, testInfo });
  });

  test('captures authenticated target', async ({ authenticatedPage }, testInfo) => {
    test.skip(fixtureMode !== 'authenticated', 'authenticated capture not requested');
    if (!artifactDir) throw new Error('OPENREAD_ACTIVITY_ARTIFACT_DIR is required');

    mkdirSync(artifactDir, { recursive: true });

    await retryAsync(
      async () => {
        await navigateToActivityTarget(authenticatedPage, { route, screen });
      },
      { retries: 3, delayMs: 2_000 },
    );

    await captureTarget({ page: authenticatedPage, testInfo });
  });
});

async function retryAsync(
  task: () => Promise<void>,
  options: { retries: number; delayMs: number },
) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= options.retries; attempt += 1) {
    try {
      await task();
      return;
    } catch (error) {
      lastError = error;
      if (attempt < options.retries)
        await new Promise((resolve) => setTimeout(resolve, options.delayMs));
    }
  }
  throw lastError;
}

async function captureTarget({ page, testInfo }: { page: Page; testInfo: TestInfo }) {
  if (!artifactDir) throw new Error('OPENREAD_ACTIVITY_ARTIFACT_DIR is required');

  const target = page.locator(selector).first();
  await expect(target).toBeVisible();

  const projectName = testInfo.project.name;
  const screenshotPath = resolve(artifactDir, `${projectName}.png`);
  await target.screenshot({ path: screenshotPath });

  const artifact: CaptureArtifact = {
    project: projectName,
    route: page.url(),
    selector,
    screenshot: screenshotPath,
    viewport: page.viewportSize(),
    createdAt: new Date().toISOString(),
  };

  writeFileSync(
    resolve(artifactDir, `${projectName}.json`),
    `${JSON.stringify(artifact, null, 2)}\n`,
  );
}
