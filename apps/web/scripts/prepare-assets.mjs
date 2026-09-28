/**
 * Copies brand/guide assets and the demo fixtures into public/ so the repo keeps ONE source
 * of truth (/assets, /fixtures). Generated folders are git-ignored.
 *
 * D-005: fixtures are served ONLY for the clearly-labelled "Offline demo mode" / simulation
 * in the WebApp. Set WEB_DEMO_FIXTURES=0 to build without them (the simulation panel then
 * reports that no scenarios are available).
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const web = join(here, '..');
const root = join(web, '..', '..');
const pub = join(web, 'public');

function copy(from, to) {
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
}

// ── brand
const brandFiles = [
  'favicon.svg', 'favicon-32.png', 'favicon-180.png', 'logo-mark.svg', 'logo-mark-512.png', 'wordmark.svg', 'wordmark-light.svg',
  'logo-lockup.svg', 'logo-lockup-dark.svg', 'app-icon.svg', 'app-icon-512.png', 'app-icon-1024.png',
];
for (const f of brandFiles) copy(join(root, 'assets', 'brand', f), join(pub, 'brand', f));

// ── guides
for (const g of ['ida', 'emil']) {
  for (const f of ['portrait.svg', 'avatar.svg', 'scene.svg', 'avatar-512.png', 'portrait-1200.png', 'scene-1200.png']) {
    copy(join(root, 'assets', 'guides', g, f), join(pub, 'guides', g, f));
  }
}

// ── 192px PWA icon (sharp ships with next; optional)
try {
  const req = createRequire(createRequire(import.meta.url).resolve('next/package.json'));
  const sharp = req('sharp');
  const out = join(pub, 'brand', 'app-icon-192.png');
  if (!existsSync(out)) await sharp(join(root, 'assets', 'brand', 'app-icon-512.png')).resize(192, 192).png().toFile(out);
} catch {
  console.warn('[prepare-assets] sharp unavailable; skipping 192px icon (manifest falls back to SVG).');
}

// ── demo fixtures (D-005: demo/simulation only)
if (process.env.WEB_DEMO_FIXTURES !== '0') {
  const fx = join(root, 'fixtures');
  const readDir = (d) => readdirSync(d).filter((f) => f.endsWith('.json')).sort();
  const places = readDir(join(fx, 'places')).flatMap((f) => JSON.parse(readFileSync(join(fx, 'places', f), 'utf8')));
  const evidence = readDir(join(fx, 'evidence')).flatMap((f) => JSON.parse(readFileSync(join(fx, 'evidence', f), 'utf8')));
  mkdirSync(join(pub, 'demo', 'traces'), { recursive: true });
  writeFileSync(join(pub, 'demo', 'places.json'), JSON.stringify(places));
  writeFileSync(join(pub, 'demo', 'evidence.json'), JSON.stringify(evidence));
  for (const f of readDir(join(fx, 'traces'))) {
    const t = JSON.parse(readFileSync(join(fx, 'traces', f), 'utf8'));
    writeFileSync(join(pub, 'demo', 'traces', f), JSON.stringify(t));
  }
}
console.log('[prepare-assets] ok');
