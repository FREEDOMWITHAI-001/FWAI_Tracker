// ROI. Two numbers, always shown together:
//
//   Gross ROI        revenue from everyone we dialled ÷ what the dialling cost.
//                    Flattering and wrong — most of those people would have
//                    bought anyway.
//   Incremental ROI  the lift from the most CREDIBLE available lens, applied to
//                    the treated population, priced at the average order value.
//                    This is the honest number and it is the one the headline
//                    uses. (Flute Gandharvas: L1 looked great, L3 gave +0.6%
//                    lift and 1.4x — the 1.4x is the truth.)

import { CAUSAL_LENSES } from './lenses';
import type { Assumptions, Fact, LensId, LensResult, RoiBlock } from './types';
import type { FactBuild } from './facts';

export function buildRoi(
  facts: Fact[],
  build: FactBuild,
  a: Assumptions,
  lenses: LensResult[],
  primaryLens: LensId | null
): RoiBlock {
  const notes: string[] = [];
  const talk = build.cost.talk_minutes;

  // A cost file with an explicit amount beats the per-minute rate.
  const callCost =
    build.cost.from_file && build.cost.amount != null ? build.cost.amount : talk * a.cost_per_talk_minute;
  if (build.cost.from_file && build.cost.amount != null)
    notes.push('Call cost taken from the uploaded cost file, not from the ₹/talk-minute rate.');
  else if (!build.cost.from_file)
    notes.push('No cost file: talk minutes were derived from connected call durations in the call log.');

  const telephony = talk * a.telephony_per_minute;
  const total = callCost + telephony + a.fixed_cost;

  const dialledBuyers = facts.filter((f) => f.dialled && f.bought);
  // A flat sale value, when set, overrides real recorded amounts everywhere
  // in this block — "buyers × sale value" instead of summing actual orders.
  // Useful when the sales file's real amounts are messy, partial, or absent.
  const attributed =
    a.sale_value != null ? dialledBuyers.length * a.sale_value : dialledBuyers.reduce((s, f) => s + (f.order_value ?? 0), 0);
  const avgOrder =
    a.sale_value ??
    (dialledBuyers.length > 0 ? attributed / dialledBuyers.length : a.default_order_value ?? averageOrderValue(facts));
  if (a.sale_value != null) notes.push(`Revenue uses a flat ₹${a.sale_value.toLocaleString()} per sale, not each order's real amount.`);

  if (total <= 0) {
    return {
      available: false,
      reason:
        'No cost inputs. Add a cost file, or set ₹/talk-minute and telephony in Assumptions, to get an ROI block.',
      talk_minutes: talk,
      call_cost: callCost,
      telephony_cost: telephony,
      fixed_cost: a.fixed_cost,
      total_cost: total,
      attributed_revenue: round(attributed),
      gross_roi: null,
      incremental_lens: null,
      incremental_credibility: null,
      incremental_buyers: null,
      incremental_revenue: null,
      incremental_roi: null,
      avg_order_value: round(avgOrder),
      notes,
    };
  }

  // Pick the lens the incremental figure rides on: the report's primary lens if
  // it is credible and available, else the best available causal lens. Per the
  // SOP (28-Jul review): when NO causal lens exists, still compute the
  // incremental figure from the best available comparison (reached vs
  // not-reached) and label it DIRECTIONAL — a labelled directional lift
  // over-credits far less than showing only the gross number.
  const usable = lenses.filter((l) => l.available && l.outcomes.some((o) => o.metric === 'bought'));
  const chosen =
    usable.find((l) => l.id === primaryLens && l.credibility === 'causal') ??
    usable.find((l) => CAUSAL_LENSES.includes(l.id)) ??
    usable.find((l) => l.id === primaryLens) ??
    usable[0] ??
    null;

  let incBuyers: number | null = null;
  let incRevenue: number | null = null;
  let incRoi: number | null = null;

  if (chosen) {
    const outcome = chosen.outcomes.find((o) => o.metric === 'bought')!;
    // The session-weighted (normalised) lift beats the pooled one when it
    // exists: pooled rates let a giant, barely-dialled list drag the baseline
    // down and fake a bigger lift. Per the SOP the extra is computed per
    // webinar (treated × delta, negatives KEPT) and summed — which equals
    // lift × treated_n — so a net-negative cycle shows as negative, never
    // clamped to zero.
    const norm = outcome.normalized ?? null;
    const lift = norm ? norm.abs_lift : outcome.abs_lift;
    const treated = norm ? norm.treated_n : outcome.a.n;
    incBuyers = lift * treated;
    incRevenue = incBuyers * avgOrder;
    incRoi = incRevenue / total;
    notes.push(
      `Incremental ROI uses ${chosen.id} (${chosen.label}) — ${(lift * 100).toFixed(2)}pp purchase lift ` +
        (norm
          ? `(per-webinar deltas weighted by each webinar's treated people, negatives kept, across ${norm.sessions_used} of ${norm.sessions_total} webinars; pooled lift would be ${(outcome.abs_lift * 100).toFixed(2)}pp) `
          : '') +
        `on ${treated.toLocaleString()} treated people at ₹${Math.round(avgOrder).toLocaleString()} average order value.`
    );
    notes.push(
      `Of the ${outcome.a.k.toLocaleString()} buyers in the treated group, ~${Math.min(outcome.a.k, outcome.a.k - incBuyers).toFixed(1)} would have bought anyway (buyers minus the credited extra).`
    );
    if (!norm)
      notes.push(
        'No session-weighted lift was possible (it needs at least two webinars containing both cohorts), so the pooled lift was used.'
      );
    if (chosen.credibility !== 'causal')
      notes.push(
        `${chosen.id} is DIRECTIONAL — who answers the phone / who gets dialled is not random, so part of this lift is ` +
          'selection, not the calls. Quote this ROI as directional, never as proof. Add non-AI weeks (L3) or a bot column (L5) for a causal number.'
      );
    if (!outcome.significance.significant)
      notes.push(
        `That lift is not statistically significant (p=${fmtP(outcome.significance.p_value)}), so the incremental ROI is indicative, not established.`
      );
  } else {
    notes.push(
      'No causally credible lens is available in this report, so only gross ROI is shown. Gross ROI credits the dialer ' +
        'with every sale from a dialled person, including sales that would have happened anyway.'
    );
  }

  return {
    available: true,
    talk_minutes: talk,
    call_cost: round(callCost),
    telephony_cost: round(telephony),
    fixed_cost: a.fixed_cost,
    total_cost: round(total),
    attributed_revenue: round(attributed),
    gross_roi: round(attributed / total, 2),
    incremental_lens: chosen?.id ?? null,
    incremental_credibility: chosen?.credibility ?? null,
    incremental_buyers: incBuyers == null ? null : round(incBuyers, 1),
    incremental_revenue: incRevenue == null ? null : round(incRevenue),
    incremental_roi: incRoi == null ? null : round(incRoi, 2),
    avg_order_value: round(avgOrder),
    notes,
  };
}

function averageOrderValue(facts: Fact[]): number {
  const buyers = facts.filter((f) => f.bought);
  if (!buyers.length) return 0;
  return buyers.reduce((s, f) => s + (f.order_value ?? 0), 0) / buyers.length;
}

function fmtP(p: number | null): string {
  if (p == null) return 'n/a';
  return p < 0.001 ? '<0.001' : p.toFixed(3);
}

function round(n: number, dp = 0): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}
