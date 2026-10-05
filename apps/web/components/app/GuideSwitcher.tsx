'use client';
import { useEffect, useRef } from 'react';
import { GuideAvatar } from '@/components/brand';
import { useCompanion } from './CompanionProvider';

const GUIDES = [
  { id: 'ida' as const, name: 'Ida', tagline: 'The unhurried storyteller who has time for every street.' },
  { id: 'emil' as const, name: 'Emil', tagline: 'The sharp-eyed observer who gets to the point.' },
];
const LEVELS = [-2, -1, 0, 1, 2];

export function GuideSwitcher({ onClose }: { onClose: () => void }) {
  const [s, store, t] = useCompanion();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDoc = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node) && !(e.target as HTMLElement).closest('.app-guide')) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('pointerdown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);
  return (
    <div className="popover guide-pop" ref={ref} role="dialog" aria-label={t.guide}>
      <p className="t-overline muted-3">{t.guide}</p>
      <div className="guide-options" role="radiogroup" aria-label={t.guide}>
        {GUIDES.map((g) => (
          <button
            key={g.id}
            type="button"
            role="radio"
            aria-checked={s.settings.guideId === g.id}
            className="guide-option"
            data-guide={g.id}
            onClick={() => store.updateSettings({ guideId: g.id })}
          >
            <GuideAvatar id={g.id} size={44} ring={s.settings.guideId === g.id} />
            <span>
              <strong>{g.name}</strong>
              <span className="t-caption muted">{g.tagline}</span>
            </span>
          </button>
        ))}
      </div>
      <p className="t-overline muted-3" style={{ marginTop: 14 }}>
        {t.talkativeness}
      </p>
      <div className="talk-row">
        <span className="t-caption muted">{t.quieter}</span>
        <div className="segmented" role="radiogroup" aria-label={t.talkativeness}>
          {LEVELS.map((n) => (
            <button key={n} type="button" role="radio" aria-checked={s.settings.talkativeness === n} aria-label={String(n)} onClick={() => store.updateSettings({ talkativeness: n })}>
              {n > 0 ? `+${n}` : n}
            </button>
          ))}
        </div>
        <span className="t-caption muted">{t.chattier}</span>
      </div>
    </div>
  );
}
