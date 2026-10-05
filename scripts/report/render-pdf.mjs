// Print an HTML file to PDF with headless Chromium (Playwright core, already installed; never run `playwright install`).
// Usage: PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/report/render-pdf.mjs in.html out.pdf
import { createRequire } from 'node:module';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { chromium } = require(join(root, 'node_modules/.pnpm/playwright-core@1.56.1/node_modules/playwright-core'));
const [input, output] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(pathToFileURL(resolve(input)).href, { waitUntil: 'load' });
await page.evaluate(() => document.fonts.ready);
await page.waitForFunction(() => [...document.images].every((i) => i.complete));
await page.pdf({ path: resolve(output), preferCSSPageSize: true, printBackground: true, displayHeaderFooter: false });
await browser.close();
