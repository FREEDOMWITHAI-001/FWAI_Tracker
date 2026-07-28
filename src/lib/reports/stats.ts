// Significance testing for cohort comparisons.
//
// Every lens is "rate in cohort A vs rate in cohort B", so a pooled two-
// proportion z-test is the right tool. Small cohorts are the real risk here:
// a webinar with 40 attendees produces confident-looking percentages that a
// test will not support, so we warn loudly rather than printing a bare p-value.

import type { Proportion, Significance } from './types';

const Z_80_POWER = 0.8416212; // one-sided z for 80% power

// Abramowitz & Stegun 7.1.26 — plenty accurate for a p-value we round anyway.
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-ax * ax);
  return sign * y;
}

export function normalCdf(z: number): number {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

// Inverse normal CDF (Acklam's rational approximation) — used for the critical
// value at an arbitrary alpha.
export function normalQuantile(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const a = [-39.6968302866538, 220.946098424521, -275.928510446969, 138.357751867269, -30.6647980661472, 2.50662827745924];
  const b = [-54.4760987982241, 161.585836858041, -155.698979859887, 66.8013118877197, -13.2806815528857];
  const c = [-0.00778489400243029, -0.322396458041136, -2.40075827716184, -2.54973253934373, 4.37466414146497, 2.93816398269878];
  const d = [0.00778469570904146, 0.32246712907004, 2.445134137143, 3.75440866190742];
  const pl = 0.02425;
  if (p < pl) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - pl) return -normalQuantile(1 - p);
  const q = p - 0.5;
  const r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

export function proportion(label: string, k: number, n: number): Proportion {
  return { label, n, k, rate: n > 0 ? k / n : 0 };
}

export interface TestOptions {
  alpha: number;
  minCohortN: number;
}

// Pooled two-proportion z-test, Wald 95% CI on the difference, and the
// minimum effect this sample size could have detected at 80% power.
export function twoProportionTest(a: Proportion, b: Proportion, opt: TestOptions): Significance {
  const warnings: string[] = [];
  if (a.n === 0 || b.n === 0) {
    return {
      z: null,
      p_value: null,
      significant: false,
      ci95: null,
      mde: null,
      warnings: ['One cohort is empty — no comparison is possible.'],
    };
  }

  const pooled = (a.k + b.k) / (a.n + b.n);
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / a.n + 1 / b.n));
  const diff = a.rate - b.rate;
  const z = se > 0 ? diff / se : null;
  const p = z == null ? null : 2 * (1 - normalCdf(Math.abs(z)));

  const seDiff = Math.sqrt((a.rate * (1 - a.rate)) / a.n + (b.rate * (1 - b.rate)) / b.n);
  const zCrit = Math.abs(normalQuantile(opt.alpha / 2));
  const ci95: [number, number] = [diff - zCrit * seDiff, diff + zCrit * seDiff];

  const mde = se > 0 ? (zCrit + Z_80_POWER) * Math.sqrt(pooled * (1 - pooled) * (1 / a.n + 1 / b.n)) : null;

  // Underpowered / approximation warnings — these matter more than the p-value.
  const small = [a, b].filter((c) => c.n < opt.minCohortN);
  if (small.length) {
    warnings.push(
      `Underpowered: ${small.map((c) => `${c.label} n=${c.n}`).join(', ')} — below the ${opt.minCohortN}-person floor.`
    );
  }
  for (const c of [a, b]) {
    const succ = c.k;
    const fail = c.n - c.k;
    if (succ < 5 || fail < 5) {
      warnings.push(
        `${c.label} has ${succ} conversions and ${fail} non-conversions — the normal approximation is unreliable below 5 of either.`
      );
    }
  }
  if (mde != null && Math.abs(diff) < mde) {
    warnings.push(
      `This sample can only detect a difference of ~${(mde * 100).toFixed(1)} percentage points at 80% power; the observed gap is ${(Math.abs(diff) * 100).toFixed(1)}pp.`
    );
  }
  if (b.rate === 0) warnings.push('Baseline rate is 0 — relative lift is undefined and is shown as n/a.');

  return {
    z: z == null ? null : round(z, 3),
    p_value: p == null ? null : round(p, 5),
    significant: p != null && p < opt.alpha,
    ci95: [round(ci95[0], 5), round(ci95[1], 5)],
    mde: mde == null ? null : round(mde, 5),
    warnings,
  };
}

// Relative lift vs a baseline. null (rendered "n/a") when the baseline is 0 —
// never fabricate a percentage off a zero denominator.
export function relativeLift(rate: number, baseline: number): number | null {
  if (!baseline) return null;
  return (rate - baseline) / baseline;
}

function round(n: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}
