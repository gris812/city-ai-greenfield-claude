/**
 * Smoke test: the shared LocalEngine (offline demo mode) runs the real core pipeline over the
 * fixture packs and emits a story for a fixture walk — the same code the web tab and the phone run.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Directive, EvidencePack, PlaceCandidate } from '@city/core';
import { describe, expect, it } from 'vitest';
import { demoDataFrom, LocalTransport, TracePlayer, type TraceFile } from '../src/index.js';

const FX = fileURLToPath(new URL('../../../fixtures', import.meta.url));
const readAll = <T>(dir: string): T[] =>
  readdirSync(join(FX, dir))
    .filter((f) => f.endsWith('.json') && !f.includes('.clutter.'))
    .flatMap((f) => JSON.parse(readFileSync(join(FX, dir, f), 'utf8')) as T[]);

describe('LocalTransport + TracePlayer (offline demo)', () => {
  it('replays a fixture walk and tells at least one grounded story, marked simulated', async () => {
    const data = demoDataFrom(readAll<PlaceCandidate>('places'), readAll<EvidencePack>('evidence'));
    const trace = JSON.parse(readFileSync(join(FX, 'traces', 'wtc-walk.json'), 'utf8')) as TraceFile;
    const out: Directive[] = [];
    const t = new LocalTransport({ directive: (d) => out.push(d), debug: () => undefined, status: () => undefined }, async () => data);
    await t.start({ guideId: 'ida', locale: 'en-US', units: 'imperial', simulated: true, talkativeness: 0 });
    const player = new TracePlayer(trace, Date.now());
    player.setSpeed(20);
    player.play();
    let guard = 0;
    let allSimulated = true;
    while (!player.state.done && guard++ < 10_000) {
      const fixes = player.advance(1000);
      for (const f of fixes) {
        allSimulated &&= f.source === 'simulated';
        t.sendContext({ fixes: [f], route: null, appState: 'foreground', audio: { playing: false, outputRoute: 'speaker' }, lastInteractionAt: null, clientTime: f.t, simulated: true });
        const p = out.filter((d): d is Extract<Directive, { type: 'play' }> => d.type === 'play').at(-1);
        if (p) t.sendAudioProgress({ planId: p.planId, segmentIndex: p.segments.length - 1, offsetMs: 0, state: 'finished' });
      }
    }
    expect(player.state.done).toBe(true);
    expect(allSimulated).toBe(true);
    expect(out.some((d) => d.type === 'play')).toBe(true);
    expect(out.filter((d) => d.type === 'state').every((d) => d.type === 'state' && d.simulated)).toBe(true);
  });
});

