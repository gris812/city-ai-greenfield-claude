import { WORDMARK_PATHS, WORDMARK_TRANSFORM, WORDMARK_VIEWBOX } from './brand-paths';

/** The Telvey mark: open speech ring (opening faces upper-right = ahead) + ember place dot. */
export function Mark({ size = 28, title, mono = false, className }: { size?: number; title?: string; mono?: boolean; className?: string }) {
  return (
    <svg viewBox="0 0 120 120" width={size} height={size} role={title ? 'img' : undefined} aria-hidden={title ? undefined : true} className={className}>
      {title ? <title>{title}</title> : null}
      <path
        d="M66.6 22.58 A38 38 0 0 0 22 60 L22 98 L60 98 A38 38 0 0 0 96.14 48.26"
        fill="none"
        stroke="currentColor"
        strokeWidth="13.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="60" cy="60" r="12" fill={mono ? 'currentColor' : 'var(--color-ember-500)'} />
    </svg>
  );
}

export function Wordmark({ height = 22, className }: { height?: number; className?: string }) {
  const [, , w, h] = WORDMARK_VIEWBOX.split(' ').map(Number) as [number, number, number, number];
  return (
    <svg viewBox={WORDMARK_VIEWBOX} height={height} width={(height * w) / h} aria-hidden className={className}>
      <g transform={WORDMARK_TRANSFORM} fill="currentColor">
        {WORDMARK_PATHS.map((d, i) => (
          <path key={i} d={d} />
        ))}
      </g>
    </svg>
  );
}

export function Lockup({ height = 30, className }: { height?: number; className?: string }) {
  return (
    <span className={className} style={{ display: 'inline-flex', alignItems: 'center', gap: height * 0.22, color: 'var(--brand)' }}>
      <Mark size={height} />
      <Wordmark height={height * 1.05} />
      <span className="sr-only">Telvey</span>
    </span>
  );
}

export type GuideId = 'ida' | 'emil';

export function GuideAvatar({ id, size = 40, ring = false }: { id: string; size?: number; ring?: boolean }) {
  const g = id === 'emil' ? 'emil' : 'ida';
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/guides/${g}/avatar.svg`}
      alt=""
      width={size}
      height={size}
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        flex: 'none',
        background: g === 'ida' ? 'var(--color-ida-soft)' : 'var(--color-emil-soft)',
        boxShadow: ring ? `0 0 0 2px var(--surface), 0 0 0 4px var(--color-${g})` : undefined,
      }}
    />
  );
}
