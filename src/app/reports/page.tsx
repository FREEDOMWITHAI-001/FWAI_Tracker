'use client';

import { useEffect, useState, useCallback } from 'react';
import { api } from '@/lib/client';
import { LineChart, Meter, Loading, Empty } from '@/components/ui';
import type { ClientSummary, App, Alert } from '@/lib/types';

export default function ReportsPage() {
  const [clients, setClients] = useState<ClientSummary[]>([]);
  const [apps, setApps] = useState<(App & { client_name: string })[]>([]);
  const [alerts, setAlerts] = useState<(Alert & { client_name: string | null })[]>([]);
  const [series, setSeries] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [c, a, al, s] = await Promise.all([
      api.get<ClientSummary[]>('/api/clients'),
      api.get<(App & { client_name: string })[]>('/api/apps'),
      api.get<(Alert & { client_name: string | null })[]>('/api/alerts'),
      api.get<number[]>('/api/uptime'),
    ]);
    setClients(c);
    setApps(a);
    setAlerts(al);
    setSeries(s);
    setLoading(false);
  }, []);

  useEffect(() => {
    load().catch(() => setLoading(false));
  }, [load]);

  if (loading) return <Loading label="Building reports…" />;

  const summary = clients.map((c) => {
    const cApps = apps.filter((a) => a.client_id === c.id);
    const respVals = cApps.filter((a) => a.resp_ms > 0).map((a) => a.resp_ms);
    const avgResp = respVals.length ? Math.round(respVals.reduce((s, v) => s + v, 0) / respVals.length) : 0;
    const incidents = cApps.filter((a) => a.status !== 'healthy').length;
    const sent = alerts.filter((a) => a.client_id === c.id).length;
    return { name: c.name, uptime: c.avg_uptime, incidents, avgResp, sent };
  });

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Reports</h1>
          <div className="sub">Uptime and reliability summary across clients.</div>
        </div>
      </div>

      <div className="grid-2 even">
        <div className="card">
          <div className="card-h">
            <h3>Fleet uptime</h3>
          </div>
          <div className="card-b">
            <LineChart series={series} height={200} />
          </div>
        </div>
        <div className="card">
          <div className="card-h">
            <h3>Uptime by client</h3>
          </div>
          <div className="card-b">
            {clients.length ? (
              clients.map((c) => (
                <Meter key={c.id} name={c.name} pct={c.avg_uptime} color={c.avg_uptime < 98 ? 'var(--amber)' : 'var(--blue)'} />
              ))
            ) : (
              <Empty>No clients yet.</Empty>
            )}
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-h">
          <h3>Reliability summary</h3>
        </div>
        <div className="tbl-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Client</th>
                <th>Uptime</th>
                <th>Incidents</th>
                <th>Avg Response</th>
                <th>Alerts Sent</th>
              </tr>
            </thead>
            <tbody>
              {summary.length ? (
                summary.map((r) => (
                  <tr key={r.name}>
                    <td className="client">{r.name}</td>
                    <td className="resp">{r.uptime}%</td>
                    <td className="resp" style={{ color: r.incidents ? 'var(--red)' : 'var(--muted)' }}>
                      {r.incidents}
                    </td>
                    <td className="resp">{r.avgResp ? `${r.avgResp} ms` : '—'}</td>
                    <td className="resp">{r.sent}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5} style={{ color: 'var(--faint)', padding: '26px 20px' }}>
                    No data yet — add clients and applications to populate this report.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
