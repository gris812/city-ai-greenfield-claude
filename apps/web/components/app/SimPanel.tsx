'use client';
import { useEffect, useState } from 'react';
import { IconLocate, IconPause, IconPlay, IconRoute } from '@/components/companion/icons';
import { DEMO_SCENARIOS } from '@/lib/local/demo-data';
import { formatDuration } from '@/lib/i18n';
import { useCompanion } from './CompanionProvider';

const SPEEDS = [1, 2, 5, 10, 20];

/** First-run card: pick a simulated trip or use real location. */
export function StartCard() {
  const [s, store] = useCompanion();
  return (
    <section className="card sheet-card start" data-testid="start-card">
      <h2 className="t-headline">Take Telvey for a walk, or a drive</h2>
      <p className="t-body-sm muted">
        Pick a simulated trip. The real decision engine runs {s.transport?.kind === 'live' ? 'on the server' : 'right here in your browser (offline demo mode, fixture places)'}. Audio plays in real time;
        simulation speed only moves the puck faster.
      </p>
      <div className="start-list">
        {DEMO_SCENARIOS.map((sc) => (
          <button
            key={sc.name}
            type="button"
            className="start-item"
            onClick={async () => {
              await store.selectScenario(sc.name);
              store.play();
            }}
          >
            <span className="start-kind" data-kind={/interstate|golden|transition/.test(sc.name) ? 'drive' : 'walk'} aria-hidden />
            <span>
              <strong>{sc.label}</strong>
              <span className="t-caption muted">{sc.description}</span>
            </span>
          </button>
        ))}
      </div>
      <div className="start-actions">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => void store.useGps()}>
          <IconLocate size={16} /> Use my location
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => void store.startManual()}>
          <IconRoute size={16} /> Drag the puck
        </button>
      </div>
    </section>
  );
}

export function SimPanel({ compact }: { compact: boolean }) {
  const [s, store, t] = useCompanion();
  const [open, setOpen] = useState(true);
  useEffect(() => {
    if (window.innerWidth < 960) setOpen(false); // mobile: keep the map visible
  }, []);
  const d = s.driver;
  const sc = DEMO_SCENARIOS.find((x) => x.name === d.scenario);
  const progress = d.durationMs > 0 ? d.elapsedMs / d.durationMs : 0;
  const collapsed = compact || !open;

  return (
    <section className={`simpanel${collapsed ? ' is-collapsed' : ''}`} aria-label={t.simulation} data-testid="sim-panel">
      <header className="simpanel-head">
        <span className="t-overline">{t.simulation}</span>
        {collapsed && d.mode === 'trace' ? (
          <button type="button" className="sim-mini" onClick={() => (d.playing ? store.pause() : store.play())} aria-label={d.playing ? t.pause : t.play} data-testid="sim-mini-play">
            {d.playing ? <IconPause size={16} /> : <IconPlay size={16} />}
            <span className="mono">{formatDuration(d.elapsedMs)}</span>
          </button>
        ) : null}
        {!compact ? (
          <button type="button" className="simpanel-toggle" aria-expanded={open} onClick={() => setOpen((x) => !x)}>
            {open ? 'Hide' : 'Show'}
          </button>
        ) : null}
      </header>
      {collapsed ? null : (
        <div className="simpanel-body">
          <label className="field">
            <span className="label">{t.scenario}</span>
            <select
              className="select"
              value={d.mode === 'trace' ? (d.scenario ?? '') : ''}
              onChange={(e) => e.target.value && void store.selectScenario(e.target.value)}
              data-testid="scenario-select"
            >
              <option value="">Choose a replay trace…</option>
              {DEMO_SCENARIOS.map((x) => (
                <option key={x.name} value={x.name}>
                  {x.label}
                </option>
              ))}
            </select>
          </label>
          <div className="sim-row">
            <button
              type="button"
              className="btn btn-primary btn-sm sim-play"
              disabled={d.mode !== 'trace' || d.done}
              onClick={() => (d.playing ? store.pause() : store.play())}
              data-testid="sim-play"
            >
              {d.playing ? <IconPause size={16} /> : <IconPlay size={16} />}
              {d.playing ? t.pause : t.play}
            </button>
            <div className="segmented" role="radiogroup" aria-label={t.speed}>
              {SPEEDS.map((n) => (
                <button key={n} type="button" role="radio" aria-checked={d.speed === n} onClick={() => store.setSpeed(n)} data-testid={`speed-${n}`}>
                  ×{n}
                </button>
              ))}
            </div>
          </div>
          {d.mode === 'trace' ? (
            <div className="sim-progress">
              <div className="sim-track" role="progressbar" aria-label="Replay progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
                <span style={{ width: `${progress * 100}%` }} />
              </div>
              <span className="mono t-caption muted">
                {formatDuration(d.elapsedMs)} / {formatDuration(d.durationMs)}
              </span>
            </div>
          ) : null}
          {sc ? <p className="t-caption muted">{sc.description}</p> : null}
          <div className="sim-row">
            <button type="button" className={`btn btn-ghost btn-sm${d.mode === 'manual' ? ' is-on' : ''}`} onClick={() => void store.startManual()} aria-pressed={d.mode === 'manual'}>
              <IconRoute size={16} /> {t.dragPuck}
            </button>
            <button type="button" className={`btn btn-ghost btn-sm${d.mode === 'gps' ? ' is-on' : ''}`} onClick={() => void store.useGps()} aria-pressed={d.mode === 'gps'}>
              <IconLocate size={16} /> {t.useMyLocation}
            </button>
            {d.mode !== 'idle' ? (
              <button type="button" className="btn btn-quiet btn-sm" onClick={() => void store.stopSimulation()}>
                {t.stopSim}
              </button>
            ) : null}
          </div>
          {d.gpsError ? <p className="t-caption" style={{ color: 'var(--color-error)' }}>{d.gpsError}</p> : null}
        </div>
      )}
    </section>
  );
}
