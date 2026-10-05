// Investor-report screenshot capture (Playwright, production web build, offline demo mode).
// Usage: PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers E2E_PORT=3100 node scripts/report/capture-screenshots.mjs
// Server: cd apps/web && pnpm exec next start -p 3100 -H 127.0.0.1   (after `pnpm build`)
// Every capture is of the REAL web app running its local (in-browser) engine over fixture data:
// SIMULATED location, offline demo mode, template prose, no TTS provider, schematic map (tiles unreachable).
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { chromium } = require(join(root, 'node_modules/.pnpm/playwright-core@1.56.1/node_modules/playwright-core'));
const PORT = process.env.E2E_PORT ?? '3100';
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = join(root, 'deliverables', 'screenshots', 'web');
mkdirSync(OUT, { recursive: true });
const log = [];
const note = (file, state) => { log.push({ file, state }); console.log('captured', file); };

const browser = await chromium.launch();
const mobile = async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'en-US' });
  return { ctx, page: await ctx.newPage() };
};
const shot = async (page, name, opts = {}) => { await page.screenshot({ path: join(OUT, name), ...opts }); };

// ---------- mobile-width flow ----------
{
  const { ctx, page } = await mobile();
  await page.goto(`${BASE}/app`);
  await page.getByTestId('start-card').waitFor();
  await page.waitForTimeout(800);
  await shot(page, 's01-guest-entry-mobile.png');
  note('s01-guest-entry-mobile.png', 'WebApp first run, no account, scenario picker (simulated trips) + "Use my location"; offline demo chip');

  await page.getByRole('button', { name: /^Guide:/ }).click();
  await page.getByRole('dialog').waitFor();
  await page.waitForTimeout(400);
  await shot(page, 's02-guide-selection-mobile.png');
  note('s02-guide-selection-mobile.png', 'Guide popover open: Ida selected, talkativeness control (0)');
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: /Dense-urban walk/ }).click();
  await page.getByTestId('now-playing').waitFor({ timeout: 60000 });
  await page.waitForTimeout(500);
  await shot(page, 's04-approaching-target-mobile.png');
  note('s04-approaching-target-mobile.png', 'Moments after the director started the first story on the wtc-walk replay: spatial cue "straight ahead, about 800 feet", target ringed on the map, segment 1 of N');

  // wait for segment 2
  await page.waitForFunction(() => /segment [2-9] of/.test(document.querySelector('.np-meta')?.textContent ?? ''), null, { timeout: 90000 });
  await page.waitForTimeout(300);
  await shot(page, 's05-active-story-mobile.png');
  note('s05-active-story-mobile.png', 'Same story a few seconds later (segment 2+): transcript in Literata, per-segment progress ticks, Pause/Skip/Not-that-one');

  await page.getByTestId('mic').dispatchEvent('pointerdown');
  await page.getByTestId('listening-sheet').waitFor();
  await page.waitForTimeout(600);
  await shot(page, 's06-listening-mobile.png');
  note('s06-listening-mobile.png', 'Mic pressed mid-story: narration stopped, listening sheet open (headless Chromium has no speech recognition, so the "Type instead" fallback is offered)');

  if ((await page.getByTestId('ask-input').count()) === 0) await page.getByRole('button', { name: 'Type instead' }).click();
  await page.getByTestId('ask-input').fill('Where can I get coffee nearby?');
  await page.waitForTimeout(300);
  await shot(page, 's06b-question-typed-mobile.png');
  note('s06b-question-typed-mobile.png', 'Typed fallback for the C1 coffee question');
  const metaBefore = (await page.locator('.np-meta').first().textContent().catch(() => '')) ?? '';
  await page.getByTestId('ask-input').press('Enter');
  await page.getByTestId('caption').waitFor({ timeout: 20000 });
  await page.waitForTimeout(500);
  const metaDuring = (await page.locator('.np-meta').first().textContent().catch(() => '')) ?? '';
  const captionText = ((await page.getByTestId('caption').textContent().catch(() => '')) ?? '').replace(/\s+/g, ' ').trim();
  await shot(page, 's07-nearby-result-mobile.png');
  note('s07-nearby-result-mobile.png', `Local engine nearby search over fixture places, story paused (was "${metaBefore.trim()}", now "${metaDuring.trim()}"): grounded caption "${captionText}"; result markers on the schematic map (tiles unreachable)`);
  await shot(page, 's12-degraded-text-only-mobile.png');
  note('s12-degraded-text-only-mobile.png', 'Degraded delivery in the same frame: "Text only · no voice available" (no TTS provider in offline demo; headless browser has no speech-synthesis voice), "Offline demo mode" chip, SIMULATED banner. The answer is still delivered as text');

  // resumed story: wait until the caption is gone and the story card is playing again
  await page.getByTestId('caption').waitFor({ state: 'detached', timeout: 60000 }).catch(() => {});
  await page.waitForFunction(() => /segment \d+ of/.test(document.querySelector('.np-meta')?.textContent ?? '') && !document.querySelector('.np-state'), null, { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(700);
  const metaAfter = (await page.locator('.np-meta').first().textContent().catch(() => '')) ?? '';
  await shot(page, 's08-resumed-story-mobile.png');
  note('s08-resumed-story-mobile.png', `After the answer, ResumePolicy resumed the interrupted plan (progress "${metaAfter.trim()}"; before the question: "${metaBefore.trim()}"): same story, not restarted`);

  await page.goto(`${BASE}/app/history`);
  await page.getByTestId('history-list').waitFor().catch(() => {});
  await page.waitForTimeout(500);
  await shot(page, 's10-history-mobile.png');
  note('s10-history-mobile.png', 'History after the session above (stored in browser localStorage; simulated entries are labelled)');

  await page.goto(`${BASE}/app/settings`);
  await page.waitForTimeout(600);
  await shot(page, 's11-settings-mobile.png', { fullPage: true });
  note('s11-settings-mobile.png', 'Settings: guide, talkativeness, language, units, connection (Auto/Local/Live), spoken output, theme, delete my data');
  await ctx.close();
}

// ---------- quiet stretch + drive (mobile) ----------
{
  const { ctx, page } = await mobile();
  await page.goto(`${BASE}/app`);
  await page.getByTestId('start-card').waitFor();
  await page.getByRole('button', { name: /Dense-urban walk/ }).click();
  await page.getByTestId('now-playing').waitFor({ timeout: 60000 });
  await page.getByRole('button', { name: 'Skip' }).click();
  await page.getByTestId('quiet-stretch').waitFor({ timeout: 30000 });
  await page.waitForTimeout(800);
  await shot(page, 's03-explore-idle-quiet-mobile.png');
  note('s03-explore-idle-quiet-mobile.png', 'Explore idle: after Skip the director enforces the cadence gap, so the app shows "quiet stretch" (silence is a designed state), walking regime, dense');
  await ctx.close();
}
{
  const { ctx, page } = await mobile();
  await page.goto(`${BASE}/app`);
  await page.getByRole('button', { name: /Interstate truck run/ }).click();
  await page.getByTestId('drive-hud').waitFor({ timeout: 60000 });
  await page.waitForTimeout(4000);
  await shot(page, 's09-drive-safe-mobile.png');
  note('s09-drive-safe-mobile.png', 'Drive-safe HUD auto-activated by the highway regime on the synthetic I-40 replay: dark palette, one status line, one large mic, no lists/text input');
  await ctx.close();
}

// ---------- degraded: live mode selected but no API ----------
{
  const { ctx, page } = await mobile();
  await page.addInitScript(() => { try { localStorage.setItem('telvey.settings.v1', JSON.stringify({ transport: 'live', guideId: 'ida', locale: 'en', units: 'imperial', talkativeness: 0, voice: true, theme: 'system' })); } catch {} });
  await page.goto(`${BASE}/app/settings`);
  await page.waitForTimeout(1500);
  await page.locator('.setting').filter({ hasText: 'Connection' }).first().screenshot({ path: join(OUT, 's12b-degraded-api-unreachable-mobile.png') });
  note('s12b-degraded-api-unreachable-mobile.png', 'Settings > Connection set to "Live" in a build with no API configured: the app falls back to the offline demo and states the reason instead of pretending to be live');
  await ctx.close();
}

// ---------- desktop ----------
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'en-US' });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/app`);
  await page.getByTestId('start-card').waitFor();
  await page.getByTestId('scenario-select').selectOption('wtc-walk');
  await page.getByTestId('speed-20').click();
  await page.getByTestId('sim-play').click();
  await page.getByTestId('now-playing').waitFor({ timeout: 60000 });
  await page.waitForTimeout(3000);
  await shot(page, 's13-webapp-desktop.png');
  note('s13-webapp-desktop.png', 'WebApp/PWA desktop layout, wtc-walk replay at x20, simulation panel visible; offline demo mode');
  await page.getByTestId('debug-toggle').click();
  await page.waitForTimeout(700);
  await shot(page, 's13b-webapp-debug-explain-desktop.png');
  note('s13b-webapp-debug-explain-desktop.png', 'Debug/explain drawer: candidate scores and suppression reasons from the running core (the same data the admin "explain" endpoint exposes)');
  await page.close(); 
  const p2 = await ctx.newPage();
  await p2.goto(`${BASE}/`);
  await p2.waitForLoadState('networkidle');
  await shot(p2, 's14-website-desktop-fold.png');
  await shot(p2, 's14b-website-desktop-full.png', { fullPage: true });
  note('s14-website-desktop-fold.png', 'Public website hero (apps/web route group (site)); no deployment exists, captured from the local production build');
  note('s14b-website-desktop-full.png', 'Public website, full page');
  await p2.goto(`${BASE}/admin`);
  await p2.getByTestId('admin-login').waitFor();
  await shot(p2, 's15a-admin-login-desktop.png');
  note('s15a-admin-login-desktop.png', 'Admin console login (WebAuthn passkey only; no static password exists)');
  await p2.getByTestId('admin-preview').click();
  await p2.getByTestId('demo-toggle').check();
  await p2.waitForTimeout(500);
  await shot(p2, 's15-admin-overview-demo-desktop.png', { fullPage: true });
  note('s15-admin-overview-demo-desktop.png', 'Admin overview in labelled ILLUSTRATIVE DEMO-DATA preview (no API connected). Not measurements');
  for (const [link, file] of [['Latency', 's15c-admin-latency-demo-desktop.png'], ['Cost', 's15d-admin-cost-demo-desktop.png'], ['Providers', 's15e-admin-providers-demo-desktop.png']]) {
    await p2.getByRole('link', { name: link }).click().catch(() => {});
    await p2.waitForTimeout(500);
    await shot(p2, file, { fullPage: true });
    note(file, `Admin ${link} view, ILLUSTRATIVE DEMO-DATA preview`);
  }
  await ctx.close();
}
writeFileSync(join(OUT, '_capture-log.json'), JSON.stringify({ capturedAt: new Date().toISOString(), base: BASE, items: log }, null, 2));
await browser.close();
