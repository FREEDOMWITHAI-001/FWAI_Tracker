// The engine. Datasets in, one ReportResult out.
//
//   ingest -> mapping -> identity -> facts -> lenses -> roi -> render
//
// Re-running with different assumptions touches nothing before `facts`: the
// raw rows are already in Postgres. That is the whole reason this exists —
// GoNature took 10 file versions and Flute Gandharvas 15, and every single one
// was an assumption change, not new data.

import { analysisFacts, buildFacts, type LoadedDataset } from './facts';
import { buildQuality } from './quality';
import { buildRoi } from './roi';
import { runLenses } from './lenses';
import { Exclusions, type ExclusionRow } from './identity';
import { proportion, relativeLift } from './stats';
import type {
  AiVsManualBlock,
  Assumptions,
  BuyerRow,
  ChannelBasis,
  ChannelPerWebinarStat,
  Fact,
  FunnelStage,
  LensResult,
  Outcome,
  PerWebinarRow,
  QualityPanel,
  RegisteredRetargetedBlock,
  ReportResult,
  ReportTemplate,
  Scorecard,
} from './types';

export interface RunInput {
  template: ReportTemplate;
  assumptions: Assumptions;
  datasets: LoadedDataset[];
  exclusions: ExclusionRow[];
  period_label: string | null;
}

export interface RunOutput {
  result: ReportResult;
  quality: QualityPanel;
  facts: Fact[]; // per (person x session) — persisted for drill-down
}

export function runReport(input: RunInput): RunOutput {
  const { template, assumptions: a } = input;
  const ex = new Exclusions(input.exclusions);
  const build = buildFacts(input.datasets, a, ex);
  const analysis = analysisFacts(build.facts, a.dedup_mode);

  // ---- denominator lock -------------------------------------------------
  // One population, computed once, used by every block and every lens table.
  // With no leads/registrations file, `registered` (set in facts.ts) already
  // falls back to "was dialled" per-fact — reflect that in the label too, so
  // the sheet doesn't claim a registration list that was never uploaded.
  const hasLeads = build.has_leads;
  const registered = analysis.filter((f) => f.registered);
  const denominator = registered.length || analysis.length;
  const denominatorLabel = !registered.length
    ? 'People seen in any input file'
    : hasLeads
      ? a.dedup_mode === 'unique_member'
        ? 'Unique registered members'
        : 'Registration rows'
      : a.dedup_mode === 'unique_member'
        ? 'Unique called people (no registration file provided)'
        : 'Call rows (no registration file provided)';

  // Per-bot (L5) is wanted on EVERY report, not just the per-bot template, so it
  // is forced in here rather than added to each template's lens list — that list
  // lives in the database and an operator's edit could otherwise drop it. When
  // there is no bot column the lens reports itself unavailable, which is still
  // more useful than the block silently missing.
  const lensIds = template.lenses.includes('L5') ? template.lenses : [...template.lenses, 'L5' as const];
  const lenses = runLenses(lensIds, analysis, build, a);
  const roi = buildRoi(analysis, build, a, lenses, template.primary_lens);
  const quality = buildQuality(build, analysis, a, denominator, denominatorLabel);

  const funnel = buildFunnel(analysis, denominator, denominatorLabel);
  const perWebinar = buildPerWebinar(build.facts, build.sessions);
  const whoBought = buildWhoBought(build);
  const buyersTalked = buildBuyersTalked(whoBought, build, a);
  const registeredVsRetargeted = buildRegisteredVsRetargeted(analysis, hasLeads);
  const aiVsManual = buildAiVsManual(analysis, perWebinar, input.datasets);
  const scorecard = buildScorecard(analysis, lenses, roi, template, a, denominator, denominatorLabel);

  const result: ReportResult = {
    template_key: template.key,
    template_name: template.name,
    generated_at: new Date().toISOString(),
    period_label: input.period_label,
    assumptions: a,
    scorecard,
    funnel,
    per_webinar: perWebinar,
    who_bought: whoBought,
    buyers_talked: buyersTalked,
    registered_vs_retargeted: registeredVsRetargeted,
    ai_vs_manual: aiVsManual,
    roi,
    lenses,
    sessions: build.sessions,
    fact_count: build.facts.length,
    blocks: template.blocks,
  };

  return { result, quality, facts: build.facts };
}

// --- funnel ----------------------------------------------------------------

function buildFunnel(facts: Fact[], denominator: number, label: string): FunnelStage[] {
  const dialled = facts.filter((f) => f.dialled).length;
  const connected = facts.filter((f) => f.connected).length;
  const showed = facts.filter((f) => f.showed_up).length;
  const bought = facts.filter((f) => f.bought).length;
  // "Not picked" and "Not called" are complements of Dialled/Connected, not
  // further drops in the main line — each is shown as a % of the stage it
  // splits off from (Dialled, denominator) rather than of the row above it.
  const notPicked = dialled - connected;
  const notCalled = denominator - dialled;

  const stage = (s: string, count: number, prevCount: number | null, basisLabel: string | null): FunnelStage => ({
    stage: s,
    count,
    pct_of_denominator: denominator ? count / denominator : 0,
    pct_of_previous: prevCount == null ? null : prevCount ? count / prevCount : null,
    pct_of_previous_label: prevCount == null ? null : basisLabel,
  });

  return [
    stage(label, denominator, null, null),
    stage('Dialled', dialled, denominator, label),
    stage('Connected', connected, dialled, 'Dialled'),
    stage('Not picked', notPicked, dialled, 'Dialled'),
    stage('Not called', notCalled, denominator, label),
    stage('Showed up', showed, connected, 'Connected'),
    stage('Bought', bought, showed, 'Showed up'),
  ];
}

// --- per-webinar -----------------------------------------------------------

function buildPerWebinar(facts: Fact[], sessions: ReportResult['sessions']): PerWebinarRow[] {
  const byKey = new Map<string, Fact[]>();
  for (const f of facts) {
    const arr = byKey.get(f.session_key);
    if (arr) arr.push(f);
    else byKey.set(f.session_key, [f]);
  }
  const rows: PerWebinarRow[] = [];
  for (const s of sessions) {
    const fs = byKey.get(s.key) ?? [];
    if (!fs.length) continue;
    const showed = fs.filter((f) => f.showed_up).length;
    const bought = fs.filter((f) => f.bought).length;
    rows.push({
      session_key: s.key,
      topic: s.topic,
      date: s.date,
      week: s.week,
      ai_week: fs.some((f) => f.ai_week),
      registered: fs.filter((f) => f.registered).length,
      dialled: fs.filter((f) => f.dialled).length,
      connected: fs.filter((f) => f.connected).length,
      showed,
      bought,
      revenue: Math.round(fs.reduce((t, f) => t + (f.order_value ?? 0), 0)),
      show_rate: fs.length ? showed / fs.length : 0,
      buy_rate: fs.length ? bought / fs.length : 0,
      excluded: s.excluded,
    });
  }
  return rows.sort((x, y) => (x.date ?? '').localeCompare(y.date ?? ''));
}

// --- who bought ------------------------------------------------------------

function buildWhoBought(build: ReturnType<typeof buildFacts>): BuyerRow[] {
  // Coupon lives on the order, not the fact — index it so the buyer row can
  // show WHY a ₹0 order was counted.
  const couponFor = new Map<string, string>();
  for (const o of build.orders) {
    if (o.person_key && o.coupon && !couponFor.has(o.person_key)) couponFor.set(o.person_key, o.coupon);
  }

  const rows: BuyerRow[] = build.facts
    .filter((f) => f.bought)
    .map((f) => ({
      name: f.name,
      phone: f.phone,
      email: f.email,
      session_key: f.session_key,
      session_date: f.session_date,
      dialled: f.dialled,
      connected: f.connected,
      talked: f.talked,
      talk_turns: f.talk_turns,
      engaged: f.engaged,
      call_seconds: f.call_seconds,
      bot_id: f.bot_id,
      bots: f.bots ?? [],
      call_mode: f.call_mode,
      call_time: f.call_time,
      showed_up: f.showed_up,
      came_back: f.came_back,
      order_value: f.order_value ?? 0,
      coupon: couponFor.get(f.person_key) ?? null,
      order_time: f.order_time,
      within_window: true,
    }));

  // Buyers we could not attribute are shown too, flagged — hiding them is how
  // a report ends up disagreeing with the client's own sales sheet.
  for (const o of build.unattributed_orders) {
    rows.push({
      name: o.name,
      phone: o.phone,
      email: o.email,
      session_key: o.attributed_session ?? '—',
      session_date: null,
      dialled: false,
      connected: false,
      talked: false,
      talk_turns: null,
      engaged: false,
      call_seconds: null,
      bot_id: null,
      bots: [],
      call_mode: null,
      call_time: null,
      showed_up: false,
      came_back: false,
      order_value: o.amount,
      coupon: o.coupon,
      order_time: o.order_time,
      within_window: false,
    });
  }
  return rows.sort((x, y) => (y.order_time ?? '').localeCompare(x.order_time ?? ''));
}

// --- buyers who actually talked --------------------------------------------

// "Did they buy after a real conversation, or after a 2-second pickup?"
//
// Turns are the stronger signal when the dialer exports them, so they win;
// otherwise the duration floor stands in. Both thresholds travel with the block
// so the sheet states its own rule rather than relying on the reader to know it.
function buildBuyersTalked(
  whoBought: BuyerRow[],
  build: ReturnType<typeof buildFacts>,
  a: Assumptions
): ReportResult['buyers_talked'] {
  const attributed = whoBought.filter((b) => b.within_window);
  const total = attributed.length;

  const haveTurns = build.has_talk_turns;
  // With the talk rule off, `Fact.talked` degrades to plain `connected`, so the
  // duration fallback would admit anyone who picked up. Ignore it in that mode
  // rather than advertising a threshold that is not being applied.
  const haveDuration = build.has_duration && a.talk_rule !== 'off';

  if (!haveTurns && !haveDuration) {
    return {
      available: false,
      reason:
        'The call log has neither a talk-turns column nor a duration column, so "actually talked" cannot be distinguished from "picked up".',
      criterion: '—',
      min_turns: a.engaged_min_turns,
      min_seconds: a.talk_min_seconds,
      buyers: [],
      total_buyers: total,
      share_of_buyers: 0,
      revenue: 0,
    };
  }

  const criterion = haveTurns
    ? `Connected AND at least ${a.engaged_min_turns} talk turns` +
      (haveDuration ? ` (or a connected call of ≥ ${a.talk_min_seconds}s where turns are missing)` : '')
    : `Connected AND the longest single call lasted ≥ ${a.talk_min_seconds}s`;

  const buyers = attributed.filter((b) => {
    if (!b.connected) return false;
    if (haveTurns && b.talk_turns != null) return b.talk_turns >= a.engaged_min_turns;
    return haveDuration ? b.talked : false;
  });

  const revenue = Math.round(buyers.reduce((t, b) => t + (Number(b.order_value) || 0), 0));
  return {
    available: true,
    criterion,
    min_turns: a.engaged_min_turns,
    min_seconds: a.talk_min_seconds,
    buyers,
    total_buyers: total,
    share_of_buyers: total ? buyers.length / total : 0,
    revenue,
  };
}

// --- registered vs retargeted -----------------------------------------------

function buildRegisteredVsRetargeted(facts: Fact[], hasLeads: boolean): RegisteredRetargetedBlock {
  const basis: 'leads' | 'called' = hasLeads ? 'leads' : 'called';
  const registered = facts.filter((f) => f.registered);
  const retargeted = facts.filter((f) => !f.registered && (f.showed_up || f.bought));

  if (!registered.length) {
    return {
      available: false,
      reason: 'No leads/registrations file is present, so nobody can be marked "registered".',
      basis,
      attended_registered: 0,
      attended_retargeted: 0,
      bought_registered: 0,
      bought_retargeted: 0,
    };
  }
  if (!retargeted.length) {
    return {
      available: false,
      reason:
        basis === 'leads'
          ? 'Every attendee/buyer was on the registration list — nobody attended or bought without registering.'
          : 'Every attendee/buyer was dialled — nobody attended or bought without being called.',
      basis,
      attended_registered: registered.filter((f) => f.showed_up).length,
      attended_retargeted: 0,
      bought_registered: registered.filter((f) => f.bought).length,
      bought_retargeted: 0,
    };
  }
  return {
    available: true,
    basis,
    attended_registered: registered.filter((f) => f.showed_up).length,
    attended_retargeted: retargeted.filter((f) => f.showed_up).length,
    bought_registered: registered.filter((f) => f.bought).length,
    bought_retargeted: retargeted.filter((f) => f.bought).length,
  };
}

// --- AI vs manual head-to-head -----------------------------------------------
//
// Complements lens L4 (per-dialled-lead only) with the other two bases a
// client asks for, plus a per-webinar average so a 5-webinar manual run and
// a 4-webinar AI run are compared fairly instead of by raw totals. A session
// is attributed to whichever channel dialled more people for it.

function emptyChannelStat(): ChannelPerWebinarStat {
  return { webinars: 0, calls_avg: 0, buyers_avg: 0, buy_rate_avg: 0 };
}

function channelBasis(label: string, manualK: number, manualN: number, aiK: number, aiN: number): ChannelBasis {
  const manual = proportion('Manual', manualK, manualN);
  const ai = proportion('AI', aiK, aiN);
  const rel_diff = relativeLift(ai.rate, manual.rate);
  const winner: ChannelBasis['winner'] = manual.rate === ai.rate ? 'tie' : ai.rate > manual.rate ? 'ai' : 'manual';
  return { label, manual, ai, winner, rel_diff };
}

function buildAiVsManual(facts: Fact[], perWebinar: PerWebinarRow[], datasets: LoadedDataset[]): AiVsManualBlock {
  const callDatasets = datasets.filter((d) => d.role === 'calls');
  const rawCalls: { manual: number; ai: number } = { manual: 0, ai: 0 };
  for (const ds of callDatasets) {
    const mode = ds.options?.call_mode === 'manual' ? 'manual' : 'ai';
    rawCalls[mode] += ds.rows.length;
  }
  const hasManual = callDatasets.some((d) => d.options?.call_mode === 'manual');
  const hasAi = callDatasets.some((d) => d.options?.call_mode !== 'manual');

  if (!hasManual || !hasAi) {
    return {
      available: false,
      reason: 'Needs at least one call log marked AI and one marked manual.',
      calls_made: rawCalls,
      relative: [],
      per_webinar: { manual: emptyChannelStat(), ai: emptyChannelStat() },
      notes: [],
    };
  }

  const dialledAi = facts.filter((f) => f.call_mode === 'ai');
  const dialledManual = facts.filter((f) => f.call_mode === 'manual');
  const talkedAi = dialledAi.filter((f) => f.talked);
  const talkedManual = dialledManual.filter((f) => f.talked);

  const relative: ChannelBasis[] = [
    channelBasis(
      'Buy rate per call made',
      dialledManual.filter((f) => f.bought).length,
      rawCalls.manual,
      dialledAi.filter((f) => f.bought).length,
      rawCalls.ai
    ),
    channelBasis(
      'Buy rate per distinct lead (dialled)',
      dialledManual.filter((f) => f.bought).length,
      dialledManual.length,
      dialledAi.filter((f) => f.bought).length,
      dialledAi.length
    ),
    channelBasis(
      'Buy rate per genuine conversation (talked)',
      talkedManual.filter((f) => f.bought).length,
      talkedManual.length,
      talkedAi.filter((f) => f.bought).length,
      talkedAi.length
    ),
  ];

  // A session's channel = whichever side dialled more people for it. Sessions
  // nobody dialled are excluded — they cannot be attributed either way.
  const bySession = new Map<string, Fact[]>();
  for (const f of facts) {
    if (!f.dialled || !f.call_mode) continue;
    const arr = bySession.get(f.session_key);
    if (arr) arr.push(f);
    else bySession.set(f.session_key, [f]);
  }
  const sessionChannel = new Map<string, 'ai' | 'manual'>();
  for (const [key, fs] of bySession) {
    const ai = fs.filter((f) => f.call_mode === 'ai').length;
    const manual = fs.filter((f) => f.call_mode === 'manual').length;
    sessionChannel.set(key, ai >= manual ? 'ai' : 'manual');
  }

  const perWebinarByChannel = (channel: 'ai' | 'manual'): ChannelPerWebinarStat => {
    const rows = perWebinar.filter((w) => !w.excluded && sessionChannel.get(w.session_key) === channel);
    if (!rows.length) return emptyChannelStat();
    const avg = (f: (w: PerWebinarRow) => number) => rows.reduce((t, w) => t + f(w), 0) / rows.length;
    const buyersAvg = avg((w) => w.bought);
    const dialledAvg = avg((w) => w.dialled);
    return {
      webinars: rows.length,
      calls_avg: dialledAvg,
      buyers_avg: buyersAvg,
      buy_rate_avg: dialledAvg ? buyersAvg / dialledAvg : 0,
    };
  };

  return {
    available: true,
    calls_made: rawCalls,
    relative,
    per_webinar: { manual: perWebinarByChannel('manual'), ai: perWebinarByChannel('ai') },
    notes: [
      '"Talked" uses this report\'s own definition (talk-turns or duration threshold), applied the same way to ' +
        'both channels — a hand-built report that used a looser proxy for one channel (e.g. any connected call) will not match this exactly.',
      'A webinar is attributed to whichever channel dialled more people for it; webinars nobody dialled are excluded from the per-webinar averages.',
      '"Buy rate per call made" divides by raw call-log rows (every dial attempt), not distinct people, so it is usually lower than the per-distinct-lead rate.',
    ],
  };
}

// --- scorecard -------------------------------------------------------------

function buildScorecard(
  facts: Fact[],
  lenses: LensResult[],
  roi: ReportResult['roi'],
  template: ReportTemplate,
  a: Assumptions,
  denominator: number,
  denominatorLabel: string
): Scorecard {
  const available = lenses.filter((l) => l.available);
  const primary =
    available.find((l) => l.id === template.primary_lens) ??
    available.find((l) => l.credibility === 'causal') ??
    available[0] ??
    null;

  const dialled = facts.filter((f) => f.dialled).length;
  const connected = facts.filter((f) => f.connected).length;
  const showed = facts.filter((f) => f.showed_up).length;
  const buyers = facts.filter((f) => f.bought).length;
  const revenue = Math.round(facts.reduce((t, f) => t + (f.order_value ?? 0), 0));

  const pct = (n: number, d: number) => (d ? `${((n / d) * 100).toFixed(1)}%` : '—');

  const tiles = [
    { label: denominatorLabel, value: denominator.toLocaleString(), detail: 'locked denominator for every sheet' },
    { label: 'Dialled', value: dialled.toLocaleString(), detail: `${pct(dialled, denominator)} of population` },
    { label: 'Connected', value: connected.toLocaleString(), detail: `${pct(connected, dialled)} of dialled` },
    { label: 'Showed up', value: showed.toLocaleString(), detail: `${pct(showed, denominator)} of population` },
    { label: 'Buyers', value: buyers.toLocaleString(), detail: `${pct(buyers, denominator)} of population` },
    { label: 'Revenue', value: `₹${revenue.toLocaleString()}`, detail: 'attributed inside the window' },
  ];
  if (roi.available) {
    tiles.push({
      label: 'ROI',
      value: roi.incremental_roi != null ? `${roi.incremental_roi.toFixed(1)}x` : roi.gross_roi != null ? `${roi.gross_roi.toFixed(1)}x` : '—',
      detail: roi.incremental_roi != null ? `incremental, via ${roi.incremental_lens}` : 'gross — no credible lens available',
    });
  }

  let headline: string;
  let bottom: string;

  if (!primary) {
    headline = 'No comparison in this template could be computed from the inputs supplied.';
    bottom = 'Add the missing input files, or pick a template whose requirements the current uploads satisfy.';
  } else {
    const buy = primary.outcomes.find((o) => o.metric === 'bought');
    const show = primary.outcomes.find((o) => o.metric === 'showed_up');
    // Headline quotes the session-weighted (normalised) lift when it exists —
    // the pooled lift is still on the lens table for comparison.
    const liftAbs = (o: Outcome) => o.normalized?.abs_lift ?? o.abs_lift;
    const liftRel = (o: Outcome) => (o.normalized ? o.normalized.rel_lift : o.rel_lift);
    const weighted = Boolean(show?.normalized || buy?.normalized);
    const parts: string[] = [];
    if (show) parts.push(`show-up ${signed(liftAbs(show))} (${fmtRel(liftRel(show))})`);
    if (buy) parts.push(`purchase ${signed(liftAbs(buy))} (${fmtRel(liftRel(buy))})`);
    headline =
      `${primary.cohort_a_label} vs ${primary.cohort_b_label}: ${parts.join(', ')}${weighted ? ' — session-weighted' : ''}. ` +
      `[${primary.id} — ${primary.credibility === 'causal' ? 'causally credible' : 'DIRECTIONAL ONLY'}]`;

    const sig = buy?.significance ?? show?.significance;
    const sigNote = sig?.significant
      ? `Statistically significant at α=${a.significance_alpha}.`
      : `NOT statistically significant at α=${a.significance_alpha}${sig?.p_value != null ? ` (p=${sig.p_value < 0.001 ? '<0.001' : sig.p_value.toFixed(3)})` : ''}.`;

    const roiNote = roi.available
      ? roi.incremental_roi != null
        ? `Incremental ROI ${roi.incremental_roi.toFixed(1)}x on ₹${roi.total_cost.toLocaleString()} of calling cost.`
        : `Gross ROI ${roi.gross_roi?.toFixed(1) ?? '—'}x — no credible lens available, so this over-credits the dialer.`
      : 'No cost data supplied, so no ROI is claimed.';

    const biasNote =
      primary.credibility === 'causal'
        ? 'This is the number to quote to the client.'
        : 'This lens compares groups the world selected for us — quote it as a direction, never as proof. Add the inputs for a time-based (L3) or per-bot (L5) comparison before making a causal claim.';

    bottom = `${sigNote} ${roiNote} ${biasNote}`;
  }

  return {
    headline,
    bottom_line: bottom,
    primary_lens: primary?.id ?? null,
    primary_credibility: primary?.credibility ?? null,
    tiles,
    dedup_mode: a.dedup_mode,
    denominator,
    denominator_label: denominatorLabel,
  };
}

function signed(v: number): string {
  return `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}pp`;
}

function fmtRel(v: number | null): string {
  if (v == null) return 'n/a';
  return `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`;
}
