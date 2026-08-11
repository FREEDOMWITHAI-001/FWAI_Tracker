'use client';

import { useEffect, useState, useCallback, Fragment } from 'react';
import { api } from '@/lib/client';
import { Pill, Loading, LoadError, Empty, StatusSelect, Meter } from '@/components/ui';
import { OpenAiAccountDialog } from '@/components/dialogs/openai-account-dialog';
import { IconPlus, IconRefresh } from '@/lib/icons';
import type { OpenAiAccount, Client } from '@/lib/types';

type Row = OpenAiAccount & {
  client_name: string;
  client_alert_phone: string | null;
  effective_phone: string | null;
};

const STATUS_LABEL: Record<string, string> = { healthy: 'Healthy', warning: 'Low', down: 'Critical' };

const fmt = (n: number) => n.toLocaleString();

export default function OpenAiTrackPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<OpenAiAccount | null>(null);
  const [checking, setChecking] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  // Inline mobile-number editing, so changing who gets alerted doesn't need the
  // full edit dialog.
  const [phoneEdit, setPhoneEdit] = useState<string | null>(null);
  const [phoneVal, setPhoneVal] = useState('');
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

  // Without this, a failed load renders "No OpenAI account tracked yet" — which
  // reads as "nothing to watch" when accounts may in fact be sitting at 0%.
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
      const r = await api.post<{ remaining_pct: number; error: string | null; used_source: string }>(
        `/api/openai-accounts/${id}/check`,
        {}
      );
      setNote(
        r.error
          ? `usage pull failed: ${r.error}`
          : `checked · ${r.remaining_pct}% remaining · usage from ${r.used_source} · ${new Date().toLocaleTimeString()}`
      );
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
      setNote(`checked ${r.checked} account${r.checked !== 1 ? 's' : ''} · ${new Date().toLocaleTimeString()}`);
      await load();
    } catch (e: any) {
      setNote(e.message);
    } finally {
      setChecking(null);
    }
  };

  const remove = async (id: string) => {
    if (!confirm('Remove this OpenAI account from tracking?')) return;
    await api.del(`/api/openai-accounts/${id}`);
    reload();
  };

  const startPhone = (r: Row) => {
    setPhoneEdit(r.id);
    setPhoneVal(r.alert_phone ?? '');
  };
  const savePhone = async (id: string) => {
    try {
      await api.patch(`/api/openai-accounts/${id}`, { alert_phone: phoneVal.trim() || null });
      setPhoneEdit(null);
      await load();
    } catch (e: any) {
      setNote(e.message);
    }
  };

  const shown = rows.filter((r) => filter === 'all' || r.status === filter);
  const lowCount = rows.filter((r) => r.budgeted && r.status !== 'healthy').length;

  return (
    <div className="page">
      <div className="page-h">
        <div>
          <h1>OpenAI Track</h1>
          <p>
            Token allocation vs usage per client. When remaining credit crosses a threshold, the client&apos;s mobile
            number gets a WhatsApp through the same AI Sensy setup the downtime alerts use.
          </p>
        </div>
        <div className="actions">
          <StatusSelect
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: 'All statuses' },
              { value: 'healthy', label: 'Healthy' },
              { value: 'warning', label: 'Low' },
              { value: 'down', label: 'Critical' },
            ]}
          />
          <button className="btn" onClick={checkAll} disabled={!rows.length || checking !== null}>
            <IconRefresh />
            {checking === 'all' ? 'Checking…' : 'Check now'}
          </button>
          <button className="btn btn-primary" onClick={() => setAdding(true)} disabled={!clients.length}>
            <IconPlus />
            Add OpenAI account
          </button>
        </div>
      </div>

      {error && <LoadError error={error} what="OpenAI Track" onRetry={reload} />}

      {!error && (note || (!loading && !rows.length)) && (
        <div className="tip" style={{ background: 'var(--soft)', borderColor: 'var(--border)', color: 'var(--muted)' }}>
          {!rows.length
            ? 'No OpenAI account tracked yet — click Add OpenAI account, set the client, the token allocation and the mobile number to alert.'
            : note}
        </div>
      )}

      {lowCount > 0 && (
        <div className="tip" style={{ background: 'var(--amber-50)', borderColor: 'var(--amber)', color: 'var(--amber)' }}>
          {lowCount} account{lowCount !== 1 ? 's' : ''} at or below the low-credit threshold. Each has an open alert on
          the Alerts page with its WhatsApp delivery state.
        </div>
      )}

      <div className="card">
        <div className="card-h">
          <h3>Tracked accounts</h3>
        </div>
        {loading ? (
          <Loading />
        ) : shown.length ? (
          <div className="tbl-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Status</th>
                  <th>OpenAI API key</th>
                  <th>Mobile number</th>
                  <th>Remaining</th>
                  <th>Last checked</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => {
                  const open = expanded === r.id;
                  return (
                    <Fragment key={r.id}>
                      <tr>
                        <td className="client" style={{ cursor: 'pointer' }} onClick={() => setExpanded(open ? null : r.id)} title="Click for usage detail">
                          <span style={{ display: 'inline-block', width: 14, color: 'var(--muted)' }}>{open ? '▾' : '▸'}</span>
                          {r.client_name}
                          <div className="sub">{r.name}</div>
                        </td>
                        <td>
                          {r.budgeted ? (
                            <Pill status={r.status} label={STATUS_LABEL[r.status] ?? r.status} />
                          ) : (
                            <span className="pill neutral" title="Set an allocation to enable alerting">
                              No budget
                            </span>
                          )}
                        </td>
                        <td className="sub mono">
                          {r.has_key ? (
                            r.label ?? 'saved'
                          ) : (
                            <span style={{ color: 'var(--faint)' }}>not set</span>
                          )}
                        </td>
                        <td>
                          {phoneEdit === r.id ? (
                            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                              <input
                                className="input"
                                style={{ width: 150, padding: '4px 8px', fontSize: 12.5 }}
                                value={phoneVal}
                                onChange={(e) => setPhoneVal(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') savePhone(r.id);
                                  if (e.key === 'Escape') setPhoneEdit(null);
                                }}
                                placeholder="+919999999999"
                                autoFocus
                              />
                              <button className="btn btn-primary" style={{ padding: '3px 8px', fontSize: 11.5 }} onClick={() => savePhone(r.id)}>
                                Save
                              </button>
                              <button className="btn btn-ghost" style={{ padding: '3px 8px', fontSize: 11.5 }} onClick={() => setPhoneEdit(null)}>
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <span
                              className="mono"
                              style={{ cursor: 'pointer', borderBottom: '1px dashed var(--border)' }}
                              onClick={() => startPhone(r)}
                              title="Click to edit"
                            >
                              {r.alert_phone ? (
                                r.alert_phone
                              ) : r.client_alert_phone ? (
                                <span style={{ color: 'var(--muted)' }}>{r.client_alert_phone} (client)</span>
                              ) : (
                                <span style={{ color: 'var(--red)' }}>none — set one</span>
                              )}
                            </span>
                          )}
                        </td>
                        <td className="resp">
                          {r.budgeted ? (
                            <div style={{ minWidth: 120 }}>
                              <Meter
                                name={`${r.remaining_pct}%`}
                                pct={r.remaining_pct}
                                color={r.status === 'down' ? 'var(--red)' : r.status === 'warning' ? 'var(--amber)' : 'var(--green)'}
                              />
                            </div>
                          ) : (
                            <span style={{ color: 'var(--faint)' }}>—</span>
                          )}
                        </td>
                        <td className="sub">
                          {r.last_check_error ? (
                            <span style={{ color: 'var(--red)' }} title={r.last_check_error}>
                              error: {r.last_check_error.slice(0, 32)}…
                            </span>
                          ) : r.last_checked_at ? (
                            new Date(r.last_checked_at).toLocaleString()
                          ) : (
                            'never'
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
                      {open && (
                        <tr>
                          <td colSpan={7} style={{ background: 'var(--soft)' }}>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 14, padding: '4px 20px 10px' }}>
                              <Detail label="Allocated" value={`${fmt(r.allocated_tokens)} tokens`} />
                              <Detail label="Used" value={`${fmt(r.used_tokens)} tokens`} />
                              <Detail label="Remaining" value={r.budgeted ? `${fmt(r.remaining_tokens)} tokens` : '—'} />
                              <Detail label="Usage source" value={r.used_source === 'api' ? 'OpenAI Usage API' : 'entered manually'} />
                              <Detail label="Low / critical at" value={`${r.low_threshold_pct}% / ${r.critical_threshold_pct}% remaining`} />
                              <Detail label="Alert contact" value={r.alert_name || '(client default)'} />
                              <Detail label="Alerting to" value={r.effective_phone ?? 'nobody — no number set'} />
                              <Detail
                                label="Alert state"
                                value={
                                  r.alerted
                                    ? `notified${r.last_alerted_at ? ` ${new Date(r.last_alerted_at).toLocaleString()}` : ''}`
                                    : r.low_since
                                      ? 'low, not yet delivered'
                                      : 'none'
                                }
                              />
                              {r.low_since && <Detail label="Low since" value={new Date(r.low_since).toLocaleString()} />}
                              {r.org_id && <Detail label="Organization" value={r.org_id} />}
                              {r.project_id && <Detail label="Project" value={r.project_id} />}
                            </div>
                            {r.last_check_error && (
                              <div style={{ padding: '0 20px 12px', fontSize: 12.5, color: 'var(--red)' }}>
                                Last check: {r.last_check_error}
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>{error ? 'Not loaded — see the error above.' : 'No account matches this filter.'}</Empty>
        )}
      </div>

      {adding && <OpenAiAccountDialog clients={clients} onClose={() => setAdding(false)} onSaved={load} />}
      {editing && <OpenAiAccountDialog initial={editing} clients={clients} onClose={() => setEditing(null)} onSaved={load} />}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.3px', color: 'var(--faint)', fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 13, marginTop: 2 }}>{value}</div>
    </div>
  );
}
