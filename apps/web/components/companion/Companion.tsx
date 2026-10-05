/**
 * Presentational WebApp components (no hooks, no browser APIs) so the marketing site can
 * render the REAL UI inside device frames, and the WebApp can wire them to live state.
 */
import './companion.css';
import { GuideAvatar } from '../brand';
import { EN, formatDuration, type Dict } from '@/lib/i18n';
import { IconMic, IconNotThis, IconPause, IconPlay, IconSkip } from './icons';

export interface NowPlayingView {
  planId: string;
  guideId: string;
  guideName: string;
  placeName: string;
  segments: Array<{ text: string; durationMs: number }>;
  segmentIndex: number;
  /** 0..1 within the current segment */
  segmentProgress: number;
  status: 'playing' | 'paused' | 'interrupted';
  spatialCue?: string | null;
  audio: 'server' | 'device' | 'text';
  bridgeText?: string | null;
}

export function NowPlayingCard({
  view,
  t = EN,
  onPause,
  onResume,
  onSkip,
  onNotThatOne,
  compact = false,
}: {
  view: NowPlayingView;
  t?: Dict;
  onPause?: () => void;
  onResume?: () => void;
  onSkip?: () => void;
  onNotThatOne?: () => void;
  compact?: boolean;
}) {
  const n = view.segments.length;
  const idx = Math.min(view.segmentIndex, Math.max(0, n - 1));
  const remainingMs =
    view.segments.slice(idx + 1).reduce((s, x) => s + x.durationMs, 0) + (view.segments[idx]?.durationMs ?? 0) * (1 - view.segmentProgress);
  const current = view.segments[idx]?.text ?? '';
  const g = view.guideId === 'emil' ? 'emil' : 'ida';
  const paused = view.status !== 'playing';
  return (
    <section className={`np${compact ? ' np-compact' : ''}`} data-guide={g} data-testid="now-playing" aria-label={`${t.nowTelling}: ${view.placeName}`}>
      <header className="np-head">
        <GuideAvatar id={g} size={compact ? 36 : 44} />
        <div className="np-titles">
          <p className="t-overline np-over">
            {t.nowTelling} · {view.guideName}
          </p>
          <h2 className="np-title" data-testid="now-playing-place">
            {view.placeName}
          </h2>
        </div>
      </header>
      <div className="np-progress" role="progressbar" aria-label="Story progress" aria-valuemin={0} aria-valuemax={n} aria-valuenow={idx + view.segmentProgress}>
        {view.segments.map((s, i) => (
          <span key={i} className="np-tick" style={{ flexGrow: Math.max(1, s.durationMs) }}>
            <span className="np-fill" style={{ width: `${i < idx ? 100 : i === idx ? Math.round(view.segmentProgress * 100) : 0}%` }} />
          </span>
        ))}
      </div>
      <p className="np-meta t-caption">
        {t.segmentOf(idx + 1, n)} · {t.left(formatDuration(remainingMs))}
        {view.spatialCue ? ` · ${view.spatialCue}` : ''}
      </p>
      {paused ? <p className="chip chip-warn np-state">{view.status === 'interrupted' ? t.interrupted : t.paused}</p> : null}
      <blockquote className="np-transcript" aria-live="polite">
        {view.bridgeText ? <span className="np-bridge">{view.bridgeText} </span> : null}
        {current}
      </blockquote>
      {view.audio !== 'server' ? <p className="np-degraded t-caption">{view.audio === 'device' ? t.deviceVoice : t.textOnly}</p> : null}
      <div className="np-actions">
        {paused ? (
          <button type="button" className="btn btn-primary np-primary" onClick={onResume}>
            <IconPlay size={18} /> {t.resume}
          </button>
        ) : (
          <button type="button" className="btn btn-primary np-primary" onClick={onPause}>
            <IconPause size={18} /> {t.pause}
          </button>
        )}
        <button type="button" className="btn btn-ghost btn-sm" onClick={onSkip}>
          <IconSkip size={16} /> {t.skip}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onNotThatOne}>
          <IconNotThis size={16} /> {t.notThatOne}
        </button>
      </div>
    </section>
  );
}

export function QuietCard({ t = EN, reason, guideName, detail }: { t?: Dict; reason?: string | null; guideName: string; detail?: string | null }) {
  const title = reason === 'warming_up' ? t.warmingUp : reason === 'no_fix' ? t.noFix : t.quietTitle;
  return (
    <section className="quiet" data-testid="quiet-stretch" aria-live="polite">
      <div className="quiet-mark" aria-hidden>
        <svg viewBox="0 0 120 120" width="36" height="36">
          <path d="M66.6 22.58 A38 38 0 0 0 22 60 L22 98 L60 98 A38 38 0 0 0 96.14 48.26" fill="none" stroke="currentColor" strokeWidth="9" strokeLinecap="round" />
          <circle cx="60" cy="60" r="11" fill="none" stroke="currentColor" strokeWidth="6" />
        </svg>
      </div>
      <div>
        <h2 className="t-headline">{title}</h2>
        <p className="t-body-sm muted">{reason === 'warming_up' || reason === 'no_fix' ? `${guideName} · ${t.silence[reason] ?? ''}` : t.quietBody}</p>
        {detail ? <p className="t-caption muted-3 quiet-detail">{detail}</p> : null}
      </div>
      <div className="horizon" aria-hidden />
    </section>
  );
}

export function MicButton({
  size = 72,
  listening = false,
  label,
  onPointerDown,
  onPointerUp,
  onClick,
  disabled,
}: {
  size?: 72 | 96;
  listening?: boolean;
  label: string;
  onPointerDown?: (e: React.PointerEvent<HTMLButtonElement>) => void;
  onPointerUp?: (e: React.PointerEvent<HTMLButtonElement>) => void;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={`mic${listening ? ' is-listening' : ''}`}
      style={{ width: size, height: size }}
      aria-label={label}
      aria-pressed={listening}
      data-testid="mic"
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onClick={onClick}
      disabled={disabled}
    >
      <span className="mic-halo" aria-hidden />
      <span className="mic-halo mic-halo-2" aria-hidden />
      <IconMic size={size === 96 ? 40 : 30} />
    </button>
  );
}

/** Drive-safe HUD (D-008 / E1): one hero line, one secondary line, one big voice target. */
export function DriveHud({
  hero,
  secondary,
  simulated,
  listening,
  speaking,
  t = EN,
  onMic,
  onMicDown,
  onMicUp,
}: {
  hero: string;
  secondary: string;
  simulated: boolean;
  listening?: boolean;
  speaking?: boolean;
  t?: Dict;
  onMic?: () => void;
  onMicDown?: (e: React.PointerEvent<HTMLButtonElement>) => void;
  onMicUp?: (e: React.PointerEvent<HTMLButtonElement>) => void;
}) {
  return (
    <section className="drive-hud" data-theme="drive" data-testid="drive-hud" aria-live="polite">
      <div className="drive-chips">
        <span className="drive-chip">{t.drive.toUpperCase()}</span>
        {simulated ? <span className="drive-chip drive-chip-sim">{t.simulated}</span> : null}
      </div>
      <div className="drive-lines">
        <p className="drive-hero" data-testid="drive-hero">
          {speaking ? <span className="drive-dot" aria-hidden /> : null}
          {hero}
        </p>
        <p className="drive-secondary">{secondary}</p>
      </div>
      <div className="drive-mic">
        <MicButton size={96} listening={listening} label={t.tapToTalk} onClick={onMic} onPointerDown={onMicDown} onPointerUp={onMicUp} />
      </div>
    </section>
  );
}

export function PhoneFrame({ children, label, theme }: { children: React.ReactNode; label: string; theme?: 'light' | 'dark' | 'drive' }) {
  return (
    <figure className="phone">
      <div className="phone-screen" data-theme={theme}>
        {children}
      </div>
      <figcaption className="t-caption muted phone-cap">{label}</figcaption>
    </figure>
  );
}

/** Listening sheet (BRAND: full-bleed petrol-800, ember mic disc with 1.2 s halos). */
export function ListeningSheet({
  t = EN,
  transcript,
  note,
  children,
  onCancel,
  onDone,
  inline = false,
}: {
  t?: Dict;
  transcript?: string | null;
  note?: string | null;
  children?: React.ReactNode;
  onCancel?: () => void;
  onDone?: () => void;
  inline?: boolean;
}) {
  return (
    <section className={`listen${inline ? ' listen-inline' : ''}`} role="dialog" aria-modal={!inline} aria-label={t.listening} data-testid="listening-sheet">
      <div className="listen-disc" aria-hidden>
        <span className="listen-halo" />
        <span className="listen-halo listen-halo-2" />
        <span className="listen-core">
          <IconMic size={36} />
        </span>
      </div>
      <p className="listen-transcript" aria-live="polite">
        {transcript && transcript.length > 0 ? transcript : t.listening}
      </p>
      <p className="listen-hint">{note ?? t.listeningHint}</p>
      {children}
      {onCancel || onDone ? (
        <div className="listen-actions">
          {onCancel ? (
            <button type="button" className="btn listen-btn-ghost" onClick={onCancel}>
              {t.cancel}
            </button>
          ) : null}
          {onDone ? (
            <button type="button" className="btn listen-btn" onClick={onDone}>
              {t.done}
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
