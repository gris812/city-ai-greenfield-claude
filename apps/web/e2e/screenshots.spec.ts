import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

/** Visual review captures → deliverables/screenshots/web/ (not assertions of pixels). */
const OUT = join(__dirname, '..', '..', '..', 'deliverables', 'screenshots', 'web');
mkdirSync(OUT, { recursive: true });
const shot = (page: Page, name: string, fullPage = false) => page.screenshot({ path: join(OUT, `${name}.png`), fullPage });

async function startScenario(page: Page, name: string) {
  await page.getByTestId('scenario-select').selectOption(name);
  await page.getByTestId('speed-20').click();
  await page.getByTestId('sim-play').click();
}

test('site screenshots', async ({ page }) => {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await shot(page, 'home-desktop', true);
  await page.addStyleTag({ content: '.site-header{position:static!important}' });
  await page.locator('#guides').screenshot({ path: join(OUT, 'home-guides.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await shot(page, 'home-mobile', true);
});

test('app screenshots', async ({ page }) => {
  await page.goto('/app');
  await expect(page.getByTestId('start-card')).toBeVisible();
  await shot(page, 'app-start');
  await startScenario(page, 'wtc-walk');
  await expect(page.getByTestId('now-playing')).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(2500);
  await shot(page, 'app-walking-now-playing');
  await page.getByTestId('debug-toggle').click();
  await page.waitForTimeout(500);
  await shot(page, 'app-debug-timeline');
  await page.getByRole('button', { name: 'Close debug' }).click();
  // skip → cadence gap → quiet stretch on foot
  await page.getByRole('button', { name: 'Skip' }).click();
  await expect(page.getByTestId('quiet-stretch')).toBeVisible({ timeout: 20_000 });
  await shot(page, 'app-quiet-stretch');
  // text question fallback (no speech recognition in headless)
  await startScenario(page, 'interstate');
  await expect(page.getByTestId('drive-hud')).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(1500);
  await shot(page, 'app-drive-mode');
});

test('app mobile screenshots', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/app');
  await expect(page.getByTestId('start-card')).toBeVisible();
  await shot(page, 'app-mobile-start');
  await page.getByRole('button', { name: /Dense-urban walk/ }).click();
  await expect(page.getByTestId('now-playing')).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(1500);
  await shot(page, 'app-mobile-now-playing');
  await page.getByTestId('mic').dispatchEvent('pointerdown');
  await expect(page.getByTestId('listening-sheet')).toBeVisible();
  await page.waitForTimeout(500);
  await shot(page, 'app-mobile-listening');
  if ((await page.getByTestId('ask-input').count()) === 0) await page.getByRole('button', { name: 'Type instead' }).click();
  await page.getByTestId('ask-input').fill('tell me more');
  await page.getByTestId('ask-input').press('Enter');
  await expect(page.getByTestId('caption')).toBeVisible({ timeout: 10_000 });
  await shot(page, 'app-mobile-answer');
  await page.goto('/app/history');
  await expect(page.getByTestId('history-list')).toBeVisible();
  await shot(page, 'app-mobile-history');
  await page.goto('/app/settings');
  await shot(page, 'app-mobile-settings', true);
});

test('app mobile drive screenshot', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/app');
  await page.getByRole('button', { name: /Interstate truck run/ }).click();
  await expect(page.getByTestId('drive-hud')).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(5000);
  await shot(page, 'app-mobile-drive');
});

test('admin screenshots', async ({ page }) => {
  await page.goto('/admin');
  await expect(page.getByTestId('admin-login')).toBeVisible();
  await shot(page, 'admin-login');
  await page.getByTestId('admin-preview').click();
  await expect(page.getByTestId('nodata').first()).toBeVisible();
  await shot(page, 'admin-overview-no-api', true);
  await page.getByTestId('demo-toggle').check();
  await page.waitForTimeout(300);
  await shot(page, 'admin-overview-demo-labelled', true);
  await page.getByRole('link', { name: 'Latency' }).click();
  await page.waitForTimeout(300);
  await shot(page, 'admin-latency-demo-labelled', true);
  await page.getByRole('link', { name: 'Cost' }).click();
  await page.waitForTimeout(300);
  await shot(page, 'admin-cost-demo-labelled', true);
});
