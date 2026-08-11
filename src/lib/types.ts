// Shared domain types + small helpers used across client and server.

export type Status = 'healthy' | 'warning' | 'down';
export type Severity = 'critical' | 'warning' | 'info';
export type AlertStatus = 'active' | 'resolved';

export interface Client {
  id: string;
  name: string;
  industry: string | null;
  alert_name: string | null;
  alert_phone: string | null;
  created_at: string;
}

export interface VM {
  id: string;
  client_id: string;
  name: string;
  provider: string;
  region: string | null;
  status: Status;
  cpu: number;
  mem: number;
  disk: number;
  uptime_label: string | null;
  host: string | null;
  port: number | null;
  health_url: string | null;
  last_checked_at: string | null;
  last_response_ms: number | null;
  cloud_account_id: string | null;
  external_id: string | null;
  source: 'manual' | 'cloud';
  ssh_user: string | null;
  ssh_port: number | null;
  has_ssh?: boolean; // derived; true when an SSH key is stored
  alert_name: string | null;
  alert_phone: string | null;
  tag: string | null;
  down_since: string | null;
  alerted: boolean;
  created_at: string;
}

export type Cloud = 'aws' | 'azure' | 'gcp' | 'oci';

export interface CloudAccount {
  id: string;
  client_id: string;
  name: string;
  provider: Cloud;
  label: string | null;
  last_synced_at: string | null;
  last_sync_error: string | null;
  created_at: string;
}

export interface VmMetric {
  id: string;
  vm_id: string;
  checked_at: string;
  status: Status;
  response_ms: number | null;
  cpu: number | null;
  mem: number | null;
  disk: number | null;
}

export interface App {
  id: string;
  client_id: string;
  vm_id: string | null;
  name: string;
  type: string | null;
  host: string | null;
  status: Status;
  resp_ms: number;
  health: string | null;
  uptime: number;
  check_url: string | null;
  check_host: string | null;
  check_port: number | null;
  last_checked_at: string | null;
  last_response_ms: number | null;
  alert_name: string | null;
  alert_phone: string | null;
  tag: string | null;
  down_since: string | null;
  alerted: boolean;
  created_at: string;
}

export interface AppMetric {
  id: string;
  app_id: string;
  checked_at: string;
  status: Status;
  response_ms: number | null;
}

export interface Alert {
  id: string;
  client_id: string | null;
  severity: Severity;
  title: string;
  description: string | null;
  /** True only when AI Sensy accepted a message for this alert. Server-written. */
  whatsapp_sent: boolean;
  whatsapp_sent_at: string | null;
  /** Why no message went out; null when it did. */
  whatsapp_error: string | null;
  /** Which monitored thing raised this, or 'manual' for an operator alert. */
  source_kind: 'vm' | 'app' | 'openai' | 'manual' | null;
  source_id: string | null;
  status: AlertStatus;
  created_at: string;
  resolved_at: string | null;
}

/**
 * Outcome of one OpenAI project check. This says whether the project can
 * currently make a billable request — NOT what its dollar balance is, which no
 * API exposes for a project key.
 */
export type OpenAiCheckStatus = 'CREDIT_AVAILABLE' | 'NO_CREDIT' | 'INVALID_KEY' | 'CHECK_FAILED';

/**
 * A client's OpenAI project, tracked only as "can it make requests right now".
 * The key itself never reaches the browser — `has_key` and the masked `label`
 * stand in for it.
 */
export interface OpenAiAccount {
  id: string;
  client_id: string;
  /** Project name, as the operator typed it. */
  name: string;
  /** Masked hint for the stored key, e.g. "sk-…4f2a". Never the key itself. */
  label: string | null;
  status: OpenAiCheckStatus;
  /** A no-credit WhatsApp has been delivered for the current episode. */
  alerted: boolean;
  last_alerted_at: string | null;
  /** Contact person for this project's alerts; falls back to the client's. */
  alert_name: string | null;
  alert_phone: string | null;
  /** Null until the first check runs. */
  last_checked_at: string | null;
  last_check_error: string | null;
  created_at: string;
  has_key: boolean;
}

export interface WebinarStage {
  id: string;
  webinar_id: string;
  stage: string;
  triggered: number;
  succeeded: number;
  failed: number;
  sort_order: number;
}

export interface Webinar {
  id: string;
  client_id: string;
  name: string;
  participants: number;
  reminders: number;
  attendance: number;
  webinar_date: string | null;
  status: Status;
  created_at: string;
  webinar_stages?: WebinarStage[];
}

export interface Integration {
  id: string;
  name: string;
  detail: string | null;
  status: Status;
  sort_order: number;
}

export type ZoomKind = 'webinar' | 'meeting';

export interface ZoomAccount {
  id: string;
  client_id: string;
  name: string;
  account_id: string | null;
  label: string | null;
  last_synced_at: string | null;
  last_sync_error: string | null;
  created_at: string;
}

export interface ZoomSession {
  id: string;
  zoom_account_id: string;
  client_id: string;
  kind: ZoomKind;
  zoom_id: string;
  zoom_uuid: string;
  topic: string;
  host_email: string | null;
  start_time: string | null;
  duration_min: number | null;
  registrants_count: number;
  participants_count: number;
  attendance_pct: number;
  // Cached engagement metrics (filled in when a session is opened).
  unique_participants: number | null;
  peak_concurrent: number | null;
  avg_duration_min: number | null;
  rejoins: number | null;
  metrics_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface UptimeSample {
  id: string;
  client_id: string | null;
  day: string;
  uptime: number;
}

// Client with its related rows attached (used on the detail page).
export interface ClientFull extends Client {
  vms: VM[];
  apps: App[];
  alerts: Alert[];
  webinars: Webinar[];
}

// Client summary row used in lists (derived fields computed server-side).
export interface ClientSummary extends Client {
  project_count: number;
  healthy_count: number;
  issue_count: number;
  overall_status: Status;
  avg_uptime: number;
}

// ---- helpers -------------------------------------------------------------

export const STATUS_LABEL: Record<Status, string> = {
  healthy: 'Healthy',
  warning: 'Warning',
  down: 'Down',
};

export const APP_STATUS_LABEL: Record<Status, string> = {
  healthy: 'Running',
  warning: 'Warning',
  down: 'Failed',
};

// Roll up a set of statuses to a single overall status (down > warning > healthy).
export function rollupStatus(statuses: Status[]): Status {
  if (statuses.includes('down')) return 'down';
  if (statuses.includes('warning')) return 'warning';
  return 'healthy';
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0] || '')
    .join('')
    .toUpperCase();
}