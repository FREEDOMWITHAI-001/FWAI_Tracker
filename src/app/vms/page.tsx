'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import { api } from '@/lib/client';
import { Pill, Loading, StatusSelect, BarGauge, Tag } from '@/components/ui';
import { VMDialog } from '@/components/dialogs/vm-dialog';
import { IconPlus, IconRefresh } from '@/lib/icons';
import type { VM, Client } from '@/lib/types';

type VMRow = VM & { client_name: string };

export default function VMsPage() {
  const [vms, setVms] = useState<VMRow[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<VM | null>(null);
  const [checking, setChecking] = useState(false);
  const [auto, setAuto] = useState(false);
  const [note, setNote] = useState('');
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    const [v, c] = await Promise.all([
      api.get<VMRow[]>('/api/vms'),
      api.get<Client[]>('/api/clients'),
    ]);
    setVms(v);
    setClients(c);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const checkAll = useCallback(async () => {
    setChecking(true);
    setNote('');
    try {
      const r = await api.post<{ checked: number }>(`/api/vms/check-all`, {});
      setNote(`checked ${r.checked} · ${new Date().toLocaleTimeString()}`);
      await load();
    } catch (e: any) {
      setNote(e.message);
    } finally {
      setChecking(false);
    }
  }, [load]);

  useEffect(() => {
    if (auto) {
      timer.current = setInterval(checkAll, 60000);
      return () => {
        if (timer.current) clearInterval(timer.current);
      };
    }
    if (timer.current) clearInterval(timer.current);
  }, [auto, checkAll]);

  const remove = async (id: string) => {
    if (!confirm('Delete this VM?')) return;
    await api.del(`/api/vms/${id}`);
    load();
  };

  const list = vms.filter((v) => filter === 'all' || v.status === filter);
  const withChecks = vms.filter((v) => v.port || v.health_url || v.has_ssh).length;

  return (
    <div className="page">
      <div className="page-h">
        <div>
          <h1>VM Status</h1>
          <p>Are the machines reachable, and how loaded are they?</p>
        </div>
        <div className="actions">
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
          <button className="btn" onClick={checkAll} disabled={checking || !withChecks} title={withChecks ? '' : 'Add a VM with SSH first'}>
            <IconRefresh />
            {checking ? 'Checking…' : 'Check now'}
          </button>
          <label className="auto-toggle">
            <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
            <span>Auto (60s)</span>
          </label>
          <button className="btn btn-primary" onClick={() => setAdding(true)} disabled={!clients.length}>
            <IconPlus />
            Add VM
          </button>
        </div>
      </div>

      {(note || withChecks === 0) && (
        <div className="tip" style={{ background: 'var(--soft)', borderColor: 'var(--border)', color: 'var(--muted)' }}>
          {withChecks === 0
            ? 'No VM is set up yet — click Add VM, enter Host/IP + SSH username + .pem key to track CPU, Memory and Disk.'
            : note}
        </div>
      )}

      <div className="card">
        <div className="card-h">
          <h3>VMs</h3>
          <span className="updated">Connect each server by SSH (.pem) to track CPU / Memory / Disk; add its applications from inside.</span>
        </div>
        <div className="tbl-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Client</th>
                <th>VM / Instance</th>
                <th>Type</th>
                <th>Status</th>
                <th>CPU</th>
                <th>Memory</th>
                <th>Disk</th>
                <th>Response</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={9}>
                    <Loading />
                  </td>
                </tr>
              ) : list.length ? (
                list.map((v) => {
                  const down = v.status === 'down';
                  const meterOk = v.has_ssh || !!v.health_url;
                  return (
                    <tr key={v.id}>
                      <td className="client">{v.client_name}</td>
                      <td className="mono" style={{ fontSize: 12.5 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <Link href={`/vms/${v.id}`} style={{ color: 'var(--blue-600)' }}>
                            {v.name}
                          </Link>
                          <Tag label={v.tag} />
                        </div>
                        <div className="sub">{v.region}</div>
                      </td>
                      <td>
                        <span className="pill neutral">{v.provider}</span>
                      </td>
                      <td>
                        <Pill status={v.status} />
                      </td>
                      <td>{meterOk ? <BarGauge value={v.cpu} down={down} /> : <span style={{ color: 'var(--faint)' }}>—</span>}</td>
                      <td>{meterOk ? <BarGauge value={v.mem} down={down} /> : <span style={{ color: 'var(--faint)' }}>—</span>}</td>
                      <td>{meterOk ? <BarGauge value={v.disk} down={down} /> : <span style={{ color: 'var(--faint)' }}>—</span>}</td>
                      <td className="resp" style={{ color: down ? 'var(--red)' : 'var(--muted)' }}>
                        {down ? '—' : v.last_response_ms != null ? `${v.last_response_ms} ms` : v.uptime_label || '—'}
                      </td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <Link className="btn btn-ghost" href={`/vms/${v.id}`} style={{ padding: '4px 9px', fontSize: 12 }}>
                          Open
                        </Link>
                        <button className="btn btn-ghost" style={{ padding: '4px 9px', fontSize: 12 }} onClick={() => setEditing(v)}>
                          Edit
                        </button>
                        <button className="btn btn-ghost" style={{ padding: '4px 9px', fontSize: 12, color: 'var(--red)' }} onClick={() => remove(v.id)}>
                          Delete
                        </button>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={9} style={{ color: 'var(--faint)', padding: '26px 20px' }}>
                    No VMs yet. Click <b>Add VM</b> (you need a client first).
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {adding && <VMDialog clients={clients} onClose={() => setAdding(false)} onSaved={load} />}
      {editing && <VMDialog initial={editing} onClose={() => setEditing(null)} onSaved={load} />}
    </div>
  );
}