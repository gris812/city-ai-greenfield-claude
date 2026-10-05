'use client';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { GuideAvatar, Mark } from '@/components/brand';
import { DriveHud, ListeningSheet, MicButton, NowPlayingCard, QuietCard } from '@/components/companion/Companion';
import { IconBug, IconClock, IconGear } from '@/components/companion/icons';
import { config } from '@/lib/config';
import { formatDistance } from '@/lib/i18n';
import GoogleMapView from './GoogleMapView';
import MapView from './MapView';
import { useAppTheme, useCompanion } from './CompanionProvider';
import { DebugDrawer } from './DebugDrawer';
import { GuideSwitcher } from './GuideSwitcher';
import { SimPanel, StartCard } from './SimPanel';

const ZOOM: Record<string, number> = { unknown: 16, stationary: 16.5, walking: 16.3, cycling: 15, urban_driving: 14.2, highway_driving: 11 };

export function Explore() {
  const [s, store, t] = useCompanion();
  const theme = useAppTheme(s);
  const [debugOpen, setDebugOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [textDraft, setTextDraft] = useState('');
  const sheetRef = useRef<HTMLDivElement>(null);
  const [sheetH, setSheetH] = useState(240);
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 960px)');
    setWide(mq.matches);
    const on = (e: MediaQueryListEvent) => setWide(e.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  const simulated = s.driver.mode === 'trace' || s.driver.mode === 'manual';
  const drive = theme === 'drive';
  const guideName = s.settings.guideId === 'emil' ? 'Emil' : 'Ida';

  useEffect(() => {
    const el = sheetRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setSheetH(el.getBoundingClientRect().height));
    ro.observe(el);
    return () => ro.disconnect();
  }, [drive]);

  // Ctrl/Cmd+Shift+D toggles the debug drawer.
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'd') setDebugOpen((x) => !x);
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, []);

  const latestTop = useMemo(() => s.debug.find((e) => e.top)?.top ?? [], [s.debug]);
  const ahead = useMemo(
    () => latestTop.filter((c) => c.eligible && c.name !== s.focus?.name && c.relative !== 'behind').slice(0, 3),
    [latestTop, s.focus?.name],
  );
  const Map = config.googleMapsKey ? GoogleMapView : MapView;

  const driveHero = s.nowPlaying?.placeName ?? (s.caption && s.card ? s.card.name : t.quietTitle);
  const driveSecondary = s.nowPlaying
    ? `${guideName} · ${s.nowPlaying.spatialCue ?? t.nowTelling.toLowerCase()}`
    : s.listening.active
      ? t.listening
      : `${guideName} · ${t.regime[s.regime] ?? ''}`;

  const micDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    store.touched();
    void store.micDown();
  };
  const micUp = () => store.micUp();

  const quietDetail =
    s.transport?.kind === 'local' && s.driver.mode === 'gps' ? 'Offline demo mode only knows the fixture areas; outside them it stays quiet. Connect the API for live discovery.' : null;

  return (
    <div className="explore" data-theme={theme === 'light' && s.settings.theme === 'system' ? undefined : theme} data-drive={drive || undefined}>
      {simulated ? (
        <div className="sim-banner" role="status" data-testid="sim-banner">
          <span className="sim-banner-dot" aria-hidden />
          <strong>{t.simulated.toUpperCase()}</strong>
          <span className="sim-banner-meta">
            {s.driver.mode === 'manual' ? t.dragPuck : s.driver.scenario} · ×{s.driver.speed}
          </span>
        </div>
      ) : null}

      <header className="app-bar">
        <Link href="/" className="app-home" aria-label="Telvey home">
          <Mark size={28} />
        </Link>
        {s.transport ? (
          <span
            className={`chip ${s.transport.kind === 'live' ? (s.transport.degraded ? 'chip-warn' : 'chip-ok') : 'chip-warn'} chip-dot`}
            title={s.transport.reason ?? s.transport.detail ?? ''}
            data-testid="transport-chip"
          >
            {s.transport.kind === 'live' ? `${t.live}${s.transport.degraded ? ' · REST' : ''}` : t.offlineDemo}
          </span>
        ) : (
          <span className="chip">…</span>
        )}
        {!drive ? (
          <span className="chip app-regime" data-testid="regime-chip">
            {t.regime[s.regime]} · {t.density[s.density]}
          </span>
        ) : null}
        <span className="app-bar-spacer" />
        <button type="button" className="app-guide" aria-label={`${t.guide}: ${guideName}`} aria-expanded={guideOpen} onClick={() => setGuideOpen((x) => !x)}>
          <GuideAvatar id={s.settings.guideId} size={34} />
        </button>
        <button type="button" className={`icon-btn${debugOpen ? ' is-on' : ''}`} aria-label={t.debug} aria-pressed={debugOpen} onClick={() => setDebugOpen((x) => !x)} data-testid="debug-toggle">
          <IconBug />
        </button>
        <Link href="/app/history" className="icon-btn" aria-label={t.history}>
          <IconClock />
        </Link>
        <Link href="/app/settings" className="icon-btn" aria-label={t.settings}>
          <IconGear />
        </Link>
      </header>

      {guideOpen ? <GuideSwitcher onClose={() => setGuideOpen(false)} /> : null}

      <div className="map-area" onPointerDown={() => store.touched()}>
        <Map
          theme={theme}
          puck={s.driver.position}
          route={s.driver.route}
          focus={s.focus}
          ahead={ahead}
          results={s.results}
          zoom={ZOOM[s.regime] ?? 15}
          draggable={s.driver.mode === 'manual'}
          onDrag={(p) => store.dragTo(p)}
          pad={drive ? (wide ? { top: 20, bottom: 20, left: 20, right: 540 } : { top: 70, bottom: sheetH, left: 20, right: 20 }) : wide ? { top: 30, bottom: 30, left: 500, right: 400 } : { top: 70, bottom: sheetH, left: 10, right: 10 }}
        />
        {drive ? (
        <div className="drive-layer" ref={sheetRef}>
          <DriveHud
            hero={driveHero}
            secondary={driveSecondary}
            simulated={simulated}
            listening={s.listening.active}
            speaking={Boolean(s.nowPlaying) || Boolean(s.caption)}
            t={t}
            onMicDown={micDown}
            onMicUp={micUp}
          />
        </div>
        ) : null}
      </div>

      {drive ? null : (
        <div className="sheet" ref={sheetRef}>
          <div className="sheet-inner">
            <p className="sheet-status t-caption" aria-live="polite" hidden={s.driver.mode === 'idle' || !s.ready}>
              <span className="sheet-regime">
                {t.regime[s.regime]} · {t.density[s.density]}
              </span>
              {s.silence && !s.nowPlaying ? <span className="sheet-silence">{t.silence[s.silence] ?? s.silence}</span> : null}
            </p>
            {!s.ready ? (
              <div className="card sheet-card skeleton" aria-busy="true">
                <p className="muted">Starting…</p>
              </div>
            ) : s.driver.mode === 'idle' ? (
              <StartCard />
            ) : s.caption && s.nowPlaying?.status !== 'playing' ? (
              <>
              <section className="caption card" data-testid="caption">
                <GuideAvatar id={s.settings.guideId} size={36} />
                <div>
                  <p className="t-overline caption-over">{guideName}</p>
                  <p className="caption-text">{s.caption.text}</p>
                  {s.caption.mode && s.caption.mode !== 'server' ? <p className="t-caption muted-3">{s.caption.mode === 'device' ? t.deviceVoice : t.textOnly}</p> : null}
                </div>
              </section>
                {s.nowPlaying ? <NowPlayingCard compact view={s.nowPlaying} t={t} onPause={() => store.pauseStory()} onResume={() => store.resumeStory()} onSkip={() => store.skip()} onNotThatOne={() => store.notThatOne()} /> : null}
              </>
            ) : s.nowPlaying ? (
              <NowPlayingCard view={s.nowPlaying} t={t} onPause={() => store.pauseStory()} onResume={() => store.resumeStory()} onSkip={() => store.skip()} onNotThatOne={() => store.notThatOne()} />
            ) : (
              <QuietCard t={t} reason={s.silence} guideName={guideName} detail={quietDetail} />
            )}
            {s.results && s.results.length > 0 && !s.nowPlaying ? (
              <ul className="results card" aria-label="Nearby results">
                {s.results.map((r) => (
                  <li key={r.placeId}>
                    <span>{r.name}</span>
                    <span className="muted t-caption">{formatDistance(r.distanceM, s.settings.units)}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            {s.navigate ? (
              <div className="navigate card">
                <span>
                  Directions to <strong>{s.navigate.name}</strong>
                </span>
                <a className="btn btn-primary btn-sm" href={s.navigate.urls.google} target="_blank" rel="noreferrer noopener" onClick={() => store.clearNavigate()}>
                  Open in Maps
                </a>
              </div>
            ) : null}
          </div>
          {s.driver.mode !== 'idle' ? (
            <div className="sheet-mic">
              <MicButton size={72} listening={s.listening.active} label={t.holdToTalk} onPointerDown={micDown} onPointerUp={micUp} />
            </div>
          ) : null}
        </div>
      )}

      <SimPanel compact={drive} />
      {debugOpen ? <DebugDrawer onClose={() => setDebugOpen(false)} /> : null}

      {s.listening.active ? (
        <ListeningSheet
          t={t}
          transcript={s.listening.partial}
          note={s.listening.note}
          onCancel={() => store.cancelListening()}
          onDone={s.listening.mode === 'voice' ? () => store.finishListening() : undefined}
        >
          {s.listening.mode === 'text' && !drive ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                store.submitText(textDraft);
                setTextDraft('');
              }}
            >
              <input
                autoFocus
                value={textDraft}
                onChange={(e) => setTextDraft(e.target.value)}
                placeholder={t.typeInstead}
                aria-label={t.typeInstead}
                data-testid="ask-input"
                enterKeyHint="send"
              />
              <button type="submit" className="btn listen-btn">
                {t.send}
              </button>
            </form>
          ) : !drive ? (
            <button type="button" className="listen-type" onClick={() => store.typeInstead()}>
              Type instead
            </button>
          ) : null}
        </ListeningSheet>
      ) : null}
    </div>
  );
}
