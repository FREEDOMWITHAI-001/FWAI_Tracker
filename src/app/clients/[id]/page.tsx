'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { api } from '@/lib/client';
import { Pill, StatCard, LineChart, AlertItem, Loading, Empty, BarGauge } from '@/components/ui';
import { ClientDialog } from '@/components/dialogs/client-dialog';
import { VMDialog } from '@/components/dialogs/vm-dialog';
import { AppDialog } from '@/components/dialogs/app-dialog';
import { IconChevronLeft, IconPlus } from '@/lib/icons';
import {
  initials,
  rollupStatus,
  APP_STATUS_LABEL,
  type ClientFull,
  type Status,
  type VM,
  type App,
} from '@/lib/types';

export default function ClientDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [client, setClient] = useState<ClientFull | null>(null);
  const [series, setSeries] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [editClient, setEditClient] = useState(false);
  const [addVM, setAddVM] = useState(false);
  const [editVM, setEditVM] = useState<VM | null>(null);
  const [addApp, setAddApp] = useState(false);
  const [editApp, setEditApp] = useState<App | null>(null);
  const [checkingApp, setCheckingApp] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [c, s] = await Promise.all([
        api.get<ClientFull>(`/api/clients/${id}`),
        api.get<number[]>(`/api/uptime?client_id=${id}`),
      ]);
      setClient(c);
      setSeries(s);
    } catch {
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const removeClient = async () => {
    if (!confirm('Delete this client and all of its VMs, apps and webinars? This cannot be undone.')) return;
    await api.del(`/api/clients/${id}`);
    router.push('/clients');
  };
  const removeVM = async (vmId: string) => {
    if (!confirm('Delete this VM?')) return;
    await api.del(`/api/vms/${vmId}`);
    load();
  };
  const removeApp = async (appId: string) => {
    if (!confirm('Delete this application?')) return;
    await api.del(`/api/apps/${appId}`);
    load();
  };
  const checkApp = async (appId: string) => {
    setCheckingApp(appId);
    try {
      await api.post(`/api/apps/${appId}/check`, {});
      await load();
    } catch {
      /* ignore — surfaced on the app's detail page */
    } finally {
      setCheckingApp(null);
    }
  };

  if (loading) return <Loading label="Loading client…" />;
  if (notFound || !client)
    return (
      <div className="page">
        <Link className="crumb" href="/clients">
          <IconChevronLeft /> Back
        </Link>
        <Empty>Client not found.</Empty>
      </div>
    );

  const apps = client.apps ?? [];
  const vms = client.vms ?? [];
  const alerts = (client.alerts ?? []).slice().sort((a, b) => b.created_at.localeCompare(a.created_at));
  const healthy = apps.filter((a) => a.status === 'healthy').length;
  const issues = apps.length - healthy;
  const overall: Status = apps.length ? rollupStatus(apps.map((a) => a.status)) : 'healthy';
  const avgUp = apps.length ? (apps.reduce((s, a) => s + Number(a.uptime), 0) / apps.length).toFixed(1) : '—';
  const overallLabel = overall === 'healthy' ? 'All operational' : overall === 'warning' ? 'Degraded' : 'Issue detected';

  return (
    <div className="page">
      <Link className="crumb" href="/clients">
        <IconChevronLeft /> Back
      </Link>

      <div className="cd-head">
        <div className="big-avatar">{initials(client.name)}</div>
        <div>
          <h1>{client.name}</h1>
          <div className="sub">
            {(client.industry || 'Client') + ' · ' + apps.length + ' projects'}
          </div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 10, alignItems: 'center' }}>
          <Pill status={overall} label={overallLabel} />
          <button className="btn" onClick={() => setEditClient(true)}>
            Edit
          </button>
          <button className="btn btn-danger" onClick={removeClient}>
            Delete
          </button>
        </div>
      </div>

      <div className="stats" style={{ gridTemplateColumns: 'repeat(4,1fr)' }}>
        <StatCard label="Projects" value={apps.length} delta="monitored" />
        <StatCard label="Healthy" value={healthy} delta="running fine" />
        <StatCard label="Issues" value={issues} delta={issues ? 'need attention' : 'all clear'} />
        <StatCard label="Avg Uptime" value={typeof avgUp === 'string' && avgUp !== '—' ? avgUp + '%' : avgUp} delta="last 14 days" />
      </div>

      <div className="section-label">
        <span>Projects</span>
        <button className="btn btn-primary" onClick={() => setAddApp(true)} style={{ padding: '7px 12px', fontSize: 13 }}>
          <IconPlus /> Add application
        </button>
      </div>
      {apps.length ? (
        <div className="proj-grid">
          {apps.map((p) => (
            <div className="proj" key={p.id}>
              <div className="pt">
                <div>
                  <div className="pn">{p.name}</div>
                  <div className="pty">{p.type}</div>
                </div>
                <Pill status={p.status} label={APP_STATUS_LABEL[p.status]} />
              </div>
              <div className="pm">
                <span className="k">Host</span>
                <span className="v">{p.host || '—'}</span>
              </div>
              <div className="pm">
                <span className="k">Health check</span>
                <span
                  className="v"
                  style={{ color: p.status === 'healthy' ? 'var(--muted)' : p.status === 'warning' ? 'var(--amber)' : 'var(--red)' }}
                >
                  {p.health || '—'}
                </span>
              </div>
              <div className="pm">
                <span className="k">Response</span>
                <span className="v" style={{ color: p.status === 'down' ? 'var(--red)' : 'var(--muted)' }}>
                  {p.resp_ms > 0 ? p.resp_ms + ' ms' : '—'}
                </span>
              </div>
              <div className="pm" style={{ borderBottom: 'none' }}>
                <span className="k">Uptime (14d)</span>
                <span className="v">{Number(p.uptime)}%</span>
              </div>
              <div className="pactions">
                <Link className="btn btn-ghost" href={`/apps/${p.id}`} style={{ padding: '5px 10px', fontSize: 12.5 }}>
                  Open
                </Link>
                <button
                  className="btn btn-ghost"
                  style={{ padding: '5px 10px', fontSize: 12.5 }}
                  disabled={checkingApp === p.id || (!p.check_url && !(p.check_host && p.check_port))}
                  title={p.check_url || (p.check_host && p.check_port) ? '' : 'Add a Check URL or host:port (Edit)'}
                  onClick={() => checkApp(p.id)}
                >
                  {checkingApp === p.id ? 'Checking…' : 'Check'}
                </button>
                <button className="btn btn-ghost" style={{ padding: '5px 10px', fontSize: 12.5 }} onClick={() => setEditApp(p)}>
                  Edit
                </button>
                <button className="btn btn-ghost" style={{ padding: '5px 10px', fontSize: 12.5, color: 'var(--red)' }} onClick={() => removeApp(p.id)}>
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="card" style={{ marginBottom: 18 }}>
          <Empty>No applications yet. Add the first project for this client.</Empty>
        </div>
      )}

      <div className="section-label">
        <span>VMs</span>
        <button className="btn btn-primary" onClick={() => setAddVM(true)} style={{ padding: '7px 12px', fontSize: 13 }}>
          <IconPlus /> Add VM
        </button>
      </div>
      <div className="card" style={{ marginBottom: 18 }}>
        <div className="tbl-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>VM / Instance</th>
                <th>Type</th>
                <th>Status</th>
                <th>CPU</th>
                <th>Memory</th>
                <th>Disk</th>
                <th>Uptime</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {vms.length ? (
                vms.map((v) => {
                  return (
                    <tr key={v.id}>
                      <td className="mono" style={{ fontSize: 12.5 }}>
                        <Link href={`/vms/${v.id}`} style={{ color: 'var(--blue-600)' }}>
                          {v.name}
                        </Link>
                        <div className="sub">{v.region}</div>
                      </td>
                      <td>
                        <span className="pill neutral">{v.provider}</span>
                      </td>
                      <td>
                        <Pill status={v.status} />
                      </td>
                      <td>
                        <BarGauge value={v.cpu} down={v.status === 'down'} width={56} />
                      </td>
                      <td>
                        <BarGauge value={v.mem} down={v.status === 'down'} width={56} />
                      </td>
                      <td>
                        <BarGauge value={v.disk} down={v.status === 'down'} width={56} />
                      </td>
                      <td className="sub mono">{v.uptime_label || '—'}</td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <button className="btn btn-ghost" style={{ padding: '4px 9px', fontSize: 12 }} onClick={() => setEditVM(v)}>
                          Edit
                        </button>
                        <button className="btn btn-ghost" style={{ padding: '4px 9px', fontSize: 12, color: 'var(--red)' }} onClick={() => removeVM(v.id)}>
                          Delete
                        </button>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={8} style={{ color: 'var(--faint)', padding: '24px 20px' }}>
                    No VMs for this client yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-h">
            <h3>Recent alerts for this client</h3>
          </div>
          <div className="alert-list">
            {alerts.length ? alerts.slice(0, 6).map((a) => <AlertItem key={a.id} alert={a} clientName={null} />) : <Empty>No recent alerts for this client.</Empty>}
          </div>
        </div>
        <div className="card">
          <div className="card-h">
            <h3>Uptime — last 14 days</h3>
          </div>
          <div className="card-b">
            <LineChart series={series} height={180} />
          </div>
        </div>
      </div>

      {editClient && <ClientDialog initial={client} onClose={() => setEditClient(false)} onSaved={load} />}
      {addVM && <VMDialog clientId={client.id} onClose={() => setAddVM(false)} onSaved={load} />}
      {editVM && <VMDialog initial={editVM} onClose={() => setEditVM(null)} onSaved={load} />}
      {addApp && <AppDialog clientId={client.id} vms={vms} onClose={() => setAddApp(false)} onSaved={load} />}
      {editApp && <AppDialog initial={editApp} vms={vms} onClose={() => setEditApp(null)} onSaved={load} />}
    </div>
  );
}