'use client';
import { useEffect, useState } from 'react';
import { useAdmin, useAdminQuery } from '@/components/admin/AdminShell';
import { Panel } from '@/components/admin/charts';
import { PageHead } from '@/components/admin/PageHead';
import { request } from '@/lib/api';
import type { BudgetLimits, BudgetsResp } from '@/lib/admin/types';

const CATS = ['llm', 'tts', 'stt', 'realtime', 'maps', 'knowledge'];

export default function BudgetsPage() {
  const { session } = useAdmin();
  const [q, reload] = useAdminQuery<BudgetsResp>('/v1/admin/config/budgets');
  const [draft, setDraft] = useState<BudgetLimits | null>(null);
  const [confirm, setConfirm] = useState<null | { summary: string; next: BudgetLimits }>(null);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    if (q.status === 'ok') setDraft(q.data.limits);
  }, [q]);

  const apply = async (next: BudgetLimits) => {
    try {
      await request('/v1/admin/config/budgets', { method: 'PUT', body: next, token: session.token });
      setMsg('Saved and written to the audit log.');
      reload();
    } catch (e) {
      setMsg(`Save failed: ${e instanceof Error ? e.message : 'error'}`);
    }
    setConfirm(null);
  };

  const toggleKill = (cat: string) => {
    if (!draft) return;
    const killed = draft.killed.includes(cat) ? draft.killed.filter((k) => k !== cat) : [...draft.killed, cat];
    setConfirm({ summary: `${draft.killed.includes(cat) ? 'Re-enable' : 'KILL'} all “${cat}” provider calls immediately for every session.`, next: { ...draft, killed } });
  };

  return (
    <>
      <PageHead title="Budgets & kill switches" lede="Owner only. Every change is confirmed and written to the audit log." />
      <div className="grid">
        <Panel title="Kill switches" subtitle="Disabling a category makes sessions degrade (template stories, text only) instead of calling that provider" state={q} wide testId="panel-kill">
          {() =>
            draft ? (
              <ul className="kill-list">
                {CATS.map((c) => {
                  const killed = draft.killed.includes(c);
                  return (
                    <li key={c}>
                      <span className={`chip ${killed ? 'chip-err' : 'chip-ok'}`}>{killed ? 'Killed' : 'Live'}</span>
                      <strong>{c}</strong>
                      <button type="button" className={`btn btn-sm ${killed ? 'btn-ghost' : 'btn-danger'}`} onClick={() => toggleKill(c)} disabled={session.preview}>
                        {killed ? 'Re-enable' : 'Kill'}
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : null
          }
        </Panel>
        <Panel title="Limits" state={q} wide>
          {() =>
            draft ? (
              <form
                className="budget-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  setConfirm({ summary: 'Update provider budgets for all sessions.', next: draft });
                }}
              >
                <table className="dtable">
                  <thead>
                    <tr>
                      <th scope="col">Category</th>
                      <th scope="col">Calls / session</th>
                      <th scope="col">Calls / minute (global)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {CATS.map((c) => (
                      <tr key={c}>
                        <td>{c}</td>
                        {(['perSession', 'perMinuteGlobal'] as const).map((k) => (
                          <td key={k}>
                            <input
                              className="input mono num-input"
                              type="number"
                              min={0}
                              value={draft[k][c] ?? ''}
                              onChange={(e) => setDraft({ ...draft, [k]: { ...draft[k], [c]: e.target.value === '' ? undefined : Number(e.target.value) } })}
                              aria-label={`${c} ${k}`}
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="sim-row">
                  <label className="field">
                    <span className="label">USD / session</span>
                    <input className="input mono num-input" type="number" step="0.05" min={0} value={draft.usdPerSession} onChange={(e) => setDraft({ ...draft, usdPerSession: Number(e.target.value) })} />
                  </label>
                  <label className="field">
                    <span className="label">Realtime seconds / session</span>
                    <input className="input mono num-input" type="number" min={0} value={draft.realtimeSecondsPerSession} onChange={(e) => setDraft({ ...draft, realtimeSecondsPerSession: Number(e.target.value) })} />
                  </label>
                </div>
                <button type="submit" className="btn btn-primary btn-sm" disabled={session.preview}>
                  Review & save…
                </button>
              </form>
            ) : null
          }
        </Panel>
      </div>
      {msg ? <p className="chip chip-ok">{msg}</p> : null}
      {confirm ? (
        <div className="modal-backdrop" role="presentation">
          <div className="modal card" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title">
            <h2 id="confirm-title" className="t-headline">
              Confirm change
            </h2>
            <p>{confirm.summary}</p>
            <p className="t-caption muted">This takes effect immediately and is recorded in the audit log with your identity.</p>
            <div className="sim-row">
              <button type="button" className="btn btn-danger btn-sm" onClick={() => void apply(confirm.next)}>
                Confirm
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirm(null)} autoFocus>
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
