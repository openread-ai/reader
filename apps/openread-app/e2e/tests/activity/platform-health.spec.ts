import { expect, test } from '@playwright/test';
import { clearSession, getTestSession, injectSession } from '../../fixtures/auth';

test('platform health: Openread loads, login session works, and logout clears auth', async ({
  page,
}) => {
  await page.goto('/auth', { waitUntil: 'networkidle' });
  await expect(page.locator('body')).toBeVisible();

  const session = await getTestSession();
  await injectSession(page, session);

  await page.goto('/library', { waitUntil: 'networkidle' });
  await expect(page).toHaveURL(/\/library/);
  await expect
    .poll(() => page.evaluate(() => Boolean(localStorage.getItem('token'))), {
      message: 'auth token should be present after readiness login',
    })
    .toBe(true);

  await page.goto('/settings/account', { waitUntil: 'networkidle' });
  const signOut = page.getByRole('button', { name: /sign out/i }).first();
  await expect(signOut).toBeVisible({ timeout: 15_000 });
  await signOut.click();

  await expect
    .poll(() => page.evaluate(() => Boolean(localStorage.getItem('token'))), {
      message: 'auth token should be cleared after readiness logout',
      timeout: 15_000,
    })
    .toBe(false);

  await clearSession(page);
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await expect(page.locator('body')).toBeVisible();
});
