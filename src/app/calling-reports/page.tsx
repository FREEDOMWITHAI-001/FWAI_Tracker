'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/client';
import { Loading, LoadError, Modal, Field, StatusSelect } from '@/components/ui';
import { IconPlus } from '@/lib/icons';
import type { Client } from '@/lib/types';
import type { ReportTemplate } from '@/lib/reports/types';

interface ReportRow {
  id: string;
  client_id: string;
  client_name: string;
  name: string;
  template_key: string;
  period_label: string | null;
  status: 'draft' | 'ready' | 'failed';
  error: string | null;
  generated_at: string | null;
  run_count: number;
  quality_ack_at: string | null;
  created_at: string;
  dataset_roles: string[];
  dataset_count: number;
}

const STATUS_PILL: Record<ReportRow['status'], string> = {
  draft: 'neutral',
  ready: 'healthy',
  failed: 'down',
};

export default function CallingReportsPage() {
  const router = useRouter();
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [templates, setTemplates] = useState<ReportTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    const [r, c, t] = await Promise.all([
      api.get<ReportRow[]>('/api/calling-reports'),
      api.get<Client[]>('/api/clients'),
      api.get<ReportTemplate[]>('/api/calling-reports/templates').catch(() => [] as ReportTemplate[]),
    ]);
    setReports(r);
    setClients(c);
    setTemplates(t);
    setLoading(false);
  }, []);

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

  const list = reports.filter((r) => filter === 'all' || r.client_name === filter);
  const clientNames = [...new Set(reports.map((r) => r.client_name))];
  const templateName = (key: string) => templates.find((t) => t.key === key)?.name ?? key;

  const remove = async (id: string, name: string) => {
    if (!confirm(`Delete "${name}"? Its uploads and computed facts go with it.`)) return;
    await api.del(`/api/calling-reports/${id}`);
    reload();
  };

  const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : '—');

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Calling Reports</h1>
          <div className="sub">
            AI calling performance reports. Upload the exports once — re-run with different assumptions as often as you like.
          </div>
        </div>
        <div className="toolbar">
          <StatusSelect
            value={filter}
            onChange={setFilter}
            options={[{ value: 'all', label: 'All clients' }, ...clientNames.map((c) => ({ value: c, label: c }))]}
          />
          <button className="btn btn-primary" onClick={() => setCreating(true)} disabled={!clients.length}>
            <IconPlus />
            New report
          </button>
        </div>
      </div>

      {error && <LoadError error={error} what="calling reports" onRetry={reload} />}

      <div className="card">
        <div className="card-h">
          <h3>Report history</h3>
          <span className="updated">
            {list.length} report{list.length === 1 ? '' : 's'} · a re-run never needs a re-upload
          </span>
        </div>
        <div className="tbl-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Report</th>
                <th>Client</th>
                <th>Format</th>
                <th>Inputs</th>
                <th>Status</th>
                <th>Last run</th>
                <th>Versions</th>
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
                list.map((r) => (
                  <tr key={r.id} className="row-link" onClick={() => router.push(`/calling-reports/${r.id}`)}>
                    <td>
                      <div className="client">{r.name}</div>
                      {r.period_label && <div className="sub">{r.period_label}</div>}
                    </td>
                    <td style={{ color: 'var(--muted)' }}>{r.client_name}</td>
                    <td className="sub">{templateName(r.template_key)}</td>
                    <td className="sub">
                      {r.dataset_count ? r.dataset_roles.join(', ') : <span style={{ color: 'var(--faint)' }}>none yet</span>}
                    </td>
                    <td>
                      <span className={`pill ${STATUS_PILL[r.status]}`} title={r.error ?? ''}>
                        {r.status}
                      </span>
                      {r.status === 'ready' && !r.quality_ack_at && (
                        <span className="pill warning" style={{ marginLeft: 6 }} title="Data quality not yet reviewed — export is blocked">
                          unsigned
                        </span>
                      )}
                    </td>
                    <td className="sub">{fmt(r.generated_at)}</td>
                    <td className="resp">{r.run_count}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }} onClick={(e) => e.stopPropagation()}>
                      <Link className="btn btn-ghost" style={{ padding: '4px 9px', fontSize: 12 }} href={`/calling-reports/${r.id}`}>
                        Open
                      </Link>
                      <button
                        className="btn btn-ghost"
                        style={{ padding: '4px 9px', fontSize: 12, color: 'var(--red)' }}
                        onClick={() => remove(r.id, r.name)}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={8} style={{ color: 'var(--faint)', padding: '26px 20px' }}>
                    {error
                      ? 'Not loaded — see the error above.'
                      : 'No calling reports yet. Click New report — you need a client first.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {creating && (
        <NewReportDialog
          clients={clients}
          templates={templates}
          reports={reports}
          onClose={() => setCreating(false)}
          onCreated={(id) => router.push(`/calling-reports/${id}`)}
        />
      )}
    </div>
  );
}

function NewReportDialog({
  clients,
  templates,
  reports,
  onClose,
  onCreated,
}: {
  clients: Client[];
  templates: ReportTemplate[];
  reports: ReportRow[];
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [clientId, setClientId] = useState(clients[0]?.id ?? '');
  const [templateKey, setTemplateKey] = useState(templates[0]?.key ?? 'ai_only');
  const [name, setName] = useState('');
  const [periodLabel, setPeriodLabel] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [totalCost, setTotalCost] = useState('');
  const [productPrice, setProductPrice] = useState('');
  const [copyFrom, setCopyFrom] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  // Month 2 for a client: inherit every assumption month 1 settled on.
  const priors = useMemo(() => reports.filter((r) => r.client_id === clientId), [reports, clientId]);
  const template = templates.find((t) => t.key === templateKey);

  const submit = async () => {
    setErr('');
    if (!clientId) return setErr('Pick a client.');
    if (!name.trim()) return setErr('Give the report a name.');
    setBusy(true);
    try {
      const cost = totalCost.trim() ? Number(totalCost) : null;
      const price = productPrice.trim() ? Number(productPrice) : null;
      const assumptions: Record<string, number> = {};
      if (cost != null && !Number.isNaN(cost)) assumptions.fixed_cost = cost;
      if (price != null && !Number.isNaN(price)) assumptions.default_order_value = price;
      const r = await api.post<{ id: string }>('/api/calling-reports', {
        client_id: clientId,
        name: name.trim(),
        template_key: templateKey,
        period_label: periodLabel.trim() || null,
        period_start: start || null,
        period_end: end || null,
        assumptions: Object.keys(assumptions).length ? assumptions : undefined,
        copy_from: copyFrom || null,
      });
      onCreated(r.id);
    } catch (e: any) {
      setErr(e.message);
      setBusy(false);
    }
  };

  return (
    <Modal
      title="New calling report"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={submit} disabled={busy}>
            {busy ? 'Creating…' : 'Create draft'}
          </button>
        </>
      }
    >
      {err && <div className="form-err">{err}</div>}
      <Field label="Client">
        <StatusSelect value={clientId} onChange={setClientId} options={clients.map((c) => ({ value: c.id, label: c.name }))} />
      </Field>
      <Field label="Report name">
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="July AI calling performance" />
      </Field>
      <Field label="Format" hint={template?.description ?? undefined}>
        <StatusSelect value={templateKey} onChange={setTemplateKey} options={templates.map((t) => ({ value: t.key, label: t.name }))} />
      </Field>
      <Field
        label="Period label"
        hint="Shown on the workbook header, e.g. “Webinar Sun 19 Jul 2026, 11:00 AM · 2,492 registered leads (12 Jul 11am – 19 Jul 11am)”."
      >
        <input className="input" value={periodLabel} onChange={(e) => setPeriodLabel(e.target.value)} />
      </Field>
      <div className="field-row">
        <Field label="Period start">
          <input className="input" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
        </Field>
        <Field label="Period end">
          <input className="input" type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
        </Field>
      </div>
      <div className="field-row">
        <Field
          label="Total cost (₹, optional)"
          hint="Call credits / telephony spend for this period, for the ROI block — skip this if you're uploading a cost file instead."
        >
          <input
            className="input"
            type="number"
            min="0"
            step="1"
            value={totalCost}
            onChange={(e) => setTotalCost(e.target.value)}
            placeholder="e.g. 5000"
          />
        </Field>
        <Field
          label="Product price (₹, optional)"
          hint="Used for revenue/ROI when the sales file has no amount column, or for ₹0 coupon orders — skip if the sales file already has prices."
        >
          <input
            className="input"
            type="number"
            min="0"
            step="1"
            value={productPrice}
            onChange={(e) => setProductPrice(e.target.value)}
            placeholder="e.g. 4999"
          />
        </Field>
      </div>
      {priors.length > 0 && (
        <Field label="Copy assumptions from" hint="Inherits every knob — attribution window, bot names, notional price, exclusions.">
          <StatusSelect
            value={copyFrom}
            onChange={setCopyFrom}
            options={[{ value: '', label: 'Client default assumption set' }, ...priors.map((p) => ({ value: p.id, label: p.name }))]}
          />
        </Field>
      )}
    </Modal>
  );
}
