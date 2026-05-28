'use client';

import { useEffect, useState, useCallback, Fragment } from 'react';
import { api } from '@/lib/client';
import { Loading, StatusSelect } from '@/components/ui';
import { WebinarDialog } from '@/components/dialogs/webinar-dialog';
import { IconPlus } from '@/lib/icons';
import type { Webinar, WebinarStage, Client } from '@/lib/types';

type WRow = Webinar & { client_name: string; webinar_stages: WebinarStage[] };

export default function ZoomPage() {
  const [webinars, setWebinars] = useState<WRow[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Webinar | null>(null);

  const load = useCallback(async () => {
    const [w, c] = await Promise.all([api.get<WRow[]>('/api/webinars'), api.get<Client[]>('/api/clients')]);
    setWebinars(w);
    setClients(c);
    setLoading(false);
  }, []);

  useEffect(() => {
    load().catch(() => setLoading(false));
  }, [load]);

  const remove = async (id: string) => {
    if (!confirm('Delete this webinar?')) return;
    await api.del(`/api/webinars/${id}`);
    load();
  };

  const list = webinars.filter((w) => filter === 'all' || w.client_name === filter);
  const totalP = list.reduce((s, w) => s + w.participants, 0);
  const totalR = list.reduce((s, w) => s + w.reminders, 0);
  const avgA = list.length ? Math.round(list.reduce((s, w) => s + w.attendance, 0) / list.length) : 0;
  const clientNames = [...new Set(webinars.map((w) => w.client_name))];

  const stat = (lbl: string, val: string | number, d: string) => (
    <div className="stat">
      <div className="top">
        <span className="lbl">{lbl}</span>
      </div>
      <div className="val">{val}</div>
      <div className="delta">{d}</div>
    </div>
  );

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Zoom Metrics</h1>
          <div className="sub">Pick a client to see their individual webinars and reminder performance.</div>
        </div>
        <div className="toolbar">
          <StatusSelect
            value={filter}
            onChange={setFilter}
            options={[{ value: 'all', label: 'All clients' }, ...clientNames.map((c) => ({ value: c, label: c }))]}
          />
          <button className="btn btn-primary" onClick={() => setAdding(true)} disabled={!clients.length}>
            <IconPlus />
            Add webinar
          </button>
        </div>
      </div>

      <div className="stats" style={{ gridTemplateColumns: 'repeat(4,1fr)' }}>
        {stat('Webinars', list.length, filter === 'all' ? 'across all clients' : filter)}
        {stat('Total Participants', totalP.toLocaleString(), 'registered')}
        {stat('Leave Reminders', totalR.toLocaleString(), 'sent to drop-offs')}
        {stat('Avg Attendance', avgA + '%', 'stayed to the end')}
      </div>

      <div className="card">
        <div className="card-h">
          <h3>{filter === 'all' ? 'All webinars' : `${filter} — webinars`}</h3>
          <span className="updated">
            {list.length} webinar{list.length !== 1 ? 's' : ''} · click a row for the per-reminder matrix
          </span>
        </div>
        <div className="tbl-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Webinar Name</th>
                <th>Client</th>
                <th>Participants</th>
                <th>Leave Reminders</th>
                <th>Attendance</th>
                <th>Date</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8}>
                    <Loading />
                  </td>
                </tr>
              ) : list.length ? (
                list.map((w) => {
                  const isOpen = !!open[w.id];
                  const statusPill =
                    w.status === 'down' ? (
                      <span className="pill down">Reminders failed</span>
                    ) : w.status === 'warning' ? (
                      <span className="pill warning">Partial</span>
                    ) : (
                      <span className="pill healthy">OK</span>
                    );
                  return (
                    <Fragment key={w.id}>
                      <tr className={`wrow ${isOpen ? 'open' : ''}`} onClick={() => setOpen((o) => ({ ...o, [w.id]: !o[w.id] }))}>
                        <td>
                          <div className="client">
                            <span className="chev">›</span>
                            {w.name}
                          </div>
                        </td>
                        <td style={{ color: 'var(--muted)' }}>{w.client_name}</td>
                        <td className="resp">{w.participants.toLocaleString()}</td>
                        <td className="resp" style={{ color: w.reminders === 0 ? 'var(--red)' : 'var(--ink)' }}>
                          {w.reminders.toLocaleString()}
                        </td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                            <div className="track" style={{ width: 90 }}>
                              <i style={{ width: `${w.attendance}%` }} />
                            </div>
                            <span className="resp">{w.attendance}%</span>
                          </div>
                        </td>
                        <td className="sub">{w.webinar_date || '—'}</td>
                        <td>{statusPill}</td>
                        <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }} onClick={(e) => e.stopPropagation()}>
                          <button className="btn btn-ghost" style={{ padding: '4px 9px', fontSize: 12 }} onClick={() => setEditing(w)}>
                            Edit
                          </button>
                          <button className="btn btn-ghost" style={{ padding: '4px 9px', fontSize: 12, color: 'var(--red)' }} onClick={() => remove(w.id)}>
                            Delete
                          </button>
                        </td>
                      </tr>
                      <tr className={`wdetail ${isOpen ? 'open' : ''}`} style={{ display: isOpen ? 'table-row' : 'none' }}>
                        <td colSpan={8}>
                          <div className="inner">
                            <table className="smatrix">
                              <thead>
                                <tr>
                                  <th style={{ textAlign: 'left' }}>Reminder email</th>
                                  <th style={{ textAlign: 'right' }}>Triggered</th>
                                  <th style={{ textAlign: 'right' }}>Succeeded</th>
                                  <th style={{ textAlign: 'right' }}>Failed</th>
                                  <th style={{ textAlign: 'right' }}>Delivery</th>
                                </tr>
                              </thead>
                              <tbody>
                                {w.webinar_stages.length ? (
                                  w.webinar_stages.map((s) => {
                                    const pct = s.triggered ? Math.round((s.succeeded / s.triggered) * 100) : 0;
                                    const ss = s.failed > s.triggered * 0.1 ? 'down' : s.failed > 0 ? 'warning' : 'healthy';
                                    return (
                                      <tr key={s.id}>
                                        <td>
                                          <span className="sname">
                                            <span className={`dot ${ss}`} />
                                            {s.stage}
                                          </span>
                                        </td>
                                        <td className="num">{s.triggered.toLocaleString()}</td>
                                        <td className="num s">{s.succeeded.toLocaleString()}</td>
                                        <td className="num f">{s.failed.toLocaleString()}</td>
                                        <td className="num">{pct}%</td>
                                      </tr>
                                    );
                                  })
                                ) : (
                                  <tr>
                                    <td colSpan={5} style={{ color: 'var(--faint)' }}>
                                      No reminder stages recorded.
                                    </td>
                                  </tr>
                                )}
                              </tbody>
                            </table>
                          </div>
                        </td>
                      </tr>
                    </Fragment>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={8} style={{ color: 'var(--faint)', padding: '26px 20px' }}>
                    {webinars.length ? 'No webinars for this client yet.' : 'No webinars yet. Add one (you need a client first).'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {adding && <WebinarDialog clients={clients} onClose={() => setAdding(false)} onSaved={load} />}
      {editing && <WebinarDialog initial={editing as Webinar} clients={clients} onClose={() => setEditing(null)} onSaved={load} />}
    </div>
  );
}
