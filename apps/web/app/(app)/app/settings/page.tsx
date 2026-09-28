'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useCompanion } from '@/components/app/CompanionProvider';
import { apiConfigured } from '@/lib/api';
import type { Settings } from '@/lib/settings';

function Seg<T extends string | number>({ value, options, onChange, label }: { value: T; options: Array<{ v: T; l: string }>; onChange: (v: T) => void; label: string }) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.v)} type="button" role="radio" aria-checked={value === o.v} onClick={() => onChange(o.v)}>
          {o.l}
        </button>
      ))}
    </div>
  );
}

export default function SettingsPage() {
  const [s, store, t] = useCompanion();
  const st = s.settings;
  const set = (p: Partial<Settings>) => store.updateSettings(p);
  const [confirm, setConfirm] = useState(false);
  const [deleted, setDeleted] = useState<string | null>(null);
  return (
    <div className="page-shell">
      <header className="page-head">
        <Link href="/app" className="btn btn-ghost btn-sm">
          ← {t.explore}
        </Link>
        <h1 className="t-title2">{t.settings}</h1>
      </header>

      <section className="card settings">
        <div className="setting">
          <div>
            <h2 className="t-headline">{t.guide}</h2>
            <p className="t-caption muted">Same facts, different company.</p>
          </div>
          <Seg label={t.guide} value={st.guideId} options={[{ v: 'ida', l: 'Ida' }, { v: 'emil', l: 'Emil' }]} onChange={(v) => set({ guideId: v })} />
        </div>
        <div className="setting">
          <div>
            <h2 className="t-headline">{t.talkativeness}</h2>
            <p className="t-caption muted">Quieter raises the bar for speaking and widens the gaps.</p>
          </div>
          <Seg label={t.talkativeness} value={st.talkativeness} options={[-2, -1, 0, 1, 2].map((n) => ({ v: n, l: n > 0 ? `+${n}` : String(n) }))} onChange={(v) => set({ talkativeness: v })} />
        </div>
        <div className="setting">
          <div>
            <h2 className="t-headline">Language</h2>
            <p className="t-caption muted">Interface and narration.</p>
          </div>
          <Seg label="Language" value={st.locale} options={[{ v: 'en', l: 'English' }, { v: 'ru', l: 'Русский' }]} onChange={(v) => set({ locale: v })} />
        </div>
        <div className="setting">
          <div>
            <h2 className="t-headline">Units</h2>
          </div>
          <Seg label="Units" value={st.units} options={[{ v: 'metric', l: 'Metric' }, { v: 'imperial', l: 'Imperial' }]} onChange={(v) => set({ units: v })} />
        </div>
        <div className="setting">
          <div>
            <h2 className="t-headline">Appearance</h2>
            <p className="t-caption muted">Drive mode always uses its own high-contrast dark theme.</p>
          </div>
          <Seg label="Appearance" value={st.theme} options={[{ v: 'system', l: 'System' }, { v: 'light', l: 'Light' }, { v: 'dark', l: 'Dark' }]} onChange={(v) => set({ theme: v })} />
        </div>
        <div className="setting">
          <div>
            <h2 className="t-headline">Voice</h2>
            <p className="t-caption muted">Off shows the story as text only.</p>
          </div>
          <Seg label="Voice" value={st.voice ? 'on' : 'off'} options={[{ v: 'on', l: 'On' }, { v: 'off', l: 'Off' }]} onChange={(v) => set({ voice: v === 'on' })} />
        </div>
        <div className="setting">
          <div>
            <h2 className="t-headline">Connection</h2>
            <p className="t-caption muted">
              {apiConfigured() ? 'Auto uses the live API when reachable, otherwise the offline demo.' : 'No API is configured for this build, so the offline demo is used.'} Current:{' '}
              <strong>{s.transport?.kind === 'live' ? 'Live' : 'Offline demo mode'}</strong>
              {s.transport?.reason ? ` (${s.transport.reason})` : ''}
            </p>
          </div>
          <Seg label="Connection" value={st.transport} options={[{ v: 'auto', l: 'Auto' }, { v: 'live', l: 'Live' }, { v: 'local', l: 'Offline demo' }]} onChange={(v) => set({ transport: v })} />
        </div>
      </section>

      <section className="card settings danger-zone">
        <div className="setting">
          <div>
            <h2 className="t-headline">Delete my data</h2>
            <p className="t-caption muted">Removes your guest history from our servers (when connected) and clears everything Telvey stored in this browser.</p>
          </div>
          {confirm ? (
            <div className="sim-row">
              <button
                type="button"
                className="btn btn-danger btn-sm"
                onClick={async () => {
                  const r = await store.deleteData();
                  setConfirm(false);
                  setDeleted(r.server === 'failed' ? 'Browser data cleared. The server could not be reached; try again later.' : 'Your data has been deleted.');
                }}
              >
                Delete everything
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirm(false)}>
                {t.cancel}
              </button>
            </div>
          ) : (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirm(true)}>
              Delete my data…
            </button>
          )}
        </div>
        {deleted ? (
          <p className="chip chip-ok" role="status">
            {deleted}
          </p>
        ) : null}
      </section>
      <p className="t-caption muted-3">
        <Link href="/privacy">Privacy policy</Link>
      </p>
    </div>
  );
}
