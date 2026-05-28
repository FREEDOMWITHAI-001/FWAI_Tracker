'use client';

import type { ReactNode } from 'react';
import { useEffect } from 'react';
import {
  IconAlertTriangle,
  IconAlertCircle,
  IconInfo,
  IconWhatsApp,
  IconX,
} from '@/lib/icons';
import {
  STATUS_LABEL,
  type Status,
  type Severity,
  type Alert,
} from '@/lib/types';

/* ---------------- status pill + dot ---------------- */
export function Pill({ status, label }: { status: Status | 'neutral' | 'info'; label?: string }) {
  const text = label ?? STATUS_LABEL[status as Status] ?? '';
  return (
    <span className={`pill ${status}`}>
      {status !== 'neutral' && status !== 'info' && <span className={`dot ${status}`} />}
      {text}
    </span>
  );
}

/* ---------------- stat card ---------------- */
export function StatCard({
  label,
  value,
  delta,
  icon,
  tone,
}: {
  label: string;
  value: ReactNode;
  delta?: ReactNode;
  icon?: ReactNode;
  tone?: 'green' | 'red' | 'amber' | 'wa';
}) {
  return (
    <div className="stat">
      <div className="top">
        <span className="lbl">{label}</span>
        {icon && <span className={`ic ${tone ?? ''}`}>{icon}</span>}
      </div>
      <div className="val">{value}</div>
      {delta != null && <div className="delta">{delta}</div>}
    </div>
  );
}

/* ---------------- meter bar ---------------- */
export function Meter({ name, pct, color }: { name: string; pct: number; color?: string }) {
  return (
    <div className="meter">
      <div className="mh">
        <span className="nm">{name}</span>
        <span className="pc">{pct}%</span>
      </div>
      <div className="track">
        <i style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: color }} />
      </div>
    </div>
  );
}

/* ---------------- donut (conic gradient) ---------------- */
export function StatusDonut({
  healthy,
  warning,
  down,
}: {
  healthy: number;
  warning: number;
  down: number;
}) {
  const total = healthy + warning + down;
  const hp = total ? (healthy / total) * 100 : 0;
  const wp = total ? (warning / total) * 100 : 0;
  const bg = total
    ? `conic-gradient(var(--green) 0 ${hp}%, var(--amber) ${hp}% ${hp + wp}%, var(--red) ${hp + wp}% 100%)`
    : 'conic-gradient(var(--soft-2) 0 100%)';
  return (
    <div className="donut-wrap">
      <div className="donut" style={{ background: bg }}>
        <div className="cn">
          <b>{Math.round(hp)}%</b>
          <span>healthy</span>
        </div>
      </div>
      <div className="breakdown">
        <div className="br-row">
          <span className="l">
            <span className="dot healthy" />
            Healthy
          </span>
          <span className="v">{healthy}</span>
        </div>
        <div className="br-row">
          <span className="l">
            <span className="dot warning" />
            Warning
          </span>
          <span className="v">{warning}</span>
        </div>
        <div className="br-row">
          <span className="l">
            <span className="dot down" />
            Down
          </span>
          <span className="v">{down}</span>
        </div>
      </div>
    </div>
  );
}

/* ---------------- line chart (SVG, matches mockup) ---------------- */
export function LineChart({ series, height = 190 }: { series: number[]; height?: number }) {
  if (!series.length) {
    return (
      <div className="chart-empty" style={{ height }}>
        No uptime samples yet
      </div>
    );
  }
  const w = 640;
  const pad = 26;
  const top = 18;
  const bot = height - 26;
  const min = 96;
  const max = 100;
  const x = (i: number) => pad + (i * (w - pad * 2)) / Math.max(1, series.length - 1);
  const y = (v: number) => bot - ((Math.max(min, Math.min(max, v)) - min) / (max - min)) * (bot - top);
  const pts = series.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const area = `${pad},${bot} ${pts} ${w - pad},${bot}`;
  const gridVals = [100, 99, 98, 97];
  return (
    <svg className="chart-svg" viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" style={{ height }}>
      {gridVals.map((v) => (
        <g key={v}>
          <line x1={pad} y1={y(v)} x2={w - pad} y2={y(v)} stroke="#eef0f4" strokeWidth={1} />
          <text x={6} y={y(v) + 4} fontSize={10} fill="#94a3b8" fontFamily="IBM Plex Mono">
            {v}%
          </text>
        </g>
      ))}
      <polygon points={area} fill="#eff4ff" />
      <polyline points={pts} fill="none" stroke="#2563eb" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
      {series.map((v, i) => (
        <circle key={i} cx={x(i)} cy={y(v)} r={2.4} fill="#2563eb" />
      ))}
    </svg>
  );
}

/* ---------------- alert item ---------------- */
function SevIcon({ sev }: { sev: Severity }) {
  if (sev === 'critical') return <IconAlertTriangle />;
  if (sev === 'warning') return <IconAlertCircle />;
  return <IconInfo />;
}

function timeLabel(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function AlertItem({
  alert,
  clientName,
  actions,
}: {
  alert: Alert & { client_name?: string | null };
  clientName?: string | null;
  actions?: ReactNode;
}) {
  const name = clientName ?? alert.client_name;
  const desc = name ? `${name} · ${alert.description ?? ''}` : alert.description ?? '';
  return (
    <div className="alert">
      <div className={`sev ${alert.severity}`}>
        <SevIcon sev={alert.severity} />
      </div>
      <div className="body">
        <div className="ttl">
          {alert.title}
          <span className={`sev-badge ${alert.severity}`}>{alert.severity}</span>
          {alert.whatsapp_sent && (
            <span className="wa-badge">
              <IconWhatsApp /> sent
            </span>
          )}
        </div>
        <div className="desc">{desc}</div>
      </div>
      <div className="time">
        <span>{timeLabel(alert.created_at)}</span>
        {actions}
      </div>
    </div>
  );
}

/* ---------------- empty / loading ---------------- */
export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}
export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="loading">
      <span className="spinner" />
      {label}
    </div>
  );
}

/* ---------------- modal ---------------- */
export function Modal({
  title,
  onClose,
  children,
  footer,
  size,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'lg';
}) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className={`modal ${size === 'lg' ? 'lg' : ''}`} onClick={(e) => e.stopPropagation()}>
        <div className="modal-h">
          <h3>{title}</h3>
          <button className="modal-x" onClick={onClose} aria-label="Close">
            <IconX />
          </button>
        </div>
        <div className="modal-b">{children}</div>
        {footer && <div className="modal-f">{footer}</div>}
      </div>
    </div>
  );
}

/* ---------------- gauges + metric history chart ---------------- */
function metricColor(v: number) {
  return v >= 90 ? 'var(--red)' : v >= 70 ? 'var(--amber)' : 'var(--green)';
}

// Circular progress gauge for a single 0-100 metric.
export function Gauge({ value, label, size = 116 }: { value: number; label: string; size?: number }) {
  const v = Math.max(0, Math.min(100, value || 0));
  const stroke = 10;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const dash = (v / 100) * c;
  const cx = size / 2;
  const color = metricColor(v);
  return (
    <div className="gauge">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={cx} cy={cx} r={r} fill="none" stroke="var(--soft-2)" strokeWidth={stroke} />
        <circle
          cx={cx}
          cy={cx}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeDasharray={`${dash} ${c}`}
          strokeLinecap="round"
          transform={`rotate(-90 ${cx} ${cx})`}
        />
        <text x={cx} y={cx} textAnchor="middle" dominantBaseline="central" fontSize={size * 0.24} fontWeight={700} fill="var(--ink)">
          {Math.round(v)}
          <tspan fontSize={size * 0.12} fill="var(--muted)">
            %
          </tspan>
        </text>
      </svg>
      <div className="gauge-lbl">{label}</div>
    </div>
  );
}

// Compact inline bar gauge for table cells ("graphs not numbers").
export function BarGauge({ value, down, width = 64 }: { value: number; down?: boolean; width?: number }) {
  if (down) {
    return (
      <span className="resp" style={{ color: 'var(--red)' }}>
        —
      </span>
    );
  }
  const v = Math.max(0, Math.min(100, value || 0));
  const color = v >= 90 ? 'var(--red)' : v >= 70 ? 'var(--amber)' : 'var(--blue)';
  return (
    <div className="bargauge">
      <div className="track" style={{ width }}>
        <i style={{ width: `${v}%`, background: color }} />
      </div>
      <span className="resp">{v}%</span>
    </div>
  );
}

type MetricSample = { checked_at: string; cpu: number | null; mem: number | null; disk: number | null };

// Multi-line history chart on a 0-100 scale (CPU / Memory / Disk).
export function MetricHistoryChart({ samples, height = 210 }: { samples: MetricSample[]; height?: number }) {
  if (samples.length === 0) {
    return (
      <div className="chart-empty" style={{ height }}>
        No samples yet — run a check or sync to start the graph.
      </div>
    );
  }
  const w = 640;
  const padL = 30;
  const padR = 12;
  const top = 14;
  const bot = height - 22;
  const n = samples.length;
  const x = (i: number) => (n <= 1 ? padL + (w - padL - padR) / 2 : padL + (i * (w - padL - padR)) / (n - 1));
  const y = (v: number) => bot - (Math.max(0, Math.min(100, v)) / 100) * (bot - top);

  const series: { key: keyof MetricSample; color: string; label: string }[] = [
    { key: 'cpu', color: '#2563eb', label: 'CPU' },
    { key: 'mem', color: '#16a34a', label: 'Memory' },
    { key: 'disk', color: '#d97706', label: 'Disk' },
  ];
  const gridVals = [100, 75, 50, 25, 0];

  return (
    <>
      <svg className="chart-svg" viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" style={{ height }}>
        {gridVals.map((g) => (
          <g key={g}>
            <line x1={padL} y1={y(g)} x2={w - padR} y2={y(g)} stroke="#eef0f4" strokeWidth={1} />
            <text x={4} y={y(g) + 3} fontSize={9.5} fill="#94a3b8" fontFamily="IBM Plex Mono">
              {g}
            </text>
          </g>
        ))}
        {series.map((s) => {
          const pts = samples
            .map((row, i) => {
              const val = row[s.key] as number | null;
              return val == null ? null : `${x(i).toFixed(1)},${y(val).toFixed(1)}`;
            })
            .filter(Boolean)
            .join(' ');
          if (!pts) return null;
          return <polyline key={s.key} points={pts} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />;
        })}
        {series.map((s) =>
          samples.map((row, i) => {
            const val = row[s.key] as number | null;
            if (val == null) return null;
            return <circle key={`${s.key}-${i}`} cx={x(i)} cy={y(val)} r={2.6} fill={s.color} />;
          })
        )}
      </svg>
      <div className="chart-legend">
        {series.map((s) => (
          <span key={s.key}>
            <i style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
    </>
  );
}

type ResponseSample = { checked_at: string; status: Status; response_ms: number | null };

// Response-time history for port-checked VMs (no CPU/mem/disk available).
// Plots response_ms over time; down samples show as red dots on the baseline.
export function ResponseHistoryChart({ samples, height = 210 }: { samples: ResponseSample[]; height?: number }) {
  if (samples.length === 0) {
    return (
      <div className="chart-empty" style={{ height }}>
        No samples yet — run a check to start the graph.
      </div>
    );
  }
  const w = 640;
  const padL = 42;
  const padR = 12;
  const top = 14;
  const bot = height - 22;
  const n = samples.length;
  const vals = samples.map((s) => s.response_ms ?? 0);
  const niceMax = Math.max(100, Math.ceil(Math.max(...vals) / 100) * 100);
  const x = (i: number) => (n <= 1 ? padL + (w - padL - padR) / 2 : padL + (i * (w - padL - padR)) / (n - 1));
  const y = (v: number) => bot - (Math.min(v, niceMax) / niceMax) * (bot - top);
  const grid = [1, 0.75, 0.5, 0.25, 0].map((f) => Math.round(niceMax * f));
  const linePts = samples
    .map((s, i) => (s.response_ms == null ? null : `${x(i).toFixed(1)},${y(s.response_ms).toFixed(1)}`))
    .filter(Boolean)
    .join(' ');

  return (
    <>
      <svg className="chart-svg" viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" style={{ height }}>
        {grid.map((g) => (
          <g key={g}>
            <line x1={padL} y1={y(g)} x2={w - padR} y2={y(g)} stroke="#eef0f4" strokeWidth={1} />
            <text x={4} y={y(g) + 3} fontSize={9.5} fill="#94a3b8" fontFamily="IBM Plex Mono">
              {g}
            </text>
          </g>
        ))}
        {linePts && <polyline points={linePts} fill="none" stroke="#2563eb" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}
        {samples.map((s, i) =>
          s.response_ms != null ? (
            <circle key={i} cx={x(i)} cy={y(s.response_ms)} r={2.6} fill="#2563eb" />
          ) : (
            <circle key={i} cx={x(i)} cy={bot} r={3} fill="#dc2626" />
          )
        )}
      </svg>
      <div className="chart-legend">
        <span>
          <i style={{ background: '#2563eb' }} />
          Response (ms)
        </span>
        <span>
          <i style={{ background: '#dc2626' }} />
          Down
        </span>
      </div>
    </>
  );
}
export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

export function StatusSelect({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="select-wrap">
      <select className="select" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
