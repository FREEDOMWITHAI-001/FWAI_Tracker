'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { api } from '@/lib/client';
import { Pill, ResponseHistoryChart, Loading, Empty, StatusSelect, ClientTag, Tag } from '@/components/ui';
import { IconChevronLeft, IconRefresh } from '@/lib/icons';
import { APP_STATUS_LABEL, type App, type AppMetric } from '@/lib/types';

type AppRow = App & { client_name: string };

const RANGES = [
  { value: '1d', label: 'Last 1 day' },
  { value: '3d', label: 'Last 3 days' },
  { value: '1w', label: 'Last 1 week' },
  { value: '1m', label: 'Last 1 month' },
  { value: 'all', label: 'All time' },
];

export default function AppDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [app, setApp] = useState<AppRow | null>(null);
  const [metrics, setMetrics] = useState<AppMetric[]>([]);
  const [range, setRange] = useState('1d');
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [checking, setChecking] = useState(false);
  const [note, setNote] = useState('');

  const loadMetrics = useCallback(
    async (r: string) => {
      const m = await api.get<AppMetric[]>(`/api/apps/${id}/metrics?range=${r}`);
      setMetrics(m);
    },
    [id]
  );

  const load = useCallback(async () => {
    try {
      const [a] = await Promise.all([api.get<AppRow>(`/api/apps/${id}`), loadMetrics(range)]);
      setApp(a);
    } catch {
      setNotFound(true);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, loadMetrics]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!loading) loadMetrics(range).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range]);

  // live auto-refresh: re-pull the app + history every 10s while the page is open
  useEffect(() => {
    if (loading) return;
    const tick = async () => {
      try {
        const [a, m] = await Promise.all([
          api.get<AppRow>(`/api/apps/${id}`),
          api.get<AppMetric[]>(`/api/apps/${id}/metrics?range=${range}`),
        ]);
        setApp(a);
        setMetrics(m);
      } catch {
        /* ignore transient errors */
      }
    };
    const t = setInterval(tick, 300000); // refresh the open page every 5 min
    return () => clearInterval(t);
  }, [id, range, loading]);

  const checkNow = async () => {
    if (!app) return;
    setChecking(true);
    setNote('');
    try {
      await api.post(`/api/apps/${id}/check`, {});
      await load();
      setNote(`checked ${new Date().toLocaleTimeString()}`);
    } catch (e: any) {
      setNote(e.message);
    } finally {
      setChecking(false);
    }
  };

  if (loading) return <Loading label="Loading application…" />;
  if (notFound || !app)
    return (
      <div className="page">
        <Link className="crumb" href="/clients">
          <IconChevronLeft /> Back
        </Link>
        <Empty>Application not found.</Empty>
      </div>
    );

  const down = app.status === 'down';
  const hasSshTunnel = !!(app.vm_id && app.check_port);
  const hasCheck = !!app.check_url || !!(app.check_host && app.check_port) || hasSshTunnel;
  const target = hasSshTunnel
    ? `port ${app.check_port} via VM SSH`
    : app.check_url || (app.check_host ? `${app.check_host}:${app.check_port}` : 'not set');
  const lastChecked = app.last_checked_at ? new Date(app.last_checked_at).toLocaleString() : 'never';

  return (
    <div className="page">
      <Link className="crumb" href={`/clients/${app.client_id}`}>
        <IconChevronLeft /> Back to {app.client_name}
      </Link>

      <div className="cd-head">
        <div>
          <h1 style={{ fontSize: 21 }}>{app.name}</h1>
          <div className="sub" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <ClientTag name={app.client_name} />
            <Tag label={app.tag} />
            <span>{app.type}</span>
          </div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 10, alignItems: 'center' }}>
          <Pill status={app.status} label={APP_STATUS_LABEL[app.status]} />
          <button className="btn" onClick={checkNow} disabled={checking || !hasCheck} title={hasCheck ? '' : 'No Check URL, host:port, or VM+port set'}>
            <IconRefresh />
            {checking ? 'Checking…' : 'Check now'}
          </button>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-h">
          <h3>Status</h3>
          <span className="updated">{note || `last checked ${lastChecked}`}</span>
        </div>
        <div className="card-b">
          <div className="meta-row">
            <span>
              Checking: <b>{target}</b>
            </span>
            <span>
              Response: <b>{down || app.last_response_ms == null ? '—' : `${app.last_response_ms} ms`}</b>
            </span>
            <span>
              Health: <b>{app.health || 'n/a'}</b>
            </span>
          </div>
          {!hasCheck && (
            <div className="hint" style={{ marginTop: 12, color: 'var(--faint)' }}>
              Set a <b>Check URL</b>, host + port, or pick a host VM + port on this app (Edit) to track live up/down and response time.
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-h">
          <h3>History — Response time</h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span className="updated">
              {metrics.length} sample{metrics.length !== 1 ? 's' : ''}
            </span>
            <StatusSelect value={range} onChange={setRange} options={RANGES} />
          </div>
        </div>
        <div className="card-b">
          <ResponseHistoryChart samples={metrics} />
        </div>
      </div>
    </div>
  );
}