import { expect, test, type Page } from '@playwright/test';

async function noHorizontalScroll(page: Page) {
  const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect(sw, 'page must not scroll horizontally').toBeLessThanOrEqual(cw);
}

async function startScenario(page: Page, name: string) {
  await page.getByTestId('scenario-select').selectOption(name);
  await page.getByTestId('speed-20').click();
  await page.getByTestId('sim-play').click();
}

test('home page renders the value proposition, guides and availability', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/Telvey/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('A local companion for wherever you are');
  await expect(page.locator('#guides')).toContainText('Ida');
  await expect(page.locator('#guides')).toContainText('Emil');
  await expect(page.locator('#availability')).toContainText('Field testing first in New York, Chicago, San Francisco and on U.S. interstates');
  await expect(page.getByTestId('now-playing')).toBeVisible(); // real component in the device frame
});

test('home, app and admin have no horizontal scroll at 390px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ['/', '/privacy', '/app', '/admin']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    await noHorizontalScroll(page);
  }
});

test('/app runs in offline demo mode and tells the 9/11 Memorial story on the wtc-walk replay', async ({ page }) => {
  await page.goto('/app');
  await expect(page.getByTestId('transport-chip')).toHaveText(/Offline demo mode/);
  await startScenario(page, 'wtc-walk');
  await expect(page.getByTestId('sim-banner')).toBeVisible();
  await expect(page.getByTestId('sim-banner')).toContainText('SIMULATED LOCATION');
  // Fixture name is "National September 11 Memorial & Museum" (fixtures/places/nyc-lower-manhattan.json).
  await expect(page.getByTestId('now-playing-place')).toHaveText(/9\/11 Memorial|September 11 Memorial/, { timeout: 30_000 });
  await expect(page.getByTestId('sim-banner')).toBeVisible();
});

test('/app switches to drive mode on the interstate replay', async ({ page }) => {
  await page.goto('/app');
  await startScenario(page, 'interstate');
  await expect(page.getByTestId('drive-hud')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('drive-hud')).toContainText('DRIVE');
  await expect(page.getByTestId('sim-banner')).toBeVisible();
  // E1: one big voice target, no text entry, no story controls
  await expect(page.getByTestId('mic')).toHaveCount(1);
  await expect(page.locator('input[type=text], textarea')).toHaveCount(0);
});

test('/admin shows the passkey login and leaks no data without an API', async ({ page }) => {
  await page.goto('/admin');
  await expect(page.getByTestId('admin-login')).toBeVisible();
  await expect(page.getByRole('button', { name: /passkey/i })).toBeDisabled();
  await expect(page.getByTestId('admin-no-api')).toContainText('API not connected');
  await expect(page.getByTestId('admin-console')).toHaveCount(0);
  await expect(page.locator('input[type=password]')).toHaveCount(0); // passkeys only (D-013)
  // The preview shows explicit empty states, never numbers.
  await page.getByTestId('admin-preview').click();
  await expect(page.getByTestId('nodata').first()).toContainText('No data — API not connected');
  await expect(page.locator('.stat-value')).toHaveCount(0);
});
