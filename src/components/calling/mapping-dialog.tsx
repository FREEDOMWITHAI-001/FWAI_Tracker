'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/client';
import { Modal, Loading, Field, StatusSelect } from '@/components/ui';

// Confirm-and-edit column mapping. Auto-detection is a suggestion, never a
// decision — the operator sees the sample values from the actual file next to
// every field before anything is computed. Confirming also remembers the
// mapping for this client + header layout, which is what makes month 2 a click.

interface FieldSpec {
  field: string;
  label: string;
  required: boolean;
  hint?: string;
}

interface DatasetDetail {
  id: string;
  role: string;
  source: string;
  filename: string;
  shape: string;
  row_count: number;
  headers: string[];
  mapping: Record<string, string>;
  mapping_confidence: Record<string, number>;
  options: Record<string, unknown>;
  detect_notes: string[];
  fields: FieldSpec[];
  preview: Record<string, string>[];
  session_preview: Record<string, string>[];
}

const SHAPE_LABEL: Record<string, string> = {
  simple: 'Plain CSV (header on row 1)',
  xlsx_simple: 'Plain XLSX (header on row 1)',
  zoom_two_table: 'Zoom two-table export (session block + participant table)',
  zoom_wide_flat: 'Zoom wide flat export (session + participant columns on every row)',
  zoom_preamble: 'Zoom preamble CSV (“Attendee Report” banner above the header)',
  zoom_xlsx_preamble: 'Zoom preamble XLSX (“Attendee Report” banner above the header)',
  zoom_api: 'Pulled live from the Zoom API',
};

export function MappingDialog({
  datasetId,
  onClose,
  onSaved,
}: {
  datasetId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [d, setD] = useState<DatasetDetail | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [options, setOptions] = useState<Record<string, unknown>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    api
      .get<DatasetDetail>(`/api/calling-reports/datasets/${datasetId}?preview=8`)
      .then((r) => {
        setD(r);
        setMapping(r.mapping ?? {});
        setOptions(r.options ?? {});
      })
      .catch((e) => setErr(e.message));
  }, [datasetId]);

  const save = async () => {
    setBusy(true);
    setErr('');
    try {
      await api.patch(`/api/calling-reports/datasets/${datasetId}`, { mapping, options, remember: true });
      onSaved();
      onClose();
    } catch (e: any) {
      setErr(e.message);
      setBusy(false);
    }
  };

  const samples = (header: string) =>
    (d?.preview ?? [])
      .map((r) => r[header])
      .filter((v) => v != null && String(v).trim() !== '')
      .slice(0, 3)
      .join(' · ') || '—';

  const conf = (field: string) => d?.mapping_confidence?.[field];

  return (
    <Modal
      title={d ? `Columns — ${d.filename}` : 'Columns'}
      size="lg"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={save} disabled={busy || !d}>
            {busy ? 'Saving…' : 'Confirm mapping'}
          </button>
        </>
      }
    >
      {err && <div className="form-err">{err}</div>}
      {!d ? (
        <Loading />
      ) : (
        <>
          <div className="tip" style={{ display: 'block' }}>
            <b>{SHAPE_LABEL[d.shape] ?? d.shape}</b> · {d.row_count.toLocaleString()} rows · {d.headers.length} columns
            {d.detect_notes?.length > 0 && (
              <ul style={{ margin: '8px 0 0 16px', fontWeight: 400 }}>
                {d.detect_notes.map((n, i) => (
                  <li key={i} style={{ marginBottom: 3 }}>
                    {n}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {d.session_preview?.length > 0 && (
            <div className="field">
              <label>Session summary block</label>
              <div className="sub" style={{ fontSize: 12, color: 'var(--muted)' }}>
                {Object.entries(d.session_preview[0])
                  .filter(([, v]) => String(v ?? '').trim())
                  .map(([k, v]) => `${k}: ${v}`)
                  .join(' · ')}
              </div>
            </div>
          )}

          {d.fields.map((f) => {
            const c = conf(f.field);
            return (
              <Field
                key={f.field}
                label={`${f.label}${f.required ? ' *' : ''}`}
                hint={
                  [
                    f.hint,
                    mapping[f.field] ? `Sample: ${samples(mapping[f.field])}` : undefined,
                    c != null ? `auto-detected, confidence ${(c * 100).toFixed(0)}%` : undefined,
                  ]
                    .filter(Boolean)
                    .join(' — ') || undefined
                }
              >
                <StatusSelect
                  value={mapping[f.field] ?? ''}
                  onChange={(v) =>
                    setMapping((m) => {
                      const next = { ...m };
                      if (v) next[f.field] = v;
                      else delete next[f.field];
                      return next;
                    })
                  }
                  options={[
                    { value: '', label: f.required ? '— required, pick a column —' : '— not in this file —' },
                    ...d.headers.map((h) => ({ value: h, label: h })),
                  ]}
                />
              </Field>
            );
          })}

          {d.role === 'calls' && (
            <Field
              label="Calling channel"
              hint="Marks this log as the AI dialer or the human team. Needed for the AI-vs-Manual comparison (L4)."
            >
              <StatusSelect
                value={(options.call_mode as string) ?? 'ai'}
                onChange={(v) => setOptions((o) => ({ ...o, call_mode: v }))}
                options={[
                  { value: 'ai', label: 'AI dialer' },
                  { value: 'manual', label: 'Manual / human agents' },
                ]}
              />
            </Field>
          )}

          <div className="field-row">
            <Field label="Duration unit" hint="How to read a bare number in the duration column.">
              <StatusSelect
                value={(options.duration_unit as string) ?? (d.role === 'calls' ? 'seconds' : 'minutes')}
                onChange={(v) => setOptions((o) => ({ ...o, duration_unit: v }))}
                options={[
                  { value: 'seconds', label: 'Seconds' },
                  { value: 'minutes', label: 'Minutes' },
                ]}
              />
            </Field>
            <Field label="Date order" hint="Auto reads the column and decides; Zoom is month/day, GoHighLevel is usually day/month.">
              <StatusSelect
                value={(options.date_order as string) ?? 'auto'}
                onChange={(v) => setOptions((o) => ({ ...o, date_order: v }))}
                options={[
                  { value: 'auto', label: 'Auto-detect' },
                  { value: 'mdy', label: 'Month/Day/Year' },
                  { value: 'dmy', label: 'Day/Month/Year' },
                ]}
              />
            </Field>
          </div>
        </>
      )}
    </Modal>
  );
}
