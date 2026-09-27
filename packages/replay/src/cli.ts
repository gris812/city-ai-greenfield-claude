/**
 * pnpm replay [--scenario <name>|all] [--out <dir>]
 * Writes benchmark/replay/<scenario>.json (summary + stories + timeline) and summary.json.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FixtureEvidence, FixturePlaceSource, REPO_ROOT } from './fixtures.js';
import { runScenario } from './run.js';
import { SCENARIOS, scenarioByName } from './scenarios.js';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0) return process.argv[i + 1];
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  return eq?.split('=')[1];
}

const which = arg('scenario') ?? 'all';
const outDir = arg('out') ?? join(REPO_ROOT, 'benchmark', 'replay');
const list = which === 'all' ? SCENARIOS : [scenarioByName(which)].filter((x) => x !== undefined);
if (list.length === 0) {
  console.error(`unknown scenario "${which}". Known: ${SCENARIOS.map((s) => s.name).join(', ')}`);
  process.exit(2);
}

const source = new FixturePlaceSource();
const evidence = new FixtureEvidence();
mkdirSync(outDir, { recursive: true });
const summaries = [];
for (const sc of list) {
  source.resetStats();
  const r = await runScenario(sc, { source, evidence });
  const { finalState: _drop, ...file } = r;
  writeFileSync(join(outDir, `${sc.name}.json`), JSON.stringify({ generatedBy: '@city/replay', note: 'SIMULATED replay over synthetic traces and fixture POI packs (D-005).', ...file }, null, 1) + '\n');
  summaries.push(r.summary);
  const s = r.summary;
  console.log(
    `${sc.name.padEnd(20)} ${String(Math.round(s.durationS / 60)).padStart(4)} min  stories=${s.storiesStarted} orient=${s.orientations} silence=${(s.silenceRatio * 100).toFixed(0)}% maxGap=${s.maxSilentGapS}s ` +
      `queries=${s.providerQueries.total} (${s.providerQueries.perHour}/h) behind=${s.wronglyBehindTargets} regimes=${s.regimeSequence.join('>')}`,
  );
  for (const t of s.targets) console.log(`    t=${String(t.t).padStart(6)}s  ${t.kind.padEnd(11)} ${t.regime.padEnd(15)} ${t.name}  (${t.distanceM} m, reach ${t.reachM} m)`);
}
if (which === 'all') writeFileSync(join(outDir, 'summary.json'), JSON.stringify(summaries, null, 1) + '\n');
