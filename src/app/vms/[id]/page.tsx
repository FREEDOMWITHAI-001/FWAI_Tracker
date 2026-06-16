'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { api } from '@/lib/client';
import { Pill, Gauge, MetricHistoryChart, ResponseHistoryChart, Loading, Empty, StatusSelect, ClientTag, Tag } from '@/components/ui';
import { IconChevronLeft, IconRefresh, IconPlus } from '@/lib/icons';
import { AppDialog } from '@/components/dialogs/app-dialog';
import { APP_STATUS_LABEL, type VM, type VmMetric, type App } from '@/lib/types';

type VMRow = VM & { client_name: string };

const RANGES = [
  { value: '1h', label: 'Last 1 hour' },
  { value: '4h', label: 'Last 4 hours' },
  { value: '12h', label: 'Last 12 hours' },
  { value: '1d', label: 'Last 1 day' },
  { value: '3d', label: 'Last 3 days' },
  { value: '1w', label: 'Last 1 week' },
  { value: '1m', label: 'Last 1 month' },
  { value: 'all', label: 'All time' },
];

export default function VMDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [vm, setVm] = useState<VMRow | null>(null);
  const [metrics, setMetrics] = useState<VmMetric[]>([]);
  const [range, setRange] = useState('1d');
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [checking, setChecking] = useState(false);
  const [note, setNote] = useState('');
  const [apps, setApps] = useState<(App & { client_name: string })[]>([]);
  const [addApp, setAddApp] = useState(false);
  const [checkingApp, setCheckingApp] = useState<string | null>(null);

  const loadApps = useCallback(async () => {
    try {
      const all = await api.get<(App & { client_name: string })[]>('/api/apps');
      setApps(all.filter((a) => a.vm_id === id));
    } catch {
      /* ignore */
    }
  }, [id]);

  const loadMetrics = useCallback(
    async (r: string) => {
      const m = await api.get<VmMetric[]>(`/api/vms/${id}/metrics?range=${r}`);
      setMetrics(m);
    },
    [id]
  );

  const load = useCallback(async () => {
    try {
      const [v] = await Promise.all([api.get<VMRow>(`/api/vms/${id}`), loadMetrics(range), loadApps()]);
      setVm(v);
    } catch {
      setNotFound(true);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, loadMetrics, loadApps]);

  useEffect(() => {
    load();
  }, [load]);

  // refetch just the history when the range changes (after first load)
  useEffect(() => {
    if (!loading) loadMetrics(range).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range]);

  // live auto-refresh: re-pull the VM + history every 10s while the page is open
  useEffect(() => {
    if (loading) return;
    const tick = async () => {
      try {
        const [v, m] = await Promise.all([
          api.get<VMRow>(`/api/vms/${id}`),
          api.get<VmMetric[]>(`/api/vms/${id}/metrics?range=${range}`),
        ]);
        setVm(v);
        setMetrics(m);
      } catch {
        /* ignore transient errors */
      }
    };
    const t = setInterval(tick, 300000); // refresh the open page every 5 min
    return () => clearInterval(t);
  }, [id, range, loading]);

  const checkNow = async () => {
    if (!vm) return;
    setChecking(true);
    setNote('');
    try {
      if (vm.source === 'cloud' && vm.cloud_account_id) {
        await api.post(`/api/cloud-accounts/${vm.cloud_account_id}/sync`, {});
      } else {
        await api.post(`/api/vms/${id}/check`, {});
      }
      await load();
      setNote(`updated ${new Date().toLocaleTimeString()}`);
    } catch (e: any) {
      setNote(e.message);
    } finally {
      setChecking(false);
    }
  };

  if (loading) return <Loading label="Loading VM…" />;
  if (notFound || !vm)
    return (
      <div className="page">
        <Link className="crumb" href="/vms">
          <IconChevronLeft /> Back to VM status
        </Link>
        <Empty>VM not found.</Empty>
      </div>
    );

  const down = vm.status === 'down';
  const isCloud = vm.source === 'cloud';
  const mode: 'metrics' | 'response' | 'none' = isCloud || vm.health_url || vm.has_ssh ? 'metrics' : vm.port ? 'response' : 'none';
  // Memory/Disk are only real when read from inside the box (SSH) or reported
  // by a Health-URL agent. A cloud-only VM gives CPU from the provider but no
  // mem/disk — show those as "n/a" rather than a misleading 0%.
  const realMemDisk = vm.has_ssh || !!vm.health_url;
  const lastChecked = vm.last_checked_at ? new Date(vm.last_checked_at).toLocaleString() : 'never';

  return (
    <div className="page">
      <Link className="crumb" href="/vms">
        <IconChevronLeft /> Back to VM status
      </Link>

      <div className="cd-head">
        <div>
          <h1 className="mono" style={{ fontSize: 20 }}>
            {vm.name}
          </h1>
          <div className="sub">
            {vm.client_name} · {vm.provider}
            {vm.region ? ` · ${vm.region}` : ''}
          </div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 10, alignItems: 'center' }}>
          <Pill status={vm.status} />
          <button
            className="btn"
            onClick={checkNow}
            disabled={checking || (!isCloud && !vm.port && !vm.health_url && !vm.has_ssh)}
            title={isCloud || vm.port || vm.health_url || vm.has_ssh ? '' : 'No SSH key, port or Health URL set'}
          >
            <IconRefresh />
            {checking ? (isCloud ? 'Syncing…' : 'Checking…') : isCloud ? 'Sync now' : 'Check now'}
          </button>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-h">
          <h3>Current load</h3>
          <span className="updated">{note || (isCloud ? 'CPU from cloud — Sync to refresh' : `last checked ${lastChecked}`)}</span>
        </div>
        <div className="card-b">
          <div className="meta-row">
            <span>
              {isCloud ? 'Source:' : 'Check:'}{' '}
              <b>{isCloud ? `${vm.provider} (cloud account)` : vm.has_ssh ? `SSH ${vm.ssh_user || ''}@${vm.host || '?'}:${vm.ssh_port || 22}` : vm.port ? `${vm.host || '?'}:${vm.port}` : vm.health_url ? vm.health_url : 'not set'}</b>
            </span>
            <span>
              Response: <b>{down ? '—' : vm.last_response_ms != null ? `${vm.last_response_ms} ms` : 'n/a'}</b>
            </span>
          </div>
          {mode === 'metrics' ? (
            <div className="gauge-row" style={{ marginTop: 14 }}>
              <Gauge value={vm.cpu} label="CPU" />
              <Gauge value={vm.mem} label="Memory" na={!realMemDisk} />
              <Gauge value={vm.disk} label="Disk" na={!realMemDisk} />
            </div>
          ) : mode === 'response' ? (
            <div className="gauge-row" style={{ marginTop: 14 }}>
              <div className="stat" style={{ flex: 1, minWidth: 190 }}>
                <div className="top">
                  <span className="lbl">Reachability</span>
                </div>
                <div className="val" style={{ color: down ? 'var(--red)' : 'var(--green)' }}>{down ? 'Down' : 'Up'}</div>
                <div className="delta">{vm.host}:{vm.port}</div>
              </div>
              <div className="stat" style={{ flex: 1, minWidth: 190 }}>
                <div className="top">
                  <span className="lbl">Response time</span>
                </div>
                <div className="val">
                  {down || vm.last_response_ms == null ? '—' : vm.last_response_ms}
                  <span style={{ fontSize: 14, color: 'var(--muted)' }}> ms</span>
                </div>
                <div className="delta">last checked {lastChecked}</div>
              </div>
            </div>
          ) : null}
          {isCloud ? (
            <div className="hint" style={{ marginTop: 14, color: 'var(--faint)' }}>
              Imported from a cloud account. The background scheduler <b>re-syncs this automatically every few minutes</b> —
              CPU comes from the provider; memory/disk need an in-VM agent. The history graph fills as syncs run.
            </div>
          ) : mode === 'response' ? (
            <div className="hint" style={{ marginTop: 14, color: 'var(--faint)' }}>
              A port check tracks <b>up/down + response time</b> (graphed below). CPU/memory/disk live inside the VM — to
              see them, point a <b>Health URL</b> at an agent that reports them, or connect a cloud account.
            </div>
          ) : mode === 'none' ? (
            <div className="hint" style={{ marginTop: 14, color: 'var(--faint)' }}>
              Set a <b>Host + Port</b> on this VM (Edit) to track live up/down and response time. CPU/memory/disk gauges
              fill in only from a Health URL that returns <span className="mono">{'{ "cpu": 34, "mem": 58, "disk": 61 }'}</span>{' '}
              or from a connected cloud account.
            </div>
          ) : null}
        </div>
      </div>

      <div className="card">
        <div className="card-h">
          <h3>{mode === 'response' ? 'History — Response time' : 'History — CPU / Memory / Disk'}</h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span className="updated">
              {metrics.length} sample{metrics.length !== 1 ? 's' : ''}
            </span>
            <StatusSelect value={range} onChange={setRange} options={RANGES} />
          </div>
        </div>
        <div className="card-b">
          {mode === 'response' ? <ResponseHistoryChart samples={metrics} /> : <MetricHistoryChart samples={metrics} />}
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-h">
          <h3>Applications on this VM</h3>
          <button className="btn btn-ghost" style={{ padding: '5px 10px', fontSize: 12.5 }} onClick={() => setAddApp(true)}>
            <IconPlus /> Add application
          </button>
        </div>
        <div className="tbl-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Application</th>
                <th>Type</th>
                <th>Status</th>
                <th>Response</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {apps.length ? (
                apps.map((a) => (
                  <tr key={a.id}>
                    <td className="mono" style={{ fontSize: 12.5 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Link href={`/apps/${a.id}`} style={{ color: 'var(--blue-600)' }}>
                          {a.name}
                        </Link>
                        <Tag label={a.tag} />
                      </div>
                    </td>
                    <td>
                      <span className="pill neutral">{a.type}</span>
                    </td>
                    <td>
                      <Pill status={a.status} label={APP_STATUS_LABEL[a.status]} />
                    </td>
                    <td className="resp">{a.status === 'down' || a.last_response_ms == null ? '—' : `${a.last_response_ms} ms`}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <Link className="btn btn-ghost" href={`/apps/${a.id}`} style={{ padding: '4px 9px', fontSize: 12 }}>
                        Open
                      </Link>
                      <button
                        className="btn btn-ghost"
                        style={{ padding: '4px 9px', fontSize: 12 }}
                        disabled={checkingApp === a.id || (!a.check_url && !(a.check_host && a.check_port))}
                        onClick={async () => {
                          setCheckingApp(a.id);
                          try {
                            await api.post(`/api/apps/${a.id}/check`, {});
                            await loadApps();
                          } catch {
                            /* ignore */
                          } finally {
                            setCheckingApp(null);
                          }
                        }}
                      >
                        {checkingApp === a.id ? 'Checking…' : 'Check'}
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5} style={{ color: 'var(--faint)', padding: '20px' }}>
                    No applications on this VM yet. Add one (monitored by URL or host:port).
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {addApp && (
        <AppDialog
          clientId={vm.client_id}
          clientName={vm.client_name}
          vmId={vm.id}
          vms={[vm as any]}
          onClose={() => setAddApp(false)}
          onSaved={loadApps}
        />
      )}
    </div>
  );
}