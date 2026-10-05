/**
 * One-off rasterizer for native icon/splash assets (run manually when the brand changes; the
 * outputs in apps/mobile/assets/brand are committed so EAS builds need no image tooling).
 * Source of truth: /assets/brand (SVG + PNG) and /assets/guides. Uses sharp from the web app's
 * Next.js install (no extra dependency): `node apps/mobile/scripts/make-icons.mjs`.
 */
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const mobile = join(here, '..');
const root = join(mobile, '..', '..');
const brand = join(root, 'assets', 'brand');
const out = join(mobile, 'assets', 'brand');
mkdirSync(out, { recursive: true });

const webReq = createRequire(join(root, 'apps', 'web', 'package.json'));
const sharp = createRequire(webReq.resolve('next/package.json'))('sharp');

const svg = (f) => readFileSync(join(brand, f));
const white = (buf) => Buffer.from(buf.toString('utf8').replaceAll('#000', '#FFF').replaceAll('#000000', '#FFFFFF'));

// iOS / generic icon (opaque, 1024) — provided raster.
copyFileSync(join(brand, 'app-icon-1024.png'), join(out, 'icon.png'));
// Android adaptive icon layers at 1024 (vector → crisp).
await sharp(svg('app-icon-android-foreground.svg'), { density: 384 }).resize(1024, 1024).png().toFile(join(out, 'adaptive-foreground.png'));
await sharp(svg('app-icon-android-background.svg'), { density: 384 }).resize(1024, 1024).png().toFile(join(out, 'adaptive-background.png'));
await sharp(svg('app-icon-android-monochrome.svg'), { density: 384 }).resize(1024, 1024).png().toFile(join(out, 'adaptive-monochrome.png'));
// Splash mark (drawn on the petrol splash background).
await sharp(svg('logo-mark.svg'), { density: 512 }).resize(1024, 1024, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toFile(join(out, 'splash-mark.png'));
// Dark-mode splash: paper-coloured ring on petrol-900.
await sharp(Buffer.from(svg('logo-mark.svg').toString('utf8').replace('#0F4C5C', '#F7F4EE')), { density: 512 })
  .resize(1024, 1024, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png()
  .toFile(join(out, 'splash-mark-dark.png'));
// Android notification / foreground-service icon: white silhouette on transparent.
await sharp(white(svg('app-icon-android-monochrome.svg')), { density: 96 }).resize(96, 96).png().toFile(join(out, 'notification-icon.png'));

for (const g of ['ida', 'emil']) {
  mkdirSync(join(mobile, 'assets', 'guides', g), { recursive: true });
  copyFileSync(join(root, 'assets', 'guides', g, 'avatar-512.png'), join(mobile, 'assets', 'guides', g, 'avatar.png'));
}
console.log('[make-icons] ok');
