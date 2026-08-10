'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { api } from '@/lib/client';
import {
  StatCard,
  LineChart,
  StatusDonut,
  Pill,
  AlertItem,
  Loading,
  LoadError,
  Empty,
} from '@/components/ui';
import {
  IconUsersStat,
  IconVM,
  IconCheck,
  IconXCircle,
  IconWhatsApp,
  IconZoom,
} from '@/lib/icons';
import { APP_STATUS_LABEL, type ClientSummary, type VM, type App, type Alert, type Webinar } from '@/lib/types';

export default function DashboardPage() {
  const [loading, setLoading] = useState(true);
  const [clients, setClients] = useState<ClientSummary[]>([]);
  const [vms, setVms] = useState<VM[]>([]);
  const [apps, setApps] = useState<(App & { client_name: string })[]>([]);
  const [alerts, setAlerts] = useState<(Alert & { client_name: string | null })[]>([]);
  const [webinars, setWebinars] = useState<Webinar[]>([]);
  const [series, setSeries] = useState<number[]>([]);
  const [updated, setUpdated] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    const [c, v, a, al, w, s] = await Promise.all([
      api.get<ClientSummary[]>('/api/clients'),
      api.get<VM[]>('/api/vms'),
      api.get<(App & { client_name: string })[]>('/api/apps'),
      api.get<(Alert & { client_name: string | null })[]>('/api/alerts'),
      api.get<Webinar[]>('/api/webinars'),
      api.get<number[]>('/api/uptime'),
    ]);
    setClients(c);
    setVms(v);
    setApps(a);
    setAlerts(al);
    setWebinars(w);
    setSeries(s);
    setUpdated(new Date().toLocaleTimeString());
    setLoading(false);
  }, []);

  // A failed load must NOT fall through to the zero-state render below: empty
  // stat cards and "All quiet" would describe a healthy idle fleet, which is the
  // opposite of what just happened.
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

  if (loading) return <Loading label="Loading dashboard…" />;
  if (error) return <LoadError error={error} what="the dashboard" onRetry={reload} />;

  const activeVMs = vms.filter((v) => v.status !== 'down').length;
  const running = apps.filter((a) => a.status === 'healthy').length;
  const failed = apps.filter((a) => a.status === 'down').length;
  const waSent = alerts.filter((a) => a.whatsapp_sent).length;

  const healthy = apps.filter((a) => a.status === 'healthy').length;
  const warn = apps.filter((a) => a.status === 'warning').length;
  const down = apps.filter((a) => a.status === 'down').length;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Dashboard</h1>
          <div className="sub">Overview of all clients, VMs, applications and alerts.</div>
        </div>
        <div className="toolbar">
          <span className="updated">updated {updated}</span>
        </div>
      </div>

      <div className="stats">
        <StatCard label="Total Clients" value={clients.length} delta="companies monitored" icon={<IconUsersStat />} />
        <StatCard label="Active VMs" value={`${activeVMs} / ${vms.length}`} delta="machines reachable" icon={<IconVM />} tone="green" />
        <StatCard label="Running Applications" value={running} delta={`of ${apps.length} monitored`} icon={<IconCheck />} tone="green" />
        <StatCard label="Failed Applications" value={failed} delta="needs attention" icon={<IconXCircle />} tone="red" />
        <StatCard label="WhatsApp Alerts Sent" value={waSent} delta="delivered" icon={<IconWhatsApp />} tone="wa" />
        <StatCard label="Zoom Webinars" value={webinars.length} delta="tracked" icon={<IconZoom />} tone="amber" />
      </div>

      <div className="grid-2 even">
        <div className="card">
          <div className="card-h">
            <h3>Uptime — last 14 days</h3>
          </div>
          <div className="card-b">
            <LineChart series={series} />
          </div>
        </div>
        <div className="card">
          <div className="card-h">
            <h3>System status</h3>
          </div>
          <div className="card-b">
            {apps.length ? (
              <StatusDonut healthy={healthy} warning={warn} down={down} />
            ) : (
              <Empty>No applications yet — add some from a client&apos;s page.</Empty>
            )}
          </div>
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-h">
            <h3>Client monitoring</h3>
            <Link className="link" href="/clients">
              View all →
            </Link>
          </div>
          <div className="tbl-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Industry</th>
                  <th>Projects</th>
                  <th>Issues</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {clients.length ? (
                  clients.slice(0, 6).map((c) => (
                    <tr key={c.id}>
                      <td>
                        <Link className="client row-link" href={`/clients/${c.id}`}>
                          {c.name}
                        </Link>
                      </td>
                      <td style={{ color: 'var(--muted)' }}>{c.industry || '—'}</td>
                      <td className="resp">{c.project_count}</td>
                      <td className="resp" style={{ color: c.issue_count ? 'var(--red)' : 'var(--muted)' }}>
                        {c.issue_count}
                      </td>
                      <td>
                        <Pill status={c.overall_status} />
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5} style={{ color: 'var(--faint)', padding: '26px 20px' }}>
                      No clients yet. Add your first client on the Clients page.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <div className="card-h">
            <h3>Recent alerts</h3>
            <Link className="link" href="/alerts">
              View all →
            </Link>
          </div>
          <div className="alert-list">
            {alerts.length ? (
              alerts.slice(0, 4).map((a) => <AlertItem key={a.id} alert={a} />)
            ) : (
              <Empty>No alerts. All quiet.</Empty>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
