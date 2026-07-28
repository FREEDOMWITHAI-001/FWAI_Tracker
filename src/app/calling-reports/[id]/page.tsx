'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api } from '@/lib/client';
import { Loading, Field, StatusSelect } from '@/components/ui';
import { IconChevronLeft, IconUpload } from '@/lib/icons';
import { MappingDialog } from '@/components/calling/mapping-dialog';
import { AssumptionsForm } from '@/components/calling/assumptions-form';
import { QualityPanelView } from '@/components/calling/quality-panel';
import { ReportPreview } from '@/components/calling/report-preview';
import {
  DEFAULT_ASSUMPTIONS,
  ROLE_LABEL,
  type Assumptions,
  type InputRole,
  type QualityPanel,
  type ReportResult,
  type ReportTemplate,
} from '@/lib/reports/types';

interface DatasetRow {
  id: string;
  role: InputRole;
  source: 'upload' | 'zoom_api';
  filename: string;
  shape: string;
  row_count: number;
  headers: string[];
  mapping: Record<string, string>;
  options: Record<string, unknown>;
  detect_notes: string[];
}

interface Detail {
  id: string;
  client_id: string;
  client_name: string;
  name: string;
  template_key: string;
  period_label: string | null;
  period_start: string | null;
  period_end: string | null;
  assumptions: Assumptions;
  status: 'draft' | 'ready' | 'failed';
  result: ReportResult | null;
  quality: QualityPanel | null;
  error: string | null;
  quality_ack_at: string | null;
  generated_at: string | null;
  run_count: number;
  datasets: DatasetRow[];
  present_roles: InputRole[];
  templates: (ReportTemplate & { validity: { valid: boolean; missing: InputRole[]; reason: string | null } })[];
}

type Step = 'inputs' | 'assumptions' | 'quality' | 'preview' | 'versions';

interface VersionRow {
  id: string;
  version: number;
  template_key: string;
  period_label: string | null;
  quality_hash: string | null;
  fact_count: number;
  headline: string | null;
  primary_lens: string | null;
  buyers: number | null;
  revenue: string | number | null;
  created_at: string;
  assumptions: Assumptions;
}

const ROLE_HINT: Record<InputRole, string> = {
  leads: 'GoHighLevel export or Zoom registrant list. Sets the locked denominator.',
  calls: 'The AI dialer log — or a manual calling log, marked as such on its Columns screen.',
  attendance: 'Any of the four Zoom export shapes, or pull it live from the Zoom API.',
  sales: 'Orders / buyers. ₹0 coupon orders are valued notionally in Assumptions.',
  cost: 'Optional. Call-credit usage — without it there is no ROI block.',
  comeback: 'Optional. The Zoom-leave reminder trigger-link click export (drives L7).',
};

export default function CallingReportPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [d, setD] = useState<Detail | null>(null);
  const [step, setStep] = useState<Step>('inputs');
  const [assumptions, setAssumptions] = useState<Assumptions>(DEFAULT_ASSUMPTIONS);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [mappingFor, setMappingFor] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await api.get<Detail>(`/api/calling-reports/${id}`);
    setD(r);
    setAssumptions({ ...DEFAULT_ASSUMPTIONS, ...(r.assumptions ?? {}) });
    if (r.status === 'ready' && r.result) setStep((s) => (s === 'inputs' ? 'preview' : s));
  }, [id]);

  useEffect(() => {
    load().catch((e) => setErr(e.message));
  }, [load]);

  if (err && !d) return <div className="form-err">{err}</div>;
  if (!d) return <Loading label="Loading report…" />;

  const template = d.templates.find((t) => t.key === d.template_key);
  const roles: InputRole[] = [...new Set([...(template?.requires ?? []), ...(template?.optional_roles ?? [])])];
  const missing = template?.validity.missing ?? [];
  const ack = !!d.quality_ack_at;

  const run = async () => {
    setBusy('run');
    setErr('');
    setMsg('');
    try {
      await api.post(`/api/calling-reports/${id}/run`, { assumptions });
      await load();
      setStep('quality');
      setMsg('Report regenerated from the stored rows — nothing was re-uploaded.');
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(null);
    }
  };

  const acknowledge = async () => {
    if (!d.quality) return;
    setBusy('ack');
    try {
      await api.post(`/api/calling-reports/${id}/acknowledge`, { hash: d.quality.hash });
      await load();
      setStep('preview');
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(null);
    }
  };

  const exportXlsx = async () => {
    setBusy('export');
    setErr('');
    try {
      const res = await fetch(`/api/calling-reports/${id}/export`);
      if (!res.ok) {
        const t = await res.text();
        throw new Error(JSON.parse(t)?.error || `Export failed (${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${d.name.replace(/[^a-z0-9]+/gi, '_')}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(null);
    }
  };

  const saveAssumptions = async () => {
    setBusy('save');
    try {
      await api.patch(`/api/calling-reports/${id}`, { assumptions });
      await load();
      setMsg('Assumptions saved. Run the report to regenerate every number from them.');
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(null);
    }
  };

  const switchTemplate = async (key: string) => {
    await api.patch(`/api/calling-reports/${id}`, { template_key: key });
    load();
  };

  return (
    <div className="page">
      <div className="crumb" onClick={() => router.push('/calling-reports')}>
        <IconChevronLeft />
        All calling reports
      </div>

      <div className="page-head">
        <div>
          <h1>{d.name}</h1>
          <div className="sub">
            {d.client_name} · {template?.name ?? d.template_key}
            {d.period_label ? ` · ${d.period_label}` : ''} ·{' '}
            {d.generated_at ? `last run ${new Date(d.generated_at).toLocaleString()} (v${d.run_count})` : 'never run'}
          </div>
        </div>
        <div className="toolbar">
          <button className="btn" onClick={run} disabled={busy === 'run' || missing.length > 0}>
            {busy === 'run' ? 'Running…' : d.run_count ? 'Re-run' : 'Run report'}
          </button>
          <button className="btn btn-primary" onClick={exportXlsx} disabled={busy === 'export' || d.status !== 'ready' || !ack}>
            {busy === 'export' ? 'Building…' : 'Export XLSX'}
          </button>
        </div>
      </div>

      {err && <div className="form-err">{err}</div>}
      {msg && <div className="tip">{msg}</div>}
      {d.status === 'failed' && d.error && <div className="form-err">Last run failed: {d.error}</div>}
      {missing.length > 0 && (
        <div className="tip" style={{ background: 'var(--amber-50)', borderColor: 'var(--amber)', color: 'var(--amber)' }}>
          “{template?.name}” still needs: <b>{missing.map((r) => ROLE_LABEL[r]).join(', ')}</b>
        </div>
      )}
      {d.status === 'ready' && !ack && (
        <div className="tip" style={{ background: 'var(--amber-50)', borderColor: 'var(--amber)', color: 'var(--amber)' }}>
          Export is locked until the <b>Data quality</b> panel is reviewed.
        </div>
      )}

      <div className="tabs">
        {(
          [
            ['inputs', `1. Inputs (${d.datasets.length})`],
            ['assumptions', '2. Assumptions'],
            ['quality', '3. Data quality'],
            ['preview', '4. Preview & export'],
            ['versions', `Versions (${d.run_count})`],
          ] as [Step, string][]
        ).map(([k, label]) => (
          <button key={k} className={step === k ? 'on' : ''} onClick={() => setStep(k)}>
            {label}
          </button>
        ))}
      </div>

      {step === 'inputs' && (
        <>
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-h">
              <h3>Report format</h3>
              <span className="updated">a format is a set of lenses × blocks — adding one needs no code</span>
            </div>
            <div className="card-b">
              <Field label="Template" hint={template?.description ?? undefined}>
                <StatusSelect
                  value={d.template_key}
                  onChange={switchTemplate}
                  options={d.templates.map((t) => ({
                    value: t.key,
                    label: t.validity.valid ? t.name : `${t.name} — needs ${t.validity.missing.join(', ')}`,
                  }))}
                />
              </Field>
              {template && (
                <div className="meta-row">
                  <span>
                    Lenses: <b>{template.lenses.join(', ')}</b>
                  </span>
                  <span>
                    Blocks: <b>{template.blocks.join(', ')}</b>
                  </span>
                  <span>
                    Headline lens: <b>{template.primary_lens ?? '—'}</b>
                  </span>
                </div>
              )}
            </div>
          </div>

          {roles.map((role) => (
            <RoleCard
              key={role}
              role={role}
              reportId={d.id}
              required={(template?.requires ?? []).includes(role)}
              datasets={d.datasets.filter((x) => x.role === role)}
              onChanged={load}
              onMap={setMappingFor}
              onError={setErr}
            />
          ))}
        </>
      )}

      {step === 'assumptions' && (
        <div className="card">
          <div className="card-h">
            <h3>Assumptions</h3>
            <span className="updated">change anything here and re-run — the raw rows are already stored</span>
          </div>
          <div className="card-b">
            <AssumptionsForm value={assumptions} onChange={setAssumptions} />
            <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
              <button className="btn" onClick={saveAssumptions} disabled={busy === 'save'}>
                {busy === 'save' ? 'Saving…' : 'Save'}
              </button>
              <button className="btn btn-primary" onClick={run} disabled={busy === 'run' || missing.length > 0}>
                {busy === 'run' ? 'Running…' : 'Save & re-run'}
              </button>
            </div>
          </div>
        </div>
      )}

      {step === 'quality' &&
        (d.quality ? (
          <QualityPanelView quality={d.quality} acknowledged={ack} onAcknowledge={acknowledge} busy={busy === 'ack'} />
        ) : (
          <div className="card">
            <div className="card-b" style={{ color: 'var(--faint)' }}>
              Run the report to produce a data-quality panel.
            </div>
          </div>
        ))}

      {step === 'preview' &&
        (d.result ? (
          <ReportPreview result={d.result} />
        ) : (
          <div className="card">
            <div className="card-b" style={{ color: 'var(--faint)' }}>
              Nothing computed yet — upload the inputs and click <b>Run report</b>.
            </div>
          </div>
        ))}

      {step === 'versions' && <VersionsTab reportId={d.id} runCount={d.run_count} onError={setErr} />}

      {mappingFor && <MappingDialog datasetId={mappingFor} onClose={() => setMappingFor(null)} onSaved={load} />}
    </div>
  );
}

// Every run is snapshotted, so an earlier version stays openable and
// downloadable after later re-runs. Re-versioning is the normal workflow here
// (10 for GoNature, 15 for Flute Gandharvas), and comparing what changed
// between two runs is most of the review conversation.
function VersionsTab({
  reportId,
  runCount,
  onError,
}: {
  reportId: string;
  runCount: number;
  onError: (m: string) => void;
}) {
  const [rows, setRows] = useState<VersionRow[] | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  useEffect(() => {
    api
      .get<VersionRow[]>(`/api/calling-reports/${reportId}/versions`)
      .then(setRows)
      .catch((e) => {
        onError(e.message);
        setRows([]);
      });
  }, [reportId, onError]);

  const download = async (v: number) => {
    setBusy(v);
    try {
      const res = await fetch(`/api/calling-reports/${reportId}/versions/${v}?export=1`);
      if (!res.ok) throw new Error(JSON.parse(await res.text())?.error || `Export failed (${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `report_v${v}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      onError(e.message);
    } finally {
      setBusy(null);
    }
  };

  if (!rows) return <Loading label="Loading versions…" />;

  return (
    <div className="card">
      <div className="card-h">
        <h3>Version history</h3>
        <span className="updated">
          {rows.length} snapshot{rows.length === 1 ? '' : 's'} · every run is kept, so an old version stays downloadable
        </span>
      </div>
      <div className="tbl-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>v</th>
              <th>Run at</th>
              <th>Headline lens</th>
              <th>Buyers</th>
              <th>Revenue</th>
              <th>Facts</th>
              <th>Key assumptions</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((v) => (
                <tr key={v.id}>
                  <td className="client">v{v.version}</td>
                  <td className="sub">{new Date(v.created_at).toLocaleString()}</td>
                  <td className="sub">{v.primary_lens ?? '—'}</td>
                  <td className="resp">{v.buyers ?? '—'}</td>
                  <td className="resp">
                    {v.revenue == null ? '—' : `₹${Number(v.revenue).toLocaleString()}`}
                  </td>
                  <td className="resp">{v.fact_count.toLocaleString()}</td>
                  <td className="sub" style={{ maxWidth: 280, fontSize: 11.5 }}>
                    {v.assumptions
                      ? `${v.assumptions.attribution_days}d window · ${v.assumptions.dedup_mode} · talk ${v.assumptions.talk_rule ?? 'cohort'}`
                      : '—'}
                  </td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button
                      className="btn btn-ghost"
                      style={{ padding: '4px 9px', fontSize: 12 }}
                      onClick={() => download(v.version)}
                      disabled={busy === v.version}
                    >
                      {busy === v.version ? 'Building…' : 'Download XLSX'}
                    </button>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={8} style={{ color: 'var(--faint)', padding: '22px 20px' }}>
                  {runCount > 0
                    ? 'This report ran before version snapshots existed, so only its latest result was kept. The next run will be recorded here.'
                    : 'No runs yet — click Run report.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RoleCard({
  role,
  reportId,
  required,
  datasets,
  onChanged,
  onMap,
  onError,
}: {
  role: InputRole;
  reportId: string;
  required: boolean;
  datasets: DatasetRow[];
  onChanged: () => void;
  onMap: (id: string) => void;
  onError: (m: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const upload = async (file: File, force = false) => {
    setBusy(true);
    onError('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('role', role);
      if (force) fd.append('force', '1');
      const res = await fetch(`/api/calling-reports/${reportId}/datasets`, { method: 'POST', body: fd });
      const text = await res.text();
      const json = text ? JSON.parse(text) : null;
      if (!res.ok) {
        if (res.status === 409 && confirm(`${json?.error}\n\nUpload it anyway?`)) return upload(file, true);
        throw new Error(json?.error || `Upload failed (${res.status})`);
      }
      onChanged();
      if (json?.unmapped_required?.length) onMap(json.id);
    } catch (e: any) {
      onError(e.message);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const zoomSync = async () => {
    setBusy(true);
    onError('');
    try {
      await api.post(`/api/calling-reports/${reportId}/zoom-sync`, {});
      onChanged();
    } catch (e: any) {
      onError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (dsId: string, filename: string) => {
    if (!confirm(`Remove "${filename}"?`)) return;
    await api.del(`/api/calling-reports/datasets/${dsId}`);
    onChanged();
  };

  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div className="card-h">
        <h3>
          {ROLE_LABEL[role]}
          {required && <span className="pill down" style={{ marginLeft: 8 }}>required</span>}
          {!required && <span className="pill neutral" style={{ marginLeft: 8 }}>optional</span>}
        </h3>
        <div style={{ display: 'flex', gap: 8 }}>
          {role === 'attendance' && (
            <button className="btn btn-ghost" style={{ padding: '5px 11px', fontSize: 12.5 }} onClick={zoomSync} disabled={busy}>
              Pull from Zoom API
            </button>
          )}
          <button className="btn" style={{ padding: '5px 11px', fontSize: 12.5 }} onClick={() => inputRef.current?.click()} disabled={busy}>
            <IconUpload />
            {busy ? 'Working…' : 'Upload'}
          </button>
          <input
            ref={inputRef}
            type="file"
            accept=".csv,.xlsx,.xlsm,text/csv"
            style={{ display: 'none' }}
            onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
          />
        </div>
      </div>
      <div className="card-b" style={{ paddingTop: 12 }}>
        <div className="sub" style={{ color: 'var(--muted)', fontSize: 12.5, marginBottom: datasets.length ? 12 : 0 }}>
          {ROLE_HINT[role]}
        </div>
        {datasets.map((ds) => (
          <div
            key={ds.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '10px 0',
              borderTop: '1px solid var(--border-2)',
              flexWrap: 'wrap',
            }}
          >
            <div style={{ flex: 1, minWidth: 220 }}>
              <div style={{ fontWeight: 600, fontSize: 13.5 }}>{ds.filename}</div>
              <div className="sub" style={{ fontSize: 12 }}>
                {ds.row_count.toLocaleString()} rows · {ds.shape}
                {ds.source === 'zoom_api' && ' · live from Zoom'}
                {ds.options?.call_mode === 'manual' && ' · manual/human calling'}
              </div>
              {ds.detect_notes?.slice(0, 2).map((n, i) => (
                <div key={i} className="sub" style={{ fontSize: 11.5, color: 'var(--faint)' }}>
                  {n}
                </div>
              ))}
            </div>
            <button className="btn btn-ghost" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => onMap(ds.id)}>
              Columns
            </button>
            <button
              className="btn btn-ghost"
              style={{ padding: '4px 10px', fontSize: 12, color: 'var(--red)' }}
              onClick={() => remove(ds.id, ds.filename)}
            >
              Remove
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
