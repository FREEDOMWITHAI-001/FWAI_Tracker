'use client';

import { useEffect, useState, useCallback, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { api } from '@/lib/client';
import { Pill, Loading, StatusSelect } from '@/components/ui';
import { ClientDialog } from '@/components/dialogs/client-dialog';
import { IconInfo, IconPlus, IconRefresh, IconSearch } from '@/lib/icons';
import type { ClientSummary } from '@/lib/types';

function ClientsInner() {
  const params = useSearchParams();
  const [clients, setClients] = useState<ClientSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState(params.get('q') ?? '');
  const [filter, setFilter] = useState('all');
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    const c = await api.get<ClientSummary[]>('/api/clients');
    setClients(c);
    setLoading(false);
  }, []);

  useEffect(() => {
    load().catch(() => setLoading(false));
  }, [load]);

  const list = clients.filter(
    (c) => (filter === 'all' || c.overall_status === filter) && c.name.toLowerCase().includes(q.toLowerCase())
  );

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Clients</h1>
          <div className="sub">Each company and the projects you monitor for them — click a client to open it.</div>
        </div>
        <button className="btn btn-primary" onClick={() => setAdding(true)}>
          <IconPlus />
          Add client
        </button>
      </div>

      <div className="tip">
        <IconInfo />
        Tip: click any client row to open it and see all of that client&apos;s projects and statuses.
      </div>

      <div className="toolbar" style={{ marginBottom: 16 }}>
        <div className="search" style={{ maxWidth: 300 }}>
          <IconSearch />
          <input placeholder="Search clients…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <StatusSelect
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'All statuses' },
            { value: 'healthy', label: 'Healthy' },
            { value: 'warning', label: 'Warning' },
            { value: 'down', label: 'Down' },
          ]}
        />
        <button className="btn" onClick={() => load()}>
          <IconRefresh />
          Refresh
        </button>
      </div>

      <div className="card">
        <div className="tbl-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Client</th>
                <th>Industry</th>
                <th>Projects</th>
                <th>Healthy</th>
                <th>Issues</th>
                <th>Overall Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7}>
                    <Loading />
                  </td>
                </tr>
              ) : list.length ? (
                list.map((c) => (
                  <tr key={c.id} className="row-link">
                    <td>
                      <Link href={`/clients/${c.id}`}>
                        <div className="client" style={{ color: 'var(--blue-600)' }}>
                          {c.name}
                        </div>
                      </Link>
                    </td>
                    <td style={{ color: 'var(--muted)' }}>{c.industry || '—'}</td>
                    <td className="resp">{c.project_count}</td>
                    <td className="resp" style={{ color: 'var(--green)' }}>
                      {c.healthy_count}
                    </td>
                    <td className="resp" style={{ color: c.issue_count ? 'var(--red)' : 'var(--muted)' }}>
                      {c.issue_count}
                    </td>
                    <td>
                      <Pill status={c.overall_status} />
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <Link href={`/clients/${c.id}`} style={{ color: 'var(--faint)', fontSize: 18 }}>
                        ›
                      </Link>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} style={{ color: 'var(--faint)', padding: '26px 20px' }}>
                    {clients.length ? 'No clients match your filters.' : 'No clients yet — add your first one.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {adding && <ClientDialog onClose={() => setAdding(false)} onSaved={load} />}
    </div>
  );
}

export default function ClientsPage() {
  return (
    <Suspense fallback={<Loading />}>
      <ClientsInner />
    </Suspense>
  );
}
