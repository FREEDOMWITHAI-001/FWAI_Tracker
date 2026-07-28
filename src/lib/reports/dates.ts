// Date/time handling. ALL data in this product is IST — Zoom exports, the
// dialer, GoHighLevel and the payment gateway all render local time with no
// offset — so a bare "07/08/2026 19:30" is 19:30 IST, not 19:30 UTC. We parse
// bare timestamps as IST and store ISO instants.

const IST_OFFSET_MIN = 330;

export type DateOrder = 'mdy' | 'dmy';

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?/;
const SLASH_RE = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})(?:[T ,]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?\s*(am|pm)?/i;
const TZ_RE = /(Z|[+-]\d{2}:?\d{2})\s*$/i;

// Zoom writes "07/08/2026" as month/day; GoHighLevel usually writes day/month.
// Rather than make this a global knob (another re-version generator), infer it
// per column: if any value's first component exceeds 12 it must be the day.
export function inferDateOrder(values: string[]): DateOrder {
  for (const v of values) {
    const m = SLASH_RE.exec(String(v ?? '').trim());
    if (!m) continue;
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a > 12 && b <= 12) return 'dmy';
    if (b > 12 && a <= 12) return 'mdy';
  }
  return 'mdy'; // Zoom is the most common source here
}

// Parse a timestamp in any of the shapes these exports produce.
// Returns an ISO instant string, or null when the value is not a date.
export function parseWhen(raw: unknown, order: DateOrder = 'mdy'): string | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;

  // Excel serial date (XLSX cells that were never formatted as text).
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    const n = Number(s);
    if (n > 20000 && n < 80000) {
      const ms = Math.round((n - 25569) * 86_400_000);
      return new Date(ms).toISOString();
    }
  }

  // Already carries a timezone — trust it.
  if (TZ_RE.test(s)) {
    const t = Date.parse(s);
    return Number.isNaN(t) ? null : new Date(t).toISOString();
  }

  const iso = ISO_RE.exec(s);
  if (iso) {
    return fromParts(+iso[1], +iso[2], +iso[3], +(iso[4] ?? 0), +(iso[5] ?? 0), +(iso[6] ?? 0));
  }

  const sl = SLASH_RE.exec(s);
  if (sl) {
    const a = +sl[1];
    const b = +sl[2];
    let year = +sl[3];
    if (year < 100) year += year < 70 ? 2000 : 1900;
    let month = order === 'dmy' ? b : a;
    let day = order === 'dmy' ? a : b;
    // Self-correct an impossible month regardless of the declared order.
    if (month > 12 && day <= 12) [month, day] = [day, month];
    let hour = +(sl[4] ?? 0);
    const min = +(sl[5] ?? 0);
    const sec = +(sl[6] ?? 0);
    const ampm = (sl[7] ?? '').toLowerCase();
    if (ampm === 'pm' && hour < 12) hour += 12;
    if (ampm === 'am' && hour === 12) hour = 0;
    return fromParts(year, month, day, hour, min, sec);
  }

  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

// Build an ISO instant from IST wall-clock parts.
function fromParts(y: number, mo: number, d: number, h: number, mi: number, s: number): string | null {
  if (!y || !mo || !d || mo > 12 || d > 31) return null;
  const utcMs = Date.UTC(y, mo - 1, d, h, mi, s) - IST_OFFSET_MIN * 60_000;
  const dt = new Date(utcMs);
  return Number.isNaN(dt.getTime()) ? null : dt.toISOString();
}

// yyyy-mm-dd as seen in IST.
export function istDay(iso: string | null): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return new Date(t + IST_OFFSET_MIN * 60_000).toISOString().slice(0, 10);
}

export function istClock(iso: string | null): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return new Date(t + IST_OFFSET_MIN * 60_000).toISOString().slice(0, 16).replace('T', ' ');
}

// ISO-8601 week label of an IST calendar day, e.g. "2026-W27". Weeks are the
// unit L3 (AI weeks vs non-AI weeks) splits on, so this has to be stable.
export function isoWeek(day: string | null): string | null {
  if (!day) return null;
  const [y, m, d] = day.split('-').map(Number);
  if (!y || !m || !d) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = dt.getUTCDay() || 7; // Mon=1..Sun=7
  dt.setUTCDate(dt.getUTCDate() + 4 - dow); // Thursday of this week decides the year
  const yearStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((dt.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${dt.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export function daysBetween(aIso: string, bIso: string): number {
  return (Date.parse(bIso) - Date.parse(aIso)) / 86_400_000;
}

// Duration cells arrive as "12", "12 min", "00:12:30" or a raw second count.
// `unit` says how to read a bare number.
export function parseDuration(raw: unknown, unit: 'minutes' | 'seconds'): number | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  const hms = /^(\d{1,3}):(\d{2})(?::(\d{2}))?$/.exec(s);
  if (hms) {
    const secs = +hms[1] * (hms[3] ? 3600 : 60) + +hms[2] * (hms[3] ? 60 : 1) + +(hms[3] ?? 0);
    return unit === 'minutes' ? secs / 60 : secs;
  }
  const n = Number(s.replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(n)) return null;
  if (/\bmin/i.test(s)) return unit === 'minutes' ? n : n * 60;
  if (/\bs(ec)?\b/i.test(s)) return unit === 'minutes' ? n / 60 : n;
  return n;
}

// Money cells: "₹1,499", "1,499.00", "INR 1499", "" -> number | null.
export function parseMoney(raw: unknown): number | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  const n = Number(s.replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

export function parseCount(raw: unknown): number | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  const n = Number(s.replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
}
