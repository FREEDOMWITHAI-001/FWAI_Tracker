'use client';

import { useEffect, useState, useCallback, Fragment } from 'react';
import { api } from '@/lib/client';
import { Loading, StatusSelect } from '@/components/ui';
import { WebinarDialog } from '@/components/dialogs/webinar-dialog';
import { ZoomAccountDialog } from '@/components/dialogs/zoom-account-dialog';
import { IconPlus } from '@/lib/icons';
import type { Webinar, WebinarStage, Client, ZoomAccount, ZoomSession } from '@/lib/types';

type WRow = Webinar & { client_name: string; webinar_stages: WebinarStage[] };
type ZAccountRow = ZoomAccount & { client_name: string; session_count: number };
type ZSessionRow = ZoomSession & { client_name: string };

// Build a CSV string (RFC-4180 quoting) and trigger a download in the browser.
function downloadCsv(filename: string, headers: string[], rows: (string | number | null | undefined)[][]) {
  const esc = (v: string | number | null | undefined) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [headers, ...rows].map((r) => r.map(esc).join(',')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ZoomPage() {
  const [webinars, setWebinars] = useState<WRow[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Webinar | null>(null);
  const [zoomAccounts, setZoomAccounts] = useState<ZAccountRow[]>([]);
  const [zoomSessions, setZoomSessions] = useState<ZSessionRow[]>([]);
  const [connecting, setConnecting] = useState(false);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [zoomMsg, setZoomMsg] = useState('');

  const load = useCallback(async () => {
    const [w, c, za, zs] = await Promise.all([
      api.get<WRow[]>('/api/webinars'),
      api.get<Client[]>('/api/clients'),
      api.get<ZAccountRow[]>('/api/zoom-accounts').catch(() => [] as ZAccountRow[]),
      api.get<ZSessionRow[]>('/api/zoom-sessions').catch(() => [] as ZSessionRow[]),
    ]);
    setWebinars(w);
    setClients(c);
    setZoomAccounts(za);
    setZoomSessions(zs);
    setLoading(false);
  }, []);

  const syncAccount = async (id: string) => {
    setSyncingId(id);
    setZoomMsg('');
    try {
      const r = await api.post<{ synced: number }>(`/api/zoom-accounts/${id}/sync`, {});
      setZoomMsg(`Synced ${r.synced} session${r.synced === 1 ? '' : 's'}.`);
      await load();
    } catch (e: any) {
      setZoomMsg(`Sync failed: ${e.message}`);
    } finally {
      setSyncingId(null);
    }
  };

  const removeAccount = async (id: string) => {
    if (!confirm('Disconnect this Zoom account? Its synced sessions will be removed.')) return;
    await api.del(`/api/zoom-accounts/${id}`);
    load();
  };

  // Per-session participant drill-down (lazy-loaded on first expand).
  const [sessionOpen, setSessionOpen] = useState<Record<string, boolean>>({});
  const [sessionDetail, setSessionDetail] = useState<
    Record<string, { loading: boolean; error?: string; data?: any }>
  >({});
  const [showList, setShowList] = useState<Record<string, boolean>>({});

  const toggleSession = async (id: string) => {
    const willOpen = !sessionOpen[id];
    setSessionOpen((o) => ({ ...o, [id]: willOpen }));
    if (willOpen && !sessionDetail[id]) {
      setSessionDetail((d) => ({ ...d, [id]: { loading: true } }));
      try {
        const r = await api.get(`/api/zoom-sessions/${id}/participants`);
        setSessionDetail((d) => ({ ...d, [id]: { loading: false, data: r } }));
        // Reflect the freshly computed metrics in the row immediately.
        if (r?.metrics) {
          setZoomSessions((list) =>
            list.map((z) =>
              z.id === id
                ? {
                    ...z,
                    unique_participants: r.metrics.unique,
                    peak_concurrent: r.metrics.peak_concurrent,
                    avg_duration_min: r.metrics.avg_duration_min,
                    rejoins: r.metrics.rejoins,
                  }
                : z
            )
          );
        }
      } catch (e: any) {
        setSessionDetail((d) => ({ ...d, [id]: { loading: false, error: e.message } }));
      }
    }
  };

  const exportSessions = () => {
    const headers = [
      'Topic', 'Type', 'Client', 'Start', 'Registrants', 'Joins',
      'Unique', 'Rejoins', 'Peak concurrent', 'Avg watch (min)', 'Attendance %',
    ];
    const rows = zSessions.map((s) => [
      s.topic,
      s.kind,
      s.client_name,
      s.start_time ? new Date(s.start_time).toLocaleString() : '',
      s.kind === 'webinar' ? s.registrants_count : '',
      s.participants_count,
      s.unique_participants ?? '',
      s.rejoins ?? '',
      s.peak_concurrent ?? '',
      s.avg_duration_min ?? '',
      s.kind === 'webinar' ? s.attendance_pct : '',
    ]);
    downloadCsv('zoom-sessions.csv', headers, rows);
  };

  const exportParticipants = (topic: string, parts: any[]) => {
    const headers = ['Name', 'Email', 'Joined', 'Left', 'Duration (min)'];
    const rows = parts.map((p) => [p.name, p.email ?? '', p.join_time ?? '', p.leave_time ?? '', p.duration_min ?? '']);
    downloadCsv(`participants-${topic.replace(/[^a-z0-9]+/gi, '-').slice(0, 40)}.csv`, headers, rows);
  };

  useEffect(() => {
    load().catch(() => setLoading(false));
  }, [load]);

  const remove = async (id: string) => {
    if (!confirm('Delete this webinar?')) return;
    await api.del(`/api/webinars/${id}`);
    load();
  };

  const list = webinars.filter((w) => filter === 'all' || w.client_name === filter);
  const zAccts = zoomAccounts.filter((a) => filter === 'all' || a.client_name === filter);
  const zSessions = zoomSessions.filter((s) => filter === 'all' || s.client_name === filter);
  const zWebinarCount = zSessions.filter((s) => s.kind === 'webinar').length;
  const zMeetingCount = zSessions.filter((s) => s.kind === 'meeting').length;
  const zParticipants = zSessions.reduce((s, x) => s + (x.participants_count || 0), 0);
  const zAvg = zSessions.length ? Math.round(zParticipants / zSessions.length) : 0;
  const zPeak = zSessions.reduce((m, x) => Math.max(m, x.participants_count || 0), 0);
  const clientNames = [
    ...new Set([
      ...webinars.map((w) => w.client_name),
      ...zoomAccounts.map((a) => a.client_name),
      ...zoomSessions.map((s) => s.client_name),
    ]),
  ];

  const fmtWhen = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : '—');

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
          <button className="btn" onClick={() => setConnecting(true)} disabled={!clients.length}>
            <IconPlus />
            Connect Zoom
          </button>
          <button className="btn btn-primary" onClick={() => setAdding(true)} disabled={!clients.length}>
            <IconPlus />
            Add webinar
          </button>
        </div>
      </div>

      <div className="stats" style={{ gridTemplateColumns: 'repeat(4,1fr)' }}>
        {stat('Zoom Sessions', zSessions.length, `${zWebinarCount} webinars · ${zMeetingCount} meetings`)}
        {stat('Total Participants', zParticipants.toLocaleString(), 'across synced sessions')}
        {stat('Avg / Session', zAvg.toLocaleString(), 'participants')}
        {stat('Peak Session', zPeak.toLocaleString(), 'most participants')}
      </div>

      <div className="card">
        <div className="card-h">
          <h3>Zoom accounts</h3>
          <span className="updated">
            {zoomMsg || `${zAccts.length} connected · Sync pulls the last 30 days of webinars & meetings`}
          </span>
        </div>
        <div className="tbl-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Account</th>
                <th>Client</th>
                <th>Sessions</th>
                <th>Last synced</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {zAccts.length ? (
                zAccts.map((a) => (
                  <tr key={a.id}>
                    <td>{a.name}</td>
                    <td style={{ color: 'var(--muted)' }}>{a.client_name}</td>
                    <td className="resp">{a.session_count}</td>
                    <td className="sub">
                      {fmtWhen(a.last_synced_at)}
                      {a.last_sync_error && (
                        <span className="pill down" style={{ marginLeft: 8 }} title={a.last_sync_error}>
                          error
                        </span>
                      )}
                    </td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button
                        className="btn btn-ghost"
                        style={{ padding: '4px 9px', fontSize: 12 }}
                        onClick={() => syncAccount(a.id)}
                        disabled={syncingId === a.id}
                      >
                        {syncingId === a.id ? 'Syncing…' : 'Sync now'}
                      </button>
                      <button
                        className="btn btn-ghost"
                        style={{ padding: '4px 9px', fontSize: 12, color: 'var(--red)' }}
                        onClick={() => removeAccount(a.id)}
                      >
                        Disconnect
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5} style={{ color: 'var(--faint)', padding: '20px' }}>
                    No Zoom accounts connected{filter === 'all' ? '' : ' for this client'}. Click <b>Connect Zoom</b> to add
                    one (you need a client first).
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="card-h">
          <h3>{filter === 'all' ? 'Zoom sessions' : `${filter} — Zoom sessions`}</h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span className="updated">
              {zSessions.length} session{zSessions.length !== 1 ? 's' : ''} synced from Zoom
            </span>
            <button
              className="btn btn-ghost"
              style={{ padding: '4px 10px', fontSize: 12 }}
              onClick={exportSessions}
              disabled={!zSessions.length}
            >
              Export CSV
            </button>
          </div>
        </div>
        <div className="tbl-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Topic</th>
                <th>Type</th>
                <th>Client</th>
                <th>When</th>
                <th>Registrants</th>
                <th>Participants</th>
                <th>Engagement</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7}>
                    <Loading />
                  </td>
                </tr>
              ) : zSessions.length ? (
                zSessions.map((s) => {
                  const isOpen = !!sessionOpen[s.id];
                  const det = sessionDetail[s.id];
                  return (
                    <Fragment key={s.id}>
                      <tr className={`wrow ${isOpen ? 'open' : ''}`} onClick={() => toggleSession(s.id)}>
                        <td>
                          <div className="client">
                            <span className="chev">›</span>
                            {s.topic}
                          </div>
                        </td>
                        <td>
                          <span className={`pill ${s.kind === 'webinar' ? 'healthy' : 'warning'}`}>{s.kind}</span>
                        </td>
                        <td style={{ color: 'var(--muted)' }}>{s.client_name}</td>
                        <td className="sub">{fmtWhen(s.start_time)}</td>
                        <td className="resp">{s.kind === 'webinar' ? s.registrants_count.toLocaleString() : '—'}</td>
                        <td className="resp">{s.participants_count.toLocaleString()}</td>
                        <td>
                          {s.kind === 'webinar' ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                              <div className="track" style={{ width: 80 }}>
                                <i style={{ width: `${s.attendance_pct}%` }} />
                              </div>
                              <span className="resp">{s.attendance_pct}%</span>
                            </div>
                          ) : s.peak_concurrent != null ? (
                            <span className="resp">{s.peak_concurrent.toLocaleString()} peak</span>
                          ) : (
                            <span className="sub" title="Open the row to load engagement">—</span>
                          )}
                        </td>
                      </tr>
                      <tr className={`wdetail ${isOpen ? 'open' : ''}`} style={{ display: isOpen ? 'table-row' : 'none' }}>
                        <td colSpan={7}>
                          <div className="inner">
                            {!det || det.loading ? (
                              <Loading />
                            ) : det.error ? (
                              <div className="form-err">{det.error}</div>
                            ) : !det.data.metrics || det.data.fetched === 0 ? (
                              <div style={{ color: 'var(--faint)' }}>
                                No participant report available (needs the meeting/webinar participant report scope + a paid plan).
                              </div>
                            ) : (
                              <>
                                {det.data.truncated && (
                                  <div style={{ color: 'var(--red)', fontSize: 12, marginBottom: 10 }}>
                                    Based on the first {det.data.fetched.toLocaleString()} of{' '}
                                    {det.data.stored_total.toLocaleString()} join records — counts are partial.
                                  </div>
                                )}
                                <div className="stats" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))' }}>
                                  {(
                                    [
                                      ['Unique participants', det.data.metrics.unique.toLocaleString(), 'distinct people'],
                                      ['Total joins', det.data.metrics.join_events.toLocaleString(), `${det.data.metrics.rejoins.toLocaleString()} rejoins`],
                                      [
                                        'Peak concurrent',
                                        det.data.metrics.peak_concurrent.toLocaleString(),
                                        det.data.metrics.peak_time ? `at ${fmtWhen(det.data.metrics.peak_time)}` : '',
                                      ],
                                      ['Total watch time', `${det.data.metrics.total_duration_min.toLocaleString()} min`, 'all participants'],
                                      ['Avg watch time', `${det.data.metrics.avg_duration_min} min`, 'per unique person'],
                                      [
                                        'Session span',
                                        det.data.metrics.first_join ? fmtWhen(det.data.metrics.first_join) : '—',
                                        det.data.metrics.last_leave ? `→ ${fmtWhen(det.data.metrics.last_leave)}` : '',
                                      ],
                                    ] as [string, string, string][]
                                  ).map(([lbl, val, d]) => (
                                    <div className="stat" key={lbl}>
                                      <div className="top">
                                        <span className="lbl">{lbl}</span>
                                      </div>
                                      <div className="val">{val}</div>
                                      <div className="delta">{d}</div>
                                    </div>
                                  ))}
                                </div>
                                <div style={{ display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
                                  <button
                                    className="btn btn-ghost"
                                    style={{ padding: '4px 10px', fontSize: 12 }}
                                    onClick={() => setShowList((o) => ({ ...o, [s.id]: !o[s.id] }))}
                                  >
                                    {showList[s.id] ? 'Hide participant list' : 'Show participant list'}
                                  </button>
                                  <button
                                    className="btn btn-ghost"
                                    style={{ padding: '4px 10px', fontSize: 12 }}
                                    onClick={() => exportParticipants(s.topic, det.data.participants || [])}
                                    disabled={!det.data.participants?.length}
                                  >
                                    Export participants CSV
                                  </button>
                                </div>
                                {showList[s.id] && det.data.participants?.length ? (
                                  <table className="smatrix" style={{ marginTop: 12 }}>
                                    <thead>
                                      <tr>
                                        <th style={{ textAlign: 'left' }}>Name</th>
                                        <th style={{ textAlign: 'left' }}>Email</th>
                                        <th style={{ textAlign: 'left' }}>Joined</th>
                                        <th style={{ textAlign: 'right' }}>Duration</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {det.data.participants.map((p: any, i: number) => (
                                        <tr key={i}>
                                          <td>{p.name}</td>
                                          <td style={{ color: 'var(--muted)' }}>{p.email || '—'}</td>
                                          <td className="sub">{fmtWhen(p.join_time)}</td>
                                          <td className="num">{p.duration_min != null ? `${p.duration_min} min` : '—'}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                ) : null}
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    </Fragment>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={7} style={{ color: 'var(--faint)', padding: '20px' }}>
                    No Zoom sessions yet. Connect an account and click <b>Sync now</b>.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
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
      {connecting && <ZoomAccountDialog clients={clients} onClose={() => setConnecting(false)} onSaved={load} />}
    </div>
  );
}
