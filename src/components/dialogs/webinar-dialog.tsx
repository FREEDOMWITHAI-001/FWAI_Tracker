'use client';

import { useState } from 'react';
import { Modal, Field, StatusSelect } from '@/components/ui';
import { IconPlus, IconX } from '@/lib/icons';
import { api } from '@/lib/client';
import type { Webinar, Client } from '@/lib/types';

const STATUSES = [
  { value: 'healthy', label: 'OK' },
  { value: 'warning', label: 'Partial' },
  { value: 'down', label: 'Reminders failed' },
];

const DEFAULT_STAGES = ['Confirmation', '24h before', '1h before', '15 min before', '"You left" re-join'];

interface StageRow {
  stage: string;
  triggered: number | string;
  succeeded: number | string;
  failed: number | string;
}

export function WebinarDialog({
  initial,
  clientId,
  clients,
  onClose,
  onSaved,
}: {
  initial?: Webinar;
  clientId?: string;
  clients: Client[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const editing = !!initial;
  const [form, setForm] = useState({
    client_id: initial?.client_id ?? clientId ?? clients[0]?.id ?? '',
    name: initial?.name ?? '',
    participants: initial?.participants ?? 0,
    reminders: initial?.reminders ?? 0,
    attendance: initial?.attendance ?? 0,
    webinar_date: initial?.webinar_date ?? '',
    status: initial?.status ?? 'healthy',
  });
  const [stages, setStages] = useState<StageRow[]>(
    initial?.webinar_stages?.length
      ? initial.webinar_stages
          .slice()
          .sort((a, b) => a.sort_order - b.sort_order)
          .map((s) => ({ stage: s.stage, triggered: s.triggered, succeeded: s.succeeded, failed: s.failed }))
      : DEFAULT_STAGES.map((s) => ({ stage: s, triggered: 0, succeeded: 0, failed: 0 }))
  );
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));
  const setStage = (i: number, k: keyof StageRow, v: any) =>
    setStages((rows) => rows.map((r, idx) => (idx === i ? { ...r, [k]: v } : r)));

  const save = async () => {
    if (!form.client_id) return setErr('Pick a client.');
    if (!form.name.trim()) return setErr('Webinar name is required.');
    setBusy(true);
    setErr('');
    try {
      const body = {
        ...form,
        name: form.name.trim(),
        participants: Number(form.participants) || 0,
        reminders: Number(form.reminders) || 0,
        attendance: Number(form.attendance) || 0,
        webinar_date: form.webinar_date || null,
        stages: stages.filter((s) => s.stage.trim()),
      };
      if (editing) await api.patch(`/api/webinars/${initial!.id}`, body);
      else await api.post('/api/webinars', body);
      onSaved();
      onClose();
    } catch (e: any) {
      setErr(e.message);
      setBusy(false);
    }
  };

  return (
    <Modal
      title={editing ? 'Edit webinar' : 'Add webinar'}
      onClose={onClose}
      size="lg"
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={save} disabled={busy}>
            {busy ? 'Saving…' : editing ? 'Save changes' : 'Add webinar'}
          </button>
        </>
      }
    >
      {err && <div className="form-err">{err}</div>}
      <div className="field-row">
        <Field label="Webinar name">
          <input className="input" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="AI Agency Bootcamp #12" autoFocus />
        </Field>
        <Field label="Client">
          <StatusSelect
            value={form.client_id}
            onChange={(v) => set('client_id', v)}
            options={clients.map((c) => ({ value: c.id, label: c.name }))}
          />
        </Field>
      </div>
      <div className="field-row-3">
        <Field label="Participants">
          <input className="input" type="number" min={0} value={form.participants} onChange={(e) => set('participants', e.target.value)} />
        </Field>
        <Field label="Leave reminders">
          <input className="input" type="number" min={0} value={form.reminders} onChange={(e) => set('reminders', e.target.value)} />
        </Field>
        <Field label="Attendance %">
          <input className="input" type="number" min={0} max={100} value={form.attendance} onChange={(e) => set('attendance', e.target.value)} />
        </Field>
      </div>
      <div className="field-row">
        <Field label="Date">
          <input className="input" type="date" value={form.webinar_date ?? ''} onChange={(e) => set('webinar_date', e.target.value)} />
        </Field>
        <Field label="Status">
          <StatusSelect value={form.status} onChange={(v) => set('status', v)} options={STATUSES} />
        </Field>
      </div>

      <div className="section-label" style={{ fontSize: 13.5, marginTop: 6 }}>
        <span>Reminder funnel stages</span>
        <button
          type="button"
          className="btn btn-ghost"
          style={{ padding: '5px 10px', fontSize: 12.5 }}
          onClick={() => setStages((r) => [...r, { stage: '', triggered: 0, succeeded: 0, failed: 0 }])}
        >
          <IconPlus /> Stage
        </button>
      </div>
      {stages.map((s, i) => (
        <div key={i} style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr 1fr 1fr 28px', gap: 8, marginBottom: 8, alignItems: 'center' }}>
          <input className="input" value={s.stage} placeholder="Stage name" onChange={(e) => setStage(i, 'stage', e.target.value)} />
          <input className="input" type="number" min={0} value={s.triggered} placeholder="Triggered" onChange={(e) => setStage(i, 'triggered', e.target.value)} />
          <input className="input" type="number" min={0} value={s.succeeded} placeholder="Succeeded" onChange={(e) => setStage(i, 'succeeded', e.target.value)} />
          <input className="input" type="number" min={0} value={s.failed} placeholder="Failed" onChange={(e) => setStage(i, 'failed', e.target.value)} />
          <button type="button" className="modal-x" onClick={() => setStages((r) => r.filter((_, idx) => idx !== i))} aria-label="Remove stage">
            <IconX />
          </button>
        </div>
      ))}
      <div className="hint" style={{ color: 'var(--faint)', fontSize: 11.5 }}>
        Columns: stage name · triggered · succeeded · failed.
      </div>
    </Modal>
  );
}
