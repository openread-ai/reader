// apps/openread-app/e2e/_helpers/probe.playwright.ts
//
// Probe-driven workflow — driver facade over raw Playwright (§3 Bundle C, C2).
//
// This module is the ONLY public entry point E2E specs should import from.
// It re-exports Playwright's `test` extended with our custom fixtures
// (see ../_fixtures/index.ts) and provides high-level domain helpers that
// abstract raw Playwright calls behind stable, intent-oriented names.
//
// Rationale: if Playwright's API shifts, only this facade updates — the
// hundreds of S*.spec.ts scenarios stay untouched.

import { test as base, expect, type Page } from '@playwright/test';
import { fixtures, type ProbeFixtures } from '../_fixtures';

/**
 * Extended `test` with probe-driven-workflow fixtures bolted on.
 * Specs should:
 *   import { test, expect } from '../_helpers/probe.playwright';
 */
export const test = base.extend<ProbeFixtures>(fixtures);

export { expect };

// ---------------------------------------------------------------------------
// Domain helpers
// ---------------------------------------------------------------------------

/**
 * Simulate a keyboard key sequence against the page under test.
 * Abstracts over `page.keyboard.press` so future tweaks (debounce, IME,
 * hardware-key emulation) happen in one place.
 */
export async function simulateKeyboard(
  page: Page,
  keys: string | string[],
  options?: { delay?: number },
): Promise<void> {
  const sequence = Array.isArray(keys) ? keys : [keys];
  for (const key of sequence) {
    await page.keyboard.press(key, { delay: options?.delay });
  }
}

/**
 * Capture a baseline screenshot under the bucket snapshot directory
 * (configured in playwright.config.ts — see §9). The baseline's filename
 * is scoped by project so multi-project visual-regression works without
 * clobbering.
 *
 * TODO: wire to bucket manifest writer once H3 (manifest schema + validator)
 * lands — for now we delegate to Playwright's native `toHaveScreenshot`
 * which already writes under `snapshotDir`.
 */
export async function captureBaseline(
  page: Page,
  name: string,
  options?: { fullPage?: boolean; mask?: Parameters<Page['screenshot']>[0] extends infer _ ? unknown[] : never },
): Promise<void> {
  // Using expect…toHaveScreenshot here ensures the snapshot is written
  // to snapshotDir on first run and compared on subsequent runs.
  await expect(page).toHaveScreenshot(`${name}.png`, {
    fullPage: options?.fullPage ?? false,
  });
}

/**
 * Assert the current page state matches a previously captured baseline.
 * Thin wrapper — kept for API symmetry with `captureBaseline` so scenarios
 * read as capture/assert pairs.
 */
export async function assertNoDiff(
  page: Page,
  name: string,
  options?: { maxDiffPixelRatio?: number; fullPage?: boolean },
): Promise<void> {
  await expect(page).toHaveScreenshot(`${name}.png`, {
    fullPage: options?.fullPage ?? false,
    maxDiffPixelRatio: options?.maxDiffPixelRatio ?? 0.01,
  });
}

/**
 * Wait for the app's "idle" marker before proceeding.
 * TODO: replace hard-coded `networkidle` with a DOM-level signal
 * (e.g. `[data-probe-ready="true"]`) once C3/login fixture injects one.
 */
export async function waitForAppReady(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle');
}
