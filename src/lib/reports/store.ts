// Persistence helpers shared by the report API routes. Server-only.

import { exec, insertMany, jsonb, maybeOne, sql } from '@/lib/db';
import type { LoadedDataset } from './facts';
import { BUILTIN_TEMPLATES, normaliseTemplate } from './templates';
import {
  DEFAULT_ASSUMPTIONS,
  type Assumptions,
  type Fact,
  type InputRole,
  type QualityPanel,
  type ReportResult,
  type ReportTemplate,
} from './types';
import type { ExclusionRow } from './identity';

const INSERT_BATCH = 500;

// Column order for a report_facts insert. Fixed explicitly rather than derived
// from Object.keys(fact) so a future field on the Fact type cannot silently
// produce an "column does not exist" error at run time.
const FACT_COLS = [
  'report_id',
  'person_key',
  'session_key',
  'name',
  'phone',
  'email',
  'registered',
  'dialled',
  'connected',
  'talk_turns',
  'engaged',
  'talked',
  'bots',
  'bot_id',
  'call_mode',
  'call_time',
  'call_seconds',
  'showed_up',
  'watch_minutes',
  'left_early',
  'came_back',
  'bought',
  'order_value',
  'order_time',
  'holdout',
  'week',
  'session_date',
  'ai_week',
];

export async function loadDatasets(reportId: string): Promise<LoadedDataset[]> {
  const rows = await sql<{
    id: string;
    role: InputRole;
    source: 'upload' | 'zoom_api';
    filename: string;
    shape: string;
    mapping: Record<string, string> | null;
    options: Record<string, unknown> | null;
  }>(
    `select id, role, source, filename, shape, mapping, options
       from report_datasets
      where report_id = $1
      order by created_at asc`,
    [reportId]
  );

  const out: LoadedDataset[] = [];
  for (const d of rows) {
    const r = await loadRows(d.id);
    out.push({
      id: d.id,
      role: d.role,
      source: d.source,
      filename: d.filename,
      shape: d.shape as LoadedDataset['shape'],
      mapping: d.mapping ?? {},
      options: d.options ?? {},
      rows: r.main,
      session_rows: r.session,
    });
  }
  return out;
}

// No pagination needed here: unlike PostgREST, a direct connection has no
// implicit 1000-row cap, so one ordered scan returns the whole dataset.
export async function loadRows(
  datasetId: string
): Promise<{ main: Record<string, string>[]; session: Record<string, string>[] }> {
  const rows = await sql<{ block: string; data: Record<string, string> }>(
    'select block, data from report_dataset_rows where dataset_id = $1 order by row_index asc',
    [datasetId]
  );
  const main: Record<string, string>[] = [];
  const session: Record<string, string>[] = [];
  for (const r of rows) {
    if (r.block === 'session') session.push(r.data);
    else main.push(r.data);
  }
  return { main, session };
}

export async function insertRows(
  datasetId: string,
  main: Record<string, string>[],
  sessionRows: Record<string, string>[]
): Promise<void> {
  const payload = [
    ...sessionRows.map((data, i) => ({ dataset_id: datasetId, row_index: i, block: 'session', data: jsonb(data) })),
    ...main.map((data, i) => ({ dataset_id: datasetId, row_index: i, block: 'main', data: jsonb(data) })),
  ];
  for (let i = 0; i < payload.length; i += INSERT_BATCH) {
    await insertMany('report_dataset_rows', payload.slice(i, i + INSERT_BATCH), [
      'dataset_id',
      'row_index',
      'block',
      'data',
    ]);
  }
}

export async function loadExclusions(clientId: string): Promise<ExclusionRow[]> {
  try {
    return await sql<ExclusionRow>('select kind, value from report_exclusions where client_id = $1', [
      clientId,
    ]);
  } catch {
    return []; // an un-migrated install should not break a run
  }
}

// Templates: client overrides win over the global row of the same key; if the
// migration has not been run we still work off the compiled-in built-ins.
export async function loadTemplates(clientId: string | null): Promise<ReportTemplate[]> {
  let data: any[];
  try {
    data = await sql(
      `select * from report_templates
        where client_id is null or client_id = $1
        order by sort_order asc`,
      [clientId]
    );
  } catch {
    return BUILTIN_TEMPLATES;
  }
  if (!data.length) return BUILTIN_TEMPLATES;
  const byKey = new Map<string, ReportTemplate>();
  for (const t of data.map(normaliseTemplate)) {
    const cur = byKey.get(t.key);
    if (!cur || (t.client_id && !cur.client_id)) byKey.set(t.key, t);
  }
  const merged = [...byKey.values()];
  return merged.length ? merged.sort((a, b) => a.sort_order - b.sort_order) : BUILTIN_TEMPLATES;
}

export async function loadTemplate(
  clientId: string | null,
  key: string
): Promise<ReportTemplate | null> {
  const all = await loadTemplates(clientId);
  return all.find((t) => t.key === key) ?? null;
}

// Merge stored assumptions over the defaults so an old report re-runs even
// after a new knob is added to the engine.
export function mergeAssumptions(stored: unknown): Assumptions {
  const s = (stored ?? {}) as Partial<Assumptions>;
  return {
    ...DEFAULT_ASSUMPTIONS,
    ...s,
    connected_statuses: s.connected_statuses?.length ? s.connected_statuses : DEFAULT_ASSUMPTIONS.connected_statuses,
    ai_weeks: s.ai_weeks ?? [],
    exclude_products: s.exclude_products ?? [],
    // Array/enum knobs added after the first reports were saved: an older
    // assumption set has them undefined, and `...s` would otherwise overwrite
    // the default with undefined and blow up on `.length` / `.some()`.
    coupon_codes: s.coupon_codes ?? [],
    product_prices: s.product_prices ?? [],
    exclude_tags: s.exclude_tags ?? DEFAULT_ASSUMPTIONS.exclude_tags,
    zero_without_coupon: s.zero_without_coupon ?? DEFAULT_ASSUMPTIONS.zero_without_coupon,
    talk_rule: s.talk_rule ?? DEFAULT_ASSUMPTIONS.talk_rule,
    talk_min_seconds: s.talk_min_seconds ?? DEFAULT_ASSUMPTIONS.talk_min_seconds,
    crosswalk_enabled: s.crosswalk_enabled ?? DEFAULT_ASSUMPTIONS.crosswalk_enabled,
    crosswalk_use_name: s.crosswalk_use_name ?? DEFAULT_ASSUMPTIONS.crosswalk_use_name,
  };
}

export async function saveFacts(reportId: string, facts: Fact[]): Promise<void> {
  await exec('delete from report_facts where report_id = $1', [reportId]);
  const payload = facts.map((f) => ({ report_id: reportId, ...f }));
  for (let i = 0; i < payload.length; i += INSERT_BATCH) {
    await insertMany('report_facts', payload.slice(i, i + INSERT_BATCH), FACT_COLS);
  }
}

/**
 * Snapshot one completed run so it stays openable after later re-runs.
 *
 * `calling_reports.result` only ever holds the newest run, which threw away
 * every earlier version — and re-versioning is the normal workflow here, not an
 * exception. Rows are immutable; a conflicting version number means the same
 * run was recorded twice, so it is ignored rather than overwritten.
 */
export async function snapshotVersion(
  reportId: string,
  version: number,
  data: {
    template_key: string;
    period_label: string | null;
    assumptions: Assumptions;
    result: ReportResult;
    quality: QualityPanel;
  }
): Promise<void> {
  const r = data.result;
  const buyers = r.funnel.find((s) => s.stage === 'Bought')?.count ?? null;
  const revenue = r.who_bought
    .filter((b) => b.within_window)
    .reduce((t, b) => t + (Number(b.order_value) || 0), 0);

  await exec(
    `insert into report_versions
       (report_id, version, template_key, period_label, assumptions, result, quality,
        quality_hash, fact_count, headline, primary_lens, buyers, revenue)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     on conflict (report_id, version) do nothing`,
    [
      reportId,
      version,
      data.template_key,
      data.period_label,
      jsonb(data.assumptions),
      jsonb(r),
      jsonb(data.quality),
      data.quality?.hash ?? null,
      r.fact_count ?? 0,
      r.scorecard?.headline ?? null,
      r.scorecard?.primary_lens ?? null,
      buyers,
      Math.round(revenue),
    ]
  );
}

// Remember this file's column mapping so next month's identical export maps
// itself. This is what turns month 2 into "upload two files and click".
export async function rememberMapping(
  clientId: string,
  role: InputRole,
  signature: string,
  mapping: Record<string, string>,
  options: Record<string, unknown>
): Promise<void> {
  // One statement instead of select-then-branch: the unique index on
  // (client_id, role, header_signature) makes the conflict path exact.
  await exec(
    `insert into report_column_mappings (client_id, role, header_signature, mapping, options)
     values ($1, $2, $3, $4, $5)
     on conflict (client_id, role, header_signature) do update
        set mapping      = excluded.mapping,
            options      = excluded.options,
            use_count    = report_column_mappings.use_count + 1,
            last_used_at = now()`,
    [clientId, role, signature, jsonb(mapping), jsonb(options)]
  );
}

export async function recallMapping(
  clientId: string,
  role: InputRole,
  signature: string
): Promise<{ mapping: Record<string, string>; options: Record<string, unknown> } | null> {
  try {
    const row = await maybeOne<{
      mapping: Record<string, string> | null;
      options: Record<string, unknown> | null;
    }>(
      `select mapping, options from report_column_mappings
        where client_id = $1 and role = $2 and header_signature = $3`,
      [clientId, role, signature]
    );
    if (!row) return null;
    return { mapping: row.mapping ?? {}, options: row.options ?? {} };
  } catch {
    return null;
  }
}
