'use client';

import { useEffect, useState, useCallback } from 'react';
import { api } from '@/lib/client';
import { Pill, Loading, LoadError, Empty, StatusSelect } from '@/components/ui';
import { OpenAiAccountDialog } from '@/components/dialogs/openai-account-dialog';
import { IconPlus, IconRefresh } from '@/lib/icons';
import type { OpenAiAccount, OpenAiCheckStatus, Client } from '@/lib/types';

type Row = OpenAiAccount & {
  client_name: string;
  client_alert_phone: string | null;
  effective_phones: string[];
};

// How each check outcome reads, and which Pill colour carries it. CHECK_FAILED
// is 'neutral' on purpose: it means "we could not find out", not "bad", and
// colouring it red would put a project that is probably fine next to one that
// genuinely cannot make requests.
const STATUS_UI: Record<OpenAiCheckStatus, { emoji: string; label: string; pill: 'healthy' | 'down' | 'warning' | 'neutral' }> = {
  CREDIT_AVAILABLE: { emoji: '🟢', label: 'Credit available', pill: 'healthy' },
  NO_CREDIT: { emoji: '🔴', label: 'No credit / quota', pill: 'down' },
  INVALID_KEY: { emoji: '⚠️', label: 'Invalid API key', pill: 'warning' },
  CHECK_FAILED: { emoji: '⚪', label: 'Check failed', pill: 'neutral' },
};

function ago(iso: string | null): string {
  if (!iso) return 'never';
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'} ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? '' : 's'} ago`;
}

export default function OpenAiTrackPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<OpenAiAccount | null>(null);
  const [checking, setChecking] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    const [a, c] = await Promise.all([
      api.get<Row[]>('/api/openai-accounts'),
      api.get<Client[]>('/api/clients'),
    ]);
    setRows(a);
    setClients(c);
    setLoading(false);
  }, []);

  // Without this, a failed load renders "No OpenAI project tracked yet" — which
  // reads as "nothing to watch" when projects may in fact be out of credit.
  const reload = useCallback(() => {
    setLoading(true);
    load().catch((e) => {
      setError(e?.message || 'Request failed');
      setLoading(false);
    });
  }, [load]);

  useEffect(() => {
    reload();
  }, [reload]);

  const checkOne = async (id: string) => {
    setChecking(id);
    setNote('');
    try {
      const r = await api.post<{ status: OpenAiCheckStatus; error: string | null }>(
        `/api/openai-accounts/${id}/check`,
        {}
      );
      const ui = STATUS_UI[r.status];
      setNote(`${ui.emoji} ${ui.label}${r.error ? ` — ${r.error}` : ''}`);
      await load();
    } catch (e: any) {
      setNote(e.message);
    } finally {
      setChecking(null);
    }
  };

  const checkAll = async () => {
    setChecking('all');
    setNote('');
    try {
      const r = await api.post<{ checked: number }>('/api/openai-accounts/check-all', {});
      setNote(`checked ${r.checked} project${r.checked !== 1 ? 's' : ''} · ${new Date().toLocaleTimeString()}`);
      await load();
    } catch (e: any) {
      setNote(e.message);
    } finally {
      setChecking(null);
    }
  };

  const remove = async (id: string) => {
    if (!confirm('Remove this OpenAI project from tracking?')) return;
    await api.del(`/api/openai-accounts/${id}`);
    reload();
  };

  const toggleDaily = async (r: Row) => {
    setNote('');
    try {
      await api.patch(`/api/openai-accounts/${r.id}`, { daily_check_enabled: !r.daily_check_enabled });
      await load();
    } catch (e: any) {
      setNote(e.message);
    }
  };

  const shown = rows.filter((r) => filter === 'all' || r.status === filter);
  const noCredit = rows.filter((r) => r.status === 'NO_CREDIT').length;

  return (
    <div className="page">
      <div className="page-h">
        <div>
          <h1>OpenAI Track</h1>
          <p>
            Whether each client&apos;s OpenAI project can currently make API requests. Projects with automatic
            checking on are checked four times a day, at <strong>10:00, 13:00, 18:00 and 22:00 IST</strong>; each
            check is one minimal request with that project&apos;s own key. If OpenAI reports the quota/credit is
            exhausted, every WhatsApp number on the project is messaged <strong>once</strong> through the same AI
            Sensy setup the downtime alerts use — not on every check, and again only if the project recovers and
            then runs dry again. This does not read a dollar balance — OpenAI exposes none for a project key.
          </p>
        </div>
        <div className="actions">
          <StatusSelect
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: 'All statuses' },
              { value: 'CREDIT_AVAILABLE', label: 'Credit available' },
              { value: 'NO_CREDIT', label: 'No credit' },
              { value: 'INVALID_KEY', label: 'Invalid key' },
              { value: 'CHECK_FAILED', label: 'Check failed' },
            ]}
          />
          <button
            className="btn"
            onClick={checkAll}
            disabled={!rows.length || checking !== null}
            title="Makes one minimal OpenAI request per project to see whether its key still works"
          >
            <IconRefresh />
            {checking === 'all' ? 'Checking…' : 'Check now'}
          </button>
          {/* Disabled without a client the project could belong to. Saying so
              beats a dead button an operator has to guess about. */}
          <button
            className="btn btn-primary"
            onClick={() => setAdding(true)}
            disabled={!clients.length}
            title={clients.length ? undefined : 'Add a client first — an OpenAI project is tracked against one.'}
          >
            <IconPlus />
            Add OpenAI project
          </button>
        </div>
      </div>

      {error && <LoadError error={error} what="OpenAI Track" onRetry={reload} />}

      {!error && (note || (!loading && !rows.length)) && (
        <div className="tip" style={{ background: 'var(--soft)', borderColor: 'var(--border)', color: 'var(--muted)' }}>
          {!rows.length
            ? clients.length
              ? 'No OpenAI project tracked yet — click Add OpenAI project, then paste its project key (sk-proj-…) and the mobile number to alert.'
              : (
                  // The Add button is disabled in this state, and a disabled
                  // button with only a tooltip is a dead end — say what unblocks
                  // it and link straight there.
                  <>
                    <strong>Add OpenAI project is disabled because there are no clients yet.</strong> An OpenAI
                    project is tracked against a client, so{' '}
                    <a href="/clients" style={{ color: 'var(--accent)', fontWeight: 600 }}>
                      add a client first
                    </a>{' '}
                    — then this button turns on.
                  </>
                )
            : note}
        </div>
      )}

      {noCredit > 0 && (
        <div className="tip" style={{ background: 'var(--amber-50)', borderColor: 'var(--amber)', color: 'var(--amber)' }}>
          {noCredit} project{noCredit !== 1 ? 's' : ''} cannot make OpenAI requests. Each has an open alert on the
          Alerts page with its WhatsApp delivery state.
        </div>
      )}

      <div className="card">
        <div className="card-h">
          <h3>Tracked projects</h3>
        </div>
        {loading ? (
          <Loading />
        ) : shown.length ? (
          <div className="tbl-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Project</th>
                  <th>Status</th>
                  <th>Auto check</th>
                  <th>Last checked</th>
                  <th>WhatsApp recipients</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => {
                  const ui = STATUS_UI[r.status] ?? STATUS_UI.CHECK_FAILED;
                  // Never probed yet: the row's status is only a default, so
                  // showing it as a verdict would be a result nobody measured.
                  const unchecked = !r.last_checked_at;
                  return (
                    <tr key={r.id}>
                      <td className="client">
                        {r.name}
                        <div className="sub">
                          {r.client_name} · key {r.has_key ? (r.label ?? 'saved') : <span style={{ color: 'var(--red)' }}>not set</span>}
                        </div>
                      </td>
                      <td>
                        {unchecked ? (
                          <span className="pill neutral" title="No check has run for this project yet">
                            Not checked yet
                          </span>
                        ) : (
                          <>
                            <Pill status={ui.pill} label={`${ui.emoji} ${ui.label}`} />
                            {r.last_check_error && (
                              <div
                                className="sub"
                                style={{ color: r.status === 'NO_CREDIT' ? 'var(--red)' : 'var(--muted)', maxWidth: 340 }}
                                title={r.last_check_error}
                              >
                                {r.last_check_error.slice(0, 90)}
                                {r.last_check_error.length > 90 ? '…' : ''}
                              </div>
                            )}
                          </>
                        )}
                      </td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <button
                            type="button"
                            className={`switch ${r.daily_check_enabled ? 'on' : ''}`}
                            onClick={() => toggleDaily(r)}
                            aria-label={`automatic checking for ${r.name}`}
                            title={
                              r.daily_check_enabled
                                ? 'Checked automatically at 10:00, 13:00, 18:00 and 22:00 IST. Click to switch off.'
                                : 'Skipped by the automatic checks — “Check now” still works. Click to switch on.'
                            }
                          >
                            <i />
                          </button>
                          <span className="sub" style={{ color: r.daily_check_enabled ? 'var(--muted)' : 'var(--faint)' }}>
                            {r.daily_check_enabled ? 'ON' : 'OFF'}
                          </span>
                        </div>
                      </td>
                      <td className="sub" title={r.last_checked_at ? new Date(r.last_checked_at).toLocaleString() : undefined}>
                        {ago(r.last_checked_at)}
                      </td>
                      <td>
                        <Recipients row={r} />
                        {r.alerted && (
                          <div className="sub" style={{ color: 'var(--amber)' }}>
                            alerted{r.last_alerted_at ? ` ${ago(r.last_alerted_at)}` : ''}
                          </div>
                        )}
                      </td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <button className="btn btn-ghost" style={{ padding: '3px 8px', fontSize: 11.5 }} onClick={() => checkOne(r.id)} disabled={checking !== null}>
                          {checking === r.id ? 'Checking…' : 'Check now'}
                        </button>
                        <button className="btn btn-ghost" style={{ padding: '3px 8px', fontSize: 11.5 }} onClick={() => setEditing(r)}>
                          Edit
                        </button>
                        <button className="btn btn-ghost" style={{ padding: '3px 8px', fontSize: 11.5, color: 'var(--red)' }} onClick={() => remove(r.id)}>
                          Remove
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>{error ? 'Not loaded — see the error above.' : 'No project matches this filter.'}</Empty>
        )}
      </div>

      {adding && <OpenAiAccountDialog clients={clients} onClose={() => setAdding(false)} onSaved={load} />}
      {editing && <OpenAiAccountDialog initial={editing} clients={clients} onClose={() => setEditing(null)} onSaved={load} />}
    </div>
  );
}

/**
 * The numbers a no-credit alert would actually reach.
 *
 * Capped at two visible rows so a project with six recipients does not turn one
 * table row into a column; the full list is in the tooltip and the Edit dialog.
 */
function Recipients({ row }: { row: Row }) {
  const list = row.effective_phones ?? [];
  if (!list.length) {
    return <span style={{ color: 'var(--red)', fontSize: 12.5 }}>none — nobody would be told</span>;
  }
  // No numbers of its own: what is shown is the client's, standing in.
  const viaClient = !row.phones?.length;
  const shown = list.slice(0, 2);
  const rest = list.length - shown.length;
  return (
    <div title={list.join('\n')}>
      {shown.map((p) => (
        <div key={p} className="mono" style={{ fontSize: 12.5, lineHeight: 1.5 }}>
          {p}
          {viaClient && <span style={{ color: 'var(--muted)' }}> (client)</span>}
        </div>
      ))}
      {rest > 0 && (
        <div className="sub" style={{ color: 'var(--faint)' }}>
          +{rest} more
        </div>
      )}
    </div>
  );
}
