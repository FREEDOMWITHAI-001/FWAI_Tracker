// The seven comparison lenses. Each one is a cohort split of the same fact
// table, and each one carries a CREDIBILITY label that the UI and the export
// must show next to its numbers.
//
// Why the labels are not cosmetic: for Flute Gandharvas, L1 (connected vs
// dialled-but-not-connected) looked excellent, while L3 (AI weeks vs non-AI
// weeks) showed +0.6% lift and 1.4x ROI. L1 was measuring who answers the
// phone, not what the call did. A biased lens must never be presented as proof.

import { normalizedComparison, proportion, relativeLift, twoProportionTest, type Stratum } from './stats';
import type { Assumptions, Credibility, Fact, LensId, LensResult, LensRow, Outcome } from './types';
import type { FactBuild } from './facts';

export const LENS_META: Record<
  LensId,
  { label: string; question: string; credibility: Credibility; note: string }
> = {
  L1: {
    label: 'Connected vs dialled-not-connected',
    question: 'Among the people we dialled, did the ones who answered do better?',
    credibility: 'directional',
    note:
      'HIGH selection bias. People who answer the phone are already more engaged than people who do not. ' +
      'Most of this gap is who they are, not what the call did. Directional only.',
  },
  L2: {
    label: 'Called vs registered-but-never-called',
    question: 'Did the registrants we dialled do better than the ones we never dialled?',
    credibility: 'directional',
    note:
      'VERY HIGH selection bias. Dial lists are usually built from the best leads (recent, complete numbers, ' +
      'right source), so this compares two different populations. Directional only — never quote as proof.',
  },
  L3: {
    label: 'AI weeks vs non-AI weeks',
    question: 'In the weeks the dialer ran, did the whole funnel move?',
    credibility: 'causal',
    note:
      'LOWEST bias — the split is time, not a property of the person, so the two groups are drawn from the ' +
      'same lead pool. This is the number to quote. It is usually much smaller than L1/L2.',
  },
  L4: {
    label: 'AI calling vs manual/human calling',
    question: 'Did the AI dialer beat the human calling team?',
    credibility: 'directional',
    note:
      'Credible only if leads were assigned to AI vs human by something unrelated to lead quality. If the ' +
      'humans took the "good" leads (or vice-versa) this measures list quality, not channel.',
  },
  L5: {
    label: 'Per-bot breakdown',
    question: 'Which bot actually moved show-up and purchase?',
    credibility: 'causal',
    note:
      'Credible: everyone in this table was dialled and reached, so answering-propensity is held roughly ' +
      'constant and the remaining difference is which script they got.',
  },
  L6: {
    label: 'Engaged vs dialled-not-engaged',
    question: 'Did people who actually talked back do better?',
    credibility: 'directional',
    note:
      'HIGH selection bias, same shape as L1 and slightly worse — talking back for 2+ turns is itself a sign ' +
      'of intent. Directional only.',
  },
  L7: {
    label: 'Zoom-leave → came back via reminder',
    question: 'Of the people who left early, did the ones who came back buy more?',
    credibility: 'causal',
    note:
      'Credible: both cohorts left the webinar early, so intent at the moment of leaving is roughly matched. ' +
      'Caveat — clicking the link is still a choice, so treat it as a strong signal rather than a clean experiment.',
  },
};

export const CAUSAL_LENSES: LensId[] = ['L3', 'L5', 'L7'];

interface Ctx {
  facts: Fact[];
  build: FactBuild;
  a: Assumptions;
}

export function runLenses(ids: LensId[], facts: Fact[], build: FactBuild, a: Assumptions): LensResult[] {
  const ctx: Ctx = { facts, build, a };
  const seen = new Set<LensId>();
  const out: LensResult[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(runLens(id, ctx));
  }
  // Credible lenses first — the order on screen is part of the argument.
  return out.sort((x, y) => rank(x) - rank(y));
}

function rank(l: LensResult): number {
  if (!l.available) return 3;
  return l.credibility === 'causal' ? 0 : 1;
}

function runLens(id: LensId, ctx: Ctx): LensResult {
  switch (id) {
    case 'L1':
      return lensL1(ctx);
    case 'L2':
      return lensL2(ctx);
    case 'L3':
      return lensL3(ctx);
    case 'L4':
      return lensL4(ctx);
    case 'L5':
      return lensL5(ctx);
    case 'L6':
      return lensL6(ctx);
    case 'L7':
      return lensL7(ctx);
  }
}

// --- shared plumbing -------------------------------------------------------

function base(id: LensId, ctx: Ctx): LensResult {
  const m = LENS_META[id];
  const credibility = id === 'L4' && ctx.a.l4_randomised ? 'causal' : m.credibility;
  return {
    id,
    label: m.label,
    question: m.question,
    credibility,
    credibility_note:
      id === 'L4' && ctx.a.l4_randomised
        ? 'Marked causal because the operator asserted AI/manual assignment alternated independently of lead quality.'
        : m.note,
    available: true,
    cohort_a_label: '',
    cohort_b_label: '',
    outcomes: [],
    rows: [],
    caveats: [],
  };
}

function unavailable(id: LensId, ctx: Ctx, reason: string): LensResult {
  return { ...base(id, ctx), available: false, unavailable_reason: reason };
}

function outcomesFor(
  aFacts: Fact[],
  bFacts: Fact[],
  aLabel: string,
  bLabel: string,
  a: Assumptions,
  metrics: Outcome['metric'][] = ['showed_up', 'bought']
): Outcome[] {
  const opt = { alpha: a.significance_alpha, minCohortN: a.min_cohort_n };
  const label: Record<Outcome['metric'], string> = {
    showed_up: 'Showed up',
    bought: 'Bought',
    came_back: 'Came back',
  };
  return metrics.map((metric) => {
    const pa = proportion(aLabel, aFacts.filter((f) => f[metric]).length, aFacts.length);
    const pb = proportion(bLabel, bFacts.filter((f) => f[metric]).length, bFacts.length);
    return {
      metric,
      label: label[metric],
      a: pa,
      b: pb,
      abs_lift: pa.rate - pb.rate,
      rel_lift: relativeLift(pa.rate, pb.rate),
      significance: twoProportionTest(pa, pb, opt),
      normalized: normalizedComparison(sessionStrata(aFacts, bFacts, metric)),
    };
  });
}

// Split a cohort comparison by webinar, for the session-weighted rates.
function sessionStrata(aFacts: Fact[], bFacts: Fact[], metric: Outcome['metric']): Stratum[] {
  const bySession = new Map<string, Stratum>();
  const bump = (fs: Fact[], side: 'a' | 'b') => {
    for (const f of fs) {
      let s = bySession.get(f.session_key);
      if (!s) {
        s = { key: f.session_key, aK: 0, aN: 0, bK: 0, bN: 0 };
        bySession.set(f.session_key, s);
      }
      if (side === 'a') {
        s.aN++;
        if (f[metric]) s.aK++;
      } else {
        s.bN++;
        if (f[metric]) s.bK++;
      }
    }
  };
  bump(aFacts, 'a');
  bump(bFacts, 'b');
  return [...bySession.values()];
}

function twoRowTable(aFacts: Fact[], bFacts: Fact[], aLabel: string, bLabel: string): LensRow[] {
  const row = (label: string, fs: Fact[], baseline: LensRow | null, isBaseline = false): LensRow => {
    const n = fs.length;
    const showed = fs.filter((f) => f.showed_up).length;
    const bought = fs.filter((f) => f.bought).length;
    const show_rate = n ? showed / n : 0;
    const buy_rate = n ? bought / n : 0;
    return {
      label,
      n,
      showed,
      show_rate,
      bought,
      buy_rate,
      show_lift: baseline ? relativeLift(show_rate, baseline.show_rate) : null,
      buy_lift: baseline ? relativeLift(buy_rate, baseline.buy_rate) : null,
      show_lift_abs: baseline ? show_rate - baseline.show_rate : null,
      buy_lift_abs: baseline ? buy_rate - baseline.buy_rate : null,
      baseline: isBaseline,
    };
  };
  const b = row(bLabel, bFacts, null, true);
  return [row(aLabel, aFacts, b), b];
}

// --- L1 --------------------------------------------------------------------

function lensL1(ctx: Ctx): LensResult {
  const dialled = ctx.facts.filter((f) => f.dialled);
  if (!dialled.length) return unavailable('L1', ctx, 'No call log rows matched anyone in this report.');
  const A = dialled.filter((f) => f.connected);
  const B = dialled.filter((f) => !f.connected);
  if (!A.length || !B.length)
    return unavailable('L1', ctx, 'Every dialled person fell on the same side of "connected" — nothing to compare.');
  const r = base('L1', ctx);
  r.cohort_a_label = 'Connected';
  r.cohort_b_label = 'Dialled, not connected';
  r.outcomes = outcomesFor(A, B, r.cohort_a_label, r.cohort_b_label, ctx.a);
  r.rows = twoRowTable(A, B, r.cohort_a_label, r.cohort_b_label);
  r.caveats.push('Answering the phone is itself a sign of intent — read this as an upper bound, not an effect.');
  return r;
}

// --- L2 --------------------------------------------------------------------

function lensL2(ctx: Ctx): LensResult {
  const registered = ctx.facts.filter((f) => f.registered);
  if (!registered.length) return unavailable('L2', ctx, 'No leads/registrations file is present.');
  const A = registered.filter((f) => f.dialled);
  const B = registered.filter((f) => f.holdout);
  if (!A.length || !B.length)
    return unavailable('L2', ctx, 'Every registrant was either dialled or not dialled — no contrast exists.');
  const r = base('L2', ctx);
  r.cohort_a_label = 'Called';
  r.cohort_b_label = 'Registered, never called';
  r.outcomes = outcomesFor(A, B, r.cohort_a_label, r.cohort_b_label, ctx.a);
  r.rows = twoRowTable(A, B, r.cohort_a_label, r.cohort_b_label);
  r.caveats.push(
    `${B.length.toLocaleString()} registrants were never dialled. If the dial list was filtered on lead quality, ` +
      'this comparison mostly measures that filter.'
  );
  const excluded = registered.filter((f) => f.excluded_tagged).length;
  if (excluded)
    r.caveats.push(
      `${excluded.toLocaleString()} exclude-tagged registrants (deliberately never dialled) are kept OUT of the ` +
        'never-called baseline — they attend at ~99% and would inflate it.'
    );
  return r;
}

// --- L3 --------------------------------------------------------------------

function lensL3(ctx: Ctx): LensResult {
  const withWeek = ctx.facts.filter((f) => f.week);
  const A = withWeek.filter((f) => f.ai_week);
  const B = withWeek.filter((f) => !f.ai_week);
  if (!A.length || !B.length) {
    return unavailable(
      'L3',
      ctx,
      !withWeek.length
        ? 'No session dates are available, so weeks cannot be formed.'
        : `Only ${A.length ? 'AI' : 'non-AI'} weeks are present — a time-based comparison needs both.`
    );
  }
  const r = base('L3', ctx);
  r.cohort_a_label = `AI weeks (${ctx.build.ai_weeks.length})`;
  r.cohort_b_label = 'Non-AI weeks';
  r.outcomes = outcomesFor(A, B, r.cohort_a_label, r.cohort_b_label, ctx.a);
  r.rows = twoRowTable(A, B, r.cohort_a_label, r.cohort_b_label);
  r.caveats.push(
    'Time-based: any other change made in the same weeks (creative, ad spend, seasonality) is inside this number too.'
  );
  return r;
}

// --- L4 --------------------------------------------------------------------

function lensL4(ctx: Ctx): LensResult {
  if (!ctx.build.has_manual_calls)
    return unavailable('L4', ctx, 'No call log is marked as manual/human calling. Mark one on the Inputs step.');
  const A = ctx.facts.filter((f) => f.dialled && f.call_mode === 'ai');
  const B = ctx.facts.filter((f) => f.dialled && f.call_mode === 'manual');
  if (!A.length || !B.length) return unavailable('L4', ctx, 'One of the two calling channels has no matched people.');
  const r = base('L4', ctx);
  r.cohort_a_label = 'AI dialer';
  r.cohort_b_label = 'Manual / human';
  r.outcomes = outcomesFor(A, B, r.cohort_a_label, r.cohort_b_label, ctx.a);
  r.rows = twoRowTable(A, B, r.cohort_a_label, r.cohort_b_label);
  if (!ctx.a.l4_randomised)
    r.caveats.push('Assignment to AI vs human was not asserted as random — treat as directional.');
  return r;
}

// --- L5 --------------------------------------------------------------------

function lensL5(ctx: Ctx): LensResult {
  const called = ctx.facts.filter((f) => f.dialled);
  if (!called.length) return unavailable('L5', ctx, 'No call log rows matched anyone in this report.');

  // Bots are whatever distinct names appear in the call log — no configuration.
  // Only bots that actually reached somebody get a row, so a one-bot client sees
  // one row instead of an empty "day-of" row.
  const detected = (ctx.build.bots ?? []).filter((b) => called.some((f) => f.bots?.includes(b)));
  const anyBot = called.filter((f) => (f.bots?.length ?? 0) > 0);
  const noBot = called.filter((f) => !(f.bots?.length ?? 0));
  const multi = called.filter((f) => (f.bots?.length ?? 0) > 1);

  if (!detected.length)
    return unavailable(
      'L5',
      ctx,
      'No bot / campaign name was found on any connected call. Map the bot-name column on the call log’s Columns screen.'
    );

  const r = base('L5', ctx);
  r.cohort_a_label = 'Reached by any bot';
  r.cohort_b_label = 'Dialled, no bot reached';
  r.outcomes = outcomesFor(anyBot, noBot, r.cohort_a_label, r.cohort_b_label, ctx.a);

  // SOP "BY CAMPAIGN" weighting: for THIS lens the natural stratum is the
  // campaign (bot), not the Zoom session — each campaign's reached cohort is
  // compared against ITS OWN registration list's not-reached members, and
  // everything is counted on campaign slots (a person dialled by two
  // campaigns appears in each).
  //
  // Roster inference: bots only dial from lists, and list membership lives in
  // the leads file's tags — so the tag that covers the most of a campaign's
  // dialled people (>= 60%) is taken as that campaign's list. This puts the
  // list's never-called members into the campaign baseline; without them the
  // baseline is only dialled-but-not-reached, which is tiny and over-credits
  // small campaigns. When no tag qualifies, dialled-not-reached stands in.
  //
  // Purchase-timing guard (SOP): a sale counts inside a campaign only if it
  // landed on/after that campaign's first call day — a campaign cannot claim
  // sales that predate its own calls. Exclude-tagged people stay out of both
  // sides.
  const pool = ctx.facts.filter((f) => !f.excluded_tagged);
  const tagMembers = new Map<string, Fact[]>();
  for (const f of pool)
    for (const t of f.tags ?? []) {
      const arr = tagMembers.get(t);
      if (arr) arr.push(f);
      else tagMembers.set(t, [f]);
    }
  // The MOST SPECIFIC list wins: among tags covering >= 60% of the campaign's
  // dialled people, take the smallest member set — a giant superset tag (a
  // membership-wide label everyone carries) must not beat the actual call
  // list. null when no tag qualifies.
  const rosterFor = (dialledBy: Fact[]): { tag: string; members: Fact[] } | null => {
    let best: { tag: string; members: Fact[] } | null = null;
    const dialledKeys = new Set(dialledBy.map((f) => f.person_key));
    for (const [tag, members] of tagMembers) {
      if (members.length < dialledBy.length * 0.5) continue;
      let overlap = 0;
      for (const m of members) if (dialledKeys.has(m.person_key)) overlap++;
      if (!dialledBy.length || overlap / dialledBy.length < 0.6) continue;
      if (!best || members.length < best.members.length) best = { tag, members };
    }
    return best;
  };

  // Bots that dial from the SAME list are one wave — separate strata would
  // count that list's baseline once per bot and a shared buyer once per bot.
  const groups = new Map<string, { bots: string[]; roster: Fact[] | null }>();
  for (const b of detected) {
    const dialledBy = pool.filter((f) => f.dialled_bots?.includes(b));
    const roster = rosterFor(dialledBy);
    const key = roster ? `tag:${roster.tag}` : `bot:${b}`;
    const g = groups.get(key);
    if (g) g.bots.push(b);
    else groups.set(key, { bots: [b], roster: roster?.members ?? null });
  }

  const inWindow = (f: Fact, metric: Outcome['metric'], firstDay: string | null) =>
    !!f[metric] && (metric !== 'bought' || !firstDay || !!(f.order_time && f.order_time.slice(0, 10) >= firstDay));
  for (const o of r.outcomes) {
    const strata: Stratum[] = [...groups.values()].map((g) => {
      const dialledBy = pool.filter((f) => g.bots.some((b) => f.dialled_bots?.includes(b)));
      const reached = dialledBy.filter((f) => g.bots.some((b) => f.bots?.includes(b)));
      const reachedKeys = new Set(reached.map((f) => f.person_key));
      // Sales baseline is dialled-only: after buyer-restoration every buyer is
      // by construction a dialled person, so never-called roster members can
      // hold NO buyers and a list-wide baseline would fake a huge lift.
      // Show-up has no such artefact — never-called people do attend — so the
      // list roster (with its not-called members) is the right baseline there.
      const rosterBase = o.metric === 'bought' ? dialledBy : g.roster ?? dialledBy;
      const baseline = rosterBase.filter((f) => !reachedKeys.has(f.person_key));
      const firstDay = reached.reduce<string | null>(
        (t, f) => (f.call_time && (!t || f.call_time < t) ? f.call_time : t),
        null
      )?.slice(0, 10) ?? null;
      return {
        key: g.bots.join(' + '),
        aK: reached.filter((f) => inWindow(f, o.metric, firstDay)).length,
        aN: reached.length,
        bK: baseline.filter((f) => inWindow(f, o.metric, firstDay)).length,
        bN: baseline.length,
      };
    });
    const byCampaign = normalizedComparison(strata);
    if (byCampaign) o.normalized = byCampaign;
  }
  r.caveats.push(
    'Session-weighted figures on this lens are stratified by CAMPAIGN WAVE (bots sharing one registration list merge ' +
      "into one wave; the list is the most specific leads-file tag covering the wave's dialled people). Show-up is " +
      "measured against the wave's own list including its never-called members; the sales baseline is dialled-but-not-" +
      'reached only, because after buyer-restoration never-called members cannot contain buyers. A sale counts inside a ' +
      "wave only if it landed on/after that wave's first call day. Exclude-tagged people are in neither side."
  );

  // The Coacheasily "Show-up & Buyers by Bot" matrix: every row is measured
  // against the dialled-but-no-bot-reached baseline, and a lead reached by two
  // bots is counted under EACH of them plus the "2+ bots" row.
  const opt = { alpha: ctx.a.significance_alpha, minCohortN: ctx.a.min_cohort_n };
  const baseShow = noBot.length ? noBot.filter((f) => f.showed_up).length / noBot.length : 0;
  const baseBuy = noBot.length ? noBot.filter((f) => f.bought).length / noBot.length : 0;
  const mk = (label: string, fs: Fact[], isBaseline = false): LensRow => {
    const n = fs.length;
    const showed = fs.filter((f) => f.showed_up).length;
    const bought = fs.filter((f) => f.bought).length;
    const show_rate = n ? showed / n : 0;
    const buy_rate = n ? bought / n : 0;
    return {
      label,
      n,
      showed,
      show_rate,
      bought,
      buy_rate,
      show_lift: isBaseline ? null : relativeLift(show_rate, baseShow),
      buy_lift: isBaseline ? null : relativeLift(buy_rate, baseBuy),
      show_lift_abs: isBaseline ? null : show_rate - baseShow,
      buy_lift_abs: isBaseline ? null : buy_rate - baseBuy,
      baseline: isBaseline,
      significance: isBaseline
        ? undefined
        : twoProportionTest(
            proportion(label, showed, n),
            proportion('baseline', noBot.filter((f) => f.showed_up).length, noBot.length),
            opt
          ),
    };
  };

  r.rows = [
    mk('Total (called)', called, true),
    ...detected.map((b) => mk(b, called.filter((f) => f.bots?.includes(b)))),
    ...(multi.length ? [mk('Reached by 2+ bots', multi)] : []),
    mk('No bot reached', noBot, true),
  ];

  r.caveats.push('Population is the leads we dialled; registrants we never dialled are excluded from this table.');
  r.caveats.push(
    `Bot names were taken verbatim from the call log (${detected.length} found: ${detected.join(', ')}). ` +
      'Two spellings of the same bot appear as two rows.'
  );
  if (!noBot.length) r.caveats.push('Baseline group is empty — lifts are shown as n/a rather than fabricated.');
  return r;
}

// --- L6 --------------------------------------------------------------------

function lensL6(ctx: Ctx): LensResult {
  if (!ctx.build.has_talk_turns)
    return unavailable('L6', ctx, 'No talk-turns column was mapped on any call log, so "engaged" cannot be computed.');
  const dialled = ctx.facts.filter((f) => f.dialled);
  const A = dialled.filter((f) => f.engaged);
  const B = dialled.filter((f) => !f.engaged);
  if (!A.length || !B.length) return unavailable('L6', ctx, 'Every dialled person fell on the same side of "engaged".');
  const r = base('L6', ctx);
  r.cohort_a_label = `Engaged (≥${ctx.a.engaged_min_turns} talk turns)`;
  r.cohort_b_label = 'Dialled, not engaged';
  r.outcomes = outcomesFor(A, B, r.cohort_a_label, r.cohort_b_label, ctx.a);
  r.rows = twoRowTable(A, B, r.cohort_a_label, r.cohort_b_label);
  r.caveats.push('Talking back for several turns is itself a sign of intent — directional only.');
  return r;
}

// --- L7 --------------------------------------------------------------------

function lensL7(ctx: Ctx): LensResult {
  const leftEarly = ctx.facts.filter((f) => f.left_early);
  if (!leftEarly.length)
    return unavailable(
      'L7',
      ctx,
      `No one was flagged as leaving early (watch time below ${ctx.a.left_early_minutes} min). ` +
        'Check that the attendance file has a duration column.'
    );
  const A = leftEarly.filter((f) => f.came_back);
  const B = leftEarly.filter((f) => !f.came_back);
  if (!A.length)
    return unavailable(
      'L7',
      ctx,
      ctx.build.has_comeback_source
        ? 'No early-leaver clicked the comeback link inside the report window.'
        : 'No rejoin was detected and no comeback-click export was uploaded.'
    );
  const r = base('L7', ctx);
  r.cohort_a_label = 'Left early → came back';
  r.cohort_b_label = 'Left early → did not come back';
  r.outcomes = outcomesFor(A, B, r.cohort_a_label, r.cohort_b_label, ctx.a, ['bought']);
  r.rows = twoRowTable(A, B, r.cohort_a_label, r.cohort_b_label);
  r.caveats.push(
    ctx.build.has_comeback_source
      ? 'Comeback = clicked the reminder link. Buyers who purchased under a different email are invisible — the buyer count is a floor.'
      : 'Comeback inferred from a second Zoom join (no click export supplied). Upload the trigger-link export for a cleaner signal.'
  );
  return r;
}
