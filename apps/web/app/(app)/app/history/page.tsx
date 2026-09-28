'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { GuideAvatar } from '@/components/brand';
import { useCompanion } from '@/components/app/CompanionProvider';
import { api, apiConfigured, type HistoryItem } from '@/lib/api';
import { guestToken } from '@/lib/session/live';

export default function HistoryPage() {
  const [s, , t] = useCompanion();
  const [server, setServer] = useState<HistoryItem[] | null>(null);
  const [serverState, setServerState] = useState<'idle' | 'loading' | 'error' | 'ok'>('idle');

  useEffect(() => {
    if (!apiConfigured() || s.transport?.kind !== 'live') return;
    setServerState('loading');
    guestToken()
      .then((tok) => api.history(tok))
      .then((r) => {
        setServer(Array.isArray(r) ? r : (r.items ?? []));
        setServerState('ok');
      })
      .catch(() => setServerState('error'));
  }, [s.transport?.kind]);

  return (
    <div className="page-shell">
      <header className="page-head">
        <Link href="/app" className="btn btn-ghost btn-sm">
          ← {t.explore}
        </Link>
        <h1 className="t-title2">{t.history}</h1>
      </header>
      <p className="muted t-body-sm page-lede">
        Places you have heard about on this device. Only the place name and time are kept here — never your route or coordinates.
      </p>
      {serverState === 'ok' && server ? (
        <section className="card list-card">
          <h2 className="t-headline">From your account</h2>
          <ul className="hist">
            {server.map((h) => (
              <li key={`${h.placeId}-${h.at}`}>
                <strong>{h.placeName}</strong>
                <span className="t-caption muted">{new Date(h.at).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : serverState === 'error' ? (
        <p className="chip chip-warn">Server history unavailable right now.</p>
      ) : null}
      {s.history.length === 0 ? (
        <div className="card empty">
          <p className="t-headline">Nothing yet</p>
          <p className="muted">Stories you hear will show up here. Start a simulated walk on the Explore screen.</p>
        </div>
      ) : (
        <ul className="hist card list-card" data-testid="history-list">
          {s.history.map((h) => (
            <li key={h.planId}>
              <GuideAvatar id={h.guideId} size={32} />
              <div>
                <strong>{h.placeName}</strong>
                <p className="t-caption muted">
                  {new Date(h.at).toLocaleString()} {h.simulated ? <span className="chip chip-sim">Simulated</span> : null}
                </p>
                <p className="hist-excerpt">{h.excerpt}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
