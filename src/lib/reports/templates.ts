// Templates are DATA, not code. A template names a set of lenses and a set of
// output blocks; the engine already knows how to compute all of them. Adding
// "AI vs Manual, buyers only" is an INSERT into report_templates — no engine
// change, no deploy.
//
// These built-ins mirror the rows seeded by migration_12; they are the fallback
// when the migration has not been run yet.

import type { BlockId, InputRole, LensId, ReportTemplate } from './types';

export const BUILTIN_TEMPLATES: ReportTemplate[] = [
  {
    id: 'builtin:ai_only',
    client_id: null,
    key: 'ai_only',
    name: 'AI-only report',
    description:
      'The standard AI-calling performance report. Headline uses the time-based AI-weeks lens because it carries the least selection bias.',
    lenses: ['L3', 'L1', 'L6', 'L5'],
    blocks: ['scorecard', 'funnel', 'per_webinar', 'who_bought', 'roi'],
    requires: ['calls', 'attendance'],
    optional_roles: ['leads', 'sales', 'cost'],
    primary_lens: 'L3',
    is_builtin: true,
    sort_order: 10,
  },
  {
    id: 'builtin:ai_vs_manual',
    client_id: null,
    key: 'ai_vs_manual',
    name: 'AI vs Manual',
    description: 'Compares the AI dialer against the human calling team. Needs at least one call log marked manual.',
    lenses: ['L4', 'L3', 'L1'],
    blocks: ['scorecard', 'funnel', 'per_webinar', 'who_bought', 'roi'],
    requires: ['calls', 'attendance'],
    optional_roles: ['leads', 'sales', 'cost'],
    primary_lens: 'L4',
    is_builtin: true,
    sort_order: 20,
  },
  {
    id: 'builtin:called_vs_not',
    client_id: null,
    key: 'called_vs_not',
    name: 'Called vs Not-called',
    description: 'Registrants we dialled against registrants we never dialled. Directional only.',
    lenses: ['L2', 'L1', 'L6'],
    blocks: ['scorecard', 'funnel', 'per_webinar', 'who_bought'],
    requires: ['leads', 'calls', 'attendance'],
    optional_roles: ['sales', 'cost'],
    primary_lens: 'L2',
    is_builtin: true,
    sort_order: 30,
  },
  {
    id: 'builtin:per_bot',
    client_id: null,
    key: 'per_bot',
    name: 'Per-bot breakdown',
    description: 'Signup-confirmation bot vs day-of reminder bot vs both, against the dialled-but-not-reached baseline.',
    lenses: ['L5', 'L1', 'L6'],
    blocks: ['scorecard', 'funnel', 'per_webinar', 'who_bought', 'roi'],
    requires: ['leads', 'calls', 'attendance'],
    optional_roles: ['sales', 'cost'],
    primary_lens: 'L5',
    is_builtin: true,
    sort_order: 40,
  },
  {
    id: 'builtin:leave_comeback',
    client_id: null,
    key: 'leave_comeback',
    name: 'Leave & comeback',
    description: 'People who left the webinar early and came back via the reminder link, and how many of them bought.',
    lenses: ['L7'],
    blocks: ['scorecard', 'funnel', 'per_webinar', 'who_bought'],
    requires: ['attendance'],
    optional_roles: ['leads', 'calls', 'sales', 'comeback', 'cost'],
    primary_lens: 'L7',
    is_builtin: true,
    sort_order: 50,
  },
  {
    id: 'builtin:full_audit',
    client_id: null,
    key: 'full_audit',
    name: 'Full audit (all lenses)',
    description: 'Every lens the data supports, credible ones first. Shows how far the answer moves between a biased lens and an unbiased one.',
    lenses: ['L3', 'L5', 'L7', 'L4', 'L1', 'L2', 'L6'],
    blocks: ['scorecard', 'funnel', 'per_webinar', 'who_bought', 'roi'],
    requires: ['leads', 'calls', 'attendance'],
    optional_roles: ['sales', 'cost', 'comeback'],
    primary_lens: 'L3',
    is_builtin: true,
    sort_order: 60,
  },
];

// Everything the client actually asks for lives under "AI calling" as a
// whole — the called/not-called split is now part of the funnel block
// (see buildFunnel in engine.ts) and the per-bot breakdown (lens L5) is
// force-included in every report — so these are no longer offered as
// separate report types when creating a new report. Left in the DB/engine
// (not deleted) so a report already using one of these keys keeps working.
export const HIDDEN_TEMPLATE_KEYS = ['called_vs_not', 'per_bot', 'leave_comeback', 'full_audit'] as const;

// Templates shown when picking a report type. `keepKey` (a report's current
// template_key) is exempted so an existing report on a hidden template still
// shows correctly in its own switcher instead of disappearing.
export function visibleTemplates(templates: ReportTemplate[], keepKey?: string | null): ReportTemplate[] {
  return templates.filter((t) => t.key === keepKey || !HIDDEN_TEMPLATE_KEYS.includes(t.key as any));
}

// Coerce a DB row (loose text[] columns) into a typed template.
export function normaliseTemplate(row: any): ReportTemplate {
  return {
    id: String(row.id),
    client_id: row.client_id ?? null,
    key: String(row.key),
    name: String(row.name),
    description: row.description ?? null,
    lenses: (row.lenses ?? []) as LensId[],
    blocks: (row.blocks ?? []) as BlockId[],
    requires: (row.requires ?? []) as InputRole[],
    optional_roles: (row.optional_roles ?? []) as InputRole[],
    primary_lens: (row.primary_lens ?? null) as LensId | null,
    is_builtin: !!row.is_builtin,
    sort_order: Number(row.sort_order ?? 100),
  };
}

export interface TemplateValidity {
  valid: boolean;
  missing: InputRole[];
  reason: string | null;
}

// A template is runnable when every required input role has at least one
// dataset attached. The UI greys out the rest and says exactly what is missing.
export function checkTemplate(t: ReportTemplate, presentRoles: InputRole[]): TemplateValidity {
  const have = new Set(presentRoles);
  const missing = t.requires.filter((r) => !have.has(r));
  return {
    valid: missing.length === 0,
    missing,
    reason: missing.length ? `Needs ${missing.join(', ')}.` : null,
  };
}
