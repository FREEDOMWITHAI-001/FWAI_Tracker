'use client';

import { useEffect, useState, useCallback, useRef, Fragment } from 'react';
import Link from 'next/link';
import { api } from '@/lib/client';
import { Pill, Loading, StatusSelect } from '@/components/ui';
import { VMDialog } from '@/components/dialogs/vm-dialog';
import { CloudAccountDialog } from '@/components/dialogs/cloud-account-dialog';
import { IconPlus, IconRefresh } from '@/lib/icons';
import type { VM, Client, CloudAccount } from '@/lib/types';

type VMRow = VM & { client_name: string };
type CloudAcct = CloudAccount & { client_name: string; vm_count: number };

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
  const [accounts, setAccounts] = useState<CloudAcct[]>([]);
  const [addingCloud, setAddingCloud] = useState(false);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    const [v, c, a] = await Promise.all([
      api.get<VMRow[]>('/api/vms'),
      api.get<Client[]>('/api/clients'),
      api.get<CloudAcct[]>('/api/cloud-accounts'),
    ]);
    setVms(v);
    setClients(c);
    setAccounts(a);
    setLoading(false);
  }, []);

  useEffect(() => {
    load().catch(() => setLoading(false));
  }, [load]);

  const syncOne = async (id: string) => {
    setSyncing(id);
    setNote('');
    try {
      const r = await api.post<{ imported: number }>(`/api/cloud-accounts/${id}/sync`, {});
      setNote(`imported ${r.imported} instance${r.imported !== 1 ? 's' : ''} · ${new Date().toLocaleTimeString()}`);
      await load();
    } catch (e: any) {
      setNote(`sync failed: ${e.message}`);
    } finally {
      setSyncing(null);
    }
  };
  const syncAllClouds = async () => {
    setSyncing('all');
    setNote('');
    try {
      const r = await api.post<{ imported: number; accounts: number }>('/api/cloud-accounts/sync-all', {});
      setNote(`synced ${r.accounts} account${r.accounts !== 1 ? 's' : ''} · imported ${r.imported} · ${new Date().toLocaleTimeString()}`);
      await load();
    } catch (e: any) {
      setNote(`sync failed: ${e.message}`);
    } finally {
      setSyncing(null);
    }
  };
  const removeAccount = async (id: string) => {
    if (!confirm('Remove this cloud account and the VMs imported from it?')) return;
    await api.del(`/api/cloud-accounts/${id}`);
    load();
  };

  const checkAll = useCallback(async () => {
    setChecking(true);
    try {
      const r = await api.post<{ checked: number; total: number }>('/api/vms/check-all', {});
      setNote(`checked ${r.checked} VM${r.checked !== 1 ? 's' : ''} · ${new Date().toLocaleTimeString()}`);
      await load();
    } catch (e: any) {
      setNote(e.message);
    } finally {
      setChecking(false);
    }
  }, [load]);

  // auto-refresh every 60s while toggled on and the page is open
  useEffect(() => {
    if (auto) {
      checkAll();
      timer.current = setInterval(checkAll, 60000);
    }
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [auto, checkAll]);

  const remove = async (id: string) => {
    if (!confirm('Delete this VM?')) return;
    await api.del(`/api/vms/${id}`);
    load();
  };

  const list = vms.filter((v) => (filter === 'all' || v.status === filter) && !v.cloud_account_id);
  const withChecks = vms.filter((v) => v.port || v.health_url).length;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>VM Status</h1>
          <div className="sub">Are the machines reachable, and how loaded are they?</div>
        </div>
        <div className="toolbar">
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
          <button className="btn" onClick={checkAll} disabled={checking || !withChecks} title={withChecks ? '' : 'Add a host:port to a VM first'}>
            <IconRefresh />
            {checking ? 'Checking…' : 'Check now'}
          </button>
          <label className="btn btn-ghost" style={{ gap: 8 }}>
            <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
            Auto (60s)
          </label>
          <button className="btn btn-primary" onClick={() => setAdding(true)} disabled={!clients.length}>
            <IconPlus />
            Add VM
          </button>
        </div>
      </div>

      {(note || (withChecks === 0 && accounts.length === 0)) && (
        <div className="tip" style={{ background: 'var(--soft)', borderColor: 'var(--border)', color: 'var(--muted)' }}>
          {withChecks === 0 && accounts.length === 0
            ? 'No VM has a host:port yet — edit a VM and set its Host + Port to enable live up/down and response-time tracking. (Or connect a cloud account below.)'
            : note}
        </div>
      )}

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-h">
          <h3>Cloud accounts</h3>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" onClick={syncAllClouds} disabled={!accounts.length || syncing !== null}>
              <IconRefresh />
              {syncing === 'all' ? 'Syncing…' : 'Sync all'}
            </button>
            <button className="btn btn-primary" onClick={() => setAddingCloud(true)} disabled={!clients.length} style={{ padding: '7px 12px', fontSize: 13 }}>
              <IconPlus />
              Add cloud account
            </button>
          </div>
        </div>
        {accounts.length ? (
          <div className="tbl-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Account</th>
                  <th>Provider</th>
                  <th>Client</th>
                  <th>VMs</th>
                  <th>Last synced</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((a) => {
                  const acctVms = vms.filter((v) => v.cloud_account_id === a.id);
                  const open = expanded === a.id;
                  return (
                    <Fragment key={a.id}>
                      <tr>
                        <td className="client" style={{ cursor: 'pointer' }} onClick={() => setExpanded(open ? null : a.id)} title="Click to show this account's VMs">
                          <span style={{ display: 'inline-block', width: 14, color: 'var(--muted)' }}>{open ? '▾' : '▸'}</span>
                          {a.name}
                          <div className="sub mono">{a.label}</div>
                        </td>
                        <td>
                          <span className="pill neutral">{a.provider.toUpperCase()}</span>
                        </td>
                        <td style={{ color: 'var(--muted)' }}>{a.client_name}</td>
                        <td className="resp">{a.vm_count}</td>
                        <td className="sub">
                          {a.last_sync_error ? (
                            <span style={{ color: 'var(--red)' }}>error: {a.last_sync_error.slice(0, 40)}</span>
                          ) : a.last_synced_at ? (
                            new Date(a.last_synced_at).toLocaleString()
                          ) : (
                            'never'
                          )}
                        </td>
                        <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                          <button className="btn btn-ghost" style={{ padding: '4px 9px', fontSize: 12 }} onClick={() => syncOne(a.id)} disabled={syncing !== null}>
                            {syncing === a.id ? 'Syncing…' : 'Sync'}
                          </button>
                          <button className="btn btn-ghost" style={{ padding: '4px 9px', fontSize: 12, color: 'var(--red)' }} onClick={() => removeAccount(a.id)}>
                            Remove
                          </button>
                        </td>
                      </tr>
                      {open && (
                        <tr>
                          <td colSpan={6} style={{ background: 'var(--soft)', padding: '4px 10px 10px' }}>
                            {acctVms.length ? (
                              <table className="data" style={{ margin: 0 }}>
                                <thead>
                                  <tr>
                                    <th>VM / Instance</th>
                                    <th>Status</th>
                                    <th>Response</th>
                                    <th></th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {acctVms.map((v) => (
                                    <tr key={v.id}>
                                      <td className="mono" style={{ fontSize: 12.5 }}>
                                        <Link href={`/vms/${v.id}`} style={{ color: 'var(--blue-600)' }}>
                                          {v.name}
                                        </Link>
                                        <div className="sub">{v.region}</div>
                                      </td>
                                      <td>
                                        <Pill status={v.status} />
                                      </td>
                                      <td className="resp">{v.last_response_ms != null ? `${v.last_response_ms} ms` : '—'}</td>
                                      <td style={{ textAlign: 'right' }}>
                                        <Link className="btn btn-ghost" href={`/vms/${v.id}`} style={{ padding: '4px 9px', fontSize: 12 }}>
                                          Open graphs
                                        </Link>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            ) : (
                              <div style={{ padding: '10px 6px', color: 'var(--faint)', fontSize: 13 }}>
                                No instances imported yet — click <b>Sync</b> to pull this account&apos;s VMs.
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
          <div className="empty">
            No cloud accounts yet. Connect AWS, Azure or GCP to auto-import instances as a client&apos;s VMs.
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-h">
          <h3>Standalone VMs</h3>
          <span className="updated">Manually-added VMs (port / health-URL checks). Cloud VMs live under their account above.</span>
        </div>
        <div className="tbl-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Client</th>
                <th>VM / Instance</th>
                <th>Type</th>
                <th>Status</th>
                <th>Response</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6}>
                    <Loading />
                  </td>
                </tr>
              ) : list.length ? (
                list.map((v) => {
                  const down = v.status === 'down';
                  return (
                    <tr key={v.id}>
                      <td className="client">{v.client_name}</td>
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
                  <td colSpan={6} style={{ color: 'var(--faint)', padding: '26px 20px' }}>
                    {vms.length ? 'No standalone VMs. Cloud-imported VMs are grouped under their account above.' : 'No VMs yet. Add one (you need a client first), or connect a cloud account.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {adding && <VMDialog clients={clients} onClose={() => setAdding(false)} onSaved={load} />}
      {editing && <VMDialog initial={editing} onClose={() => setEditing(null)} onSaved={load} />}
      {addingCloud && <CloudAccountDialog clients={clients} onClose={() => setAddingCloud(false)} onSaved={load} />}
    </div>
  );
}