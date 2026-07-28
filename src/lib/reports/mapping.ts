// Column auto-detection: given a file's headers, guess which column holds
// which canonical field. The operator always confirms/edits the result — the
// suggestion just has to be right often enough that month 2 is one click.

import { normHeader } from './parse';
import type { InputRole, MappingSuggestion } from './types';

export interface FieldSpec {
  field: string;
  label: string;
  required: boolean;
  synonyms: string[];
  // When several columns match equally well, which one wins. Zoom's wide export
  // repeats "Duration (Minutes)": the FIRST is the session length, the SECOND
  // is the person's watch time — so watch_minutes prefers the last match.
  prefer?: 'first' | 'last';
  hint?: string;
}

const PHONE = ['phone', 'phone number', 'mobile', 'mobile number', 'contact number', 'contact', 'whatsapp', 'msisdn', 'number', 'to number', 'customer number'];
const EMAIL = ['email', 'email address', 'e mail', 'user email', 'attendee email', 'participant email', 'contact email', 'buyer email'];
const NAME = ['name', 'full name', 'contact name', 'customer name', 'attendee name', 'participant name', 'user name', 'name (original name)', 'display name', 'first name', 'lead name'];

export const FIELD_SPECS: Record<InputRole, FieldSpec[]> = {
  leads: [
    { field: 'name', label: 'Name', required: false, synonyms: NAME },
    { field: 'phone', label: 'Phone', required: true, synonyms: PHONE, hint: 'Drives ~80% of overall accuracy.' },
    { field: 'email', label: 'Email', required: false, synonyms: EMAIL, hint: 'Fallback identity when the phone is missing.' },
    { field: 'session_id', label: 'Webinar / session id', required: false, synonyms: ['webinar id', 'meeting id', 'session id', 'event id', 'webinar', 'session'] },
    { field: 'session_date', label: 'Webinar date', required: false, synonyms: ['webinar date', 'session date', 'event date', 'start time', 'webinar start', 'date'] },
    { field: 'registered_at', label: 'Registered at', required: false, synonyms: ['registration time', 'registered at', 'created at', 'date added', 'signup time', 'opt in date', 'submitted on'] },
    { field: 'lead_source', label: 'Source', required: false, synonyms: ['source', 'utm source', 'campaign', 'channel'] },
  ],
  calls: [
    { field: 'phone', label: 'Phone', required: true, synonyms: PHONE },
    { field: 'name', label: 'Name', required: false, synonyms: NAME },
    { field: 'email', label: 'Email', required: false, synonyms: EMAIL },
    { field: 'status', label: 'Call status', required: true, synonyms: ['status', 'call status', 'disposition', 'outcome', 'result', 'call result', 'end reason'] },
    { field: 'duration_sec', label: 'Duration', required: false, synonyms: ['duration', 'call duration', 'duration (seconds)', 'duration sec', 'talk time', 'talk duration', 'billable duration', 'duration (minutes)'] },
    { field: 'talk_turns', label: 'Talk turns', required: false, synonyms: ['talk turns', 'turns', 'exchanges', 'user turns', 'conversation turns', 'messages', 'transcript turns'] },
    { field: 'bot_name', label: 'Bot / agent name', required: false, synonyms: ['bot name', 'bot', 'agent', 'agent name', 'assistant', 'campaign', 'campaign name', 'flow', 'caller'] },
    { field: 'call_time', label: 'Call time', required: true, synonyms: ['call time', 'started at', 'start time', 'created at', 'date', 'datetime', 'timestamp', 'call date', 'initiated at'] },
    { field: 'session_date', label: 'Webinar date', required: false, synonyms: ['webinar date', 'session date', 'event date'] },
  ],
  attendance: [
    { field: 'name', label: 'Name', required: false, synonyms: NAME },
    { field: 'email', label: 'Email', required: false, synonyms: EMAIL },
    { field: 'phone', label: 'Phone', required: false, synonyms: PHONE },
    { field: 'session_id', label: 'Meeting / webinar id', required: false, synonyms: ['meeting id', 'webinar id', 'id', 'session id'] },
    { field: 'session_topic', label: 'Topic', required: false, synonyms: ['topic', 'meeting topic', 'webinar topic', 'title'] },
    { field: 'session_start', label: 'Session start', required: false, synonyms: ['start time', 'actual start time', 'session start', 'meeting start', 'date'] },
    { field: 'join_time', label: 'Join time', required: false, synonyms: ['join time', 'joined at', 'join'] },
    { field: 'leave_time', label: 'Leave time', required: false, synonyms: ['leave time', 'left at', 'leave'] },
    {
      field: 'watch_minutes',
      label: 'Watch minutes',
      required: false,
      prefer: 'last',
      synonyms: ['duration (minutes)', 'duration minutes', 'duration', 'attendance duration', 'time in session', 'minutes', 'watch time'],
      hint: 'In the wide Zoom export this column appears twice — the second one is the person’s watch time.',
    },
  ],
  sales: [
    { field: 'name', label: 'Buyer name', required: false, synonyms: NAME },
    { field: 'phone', label: 'Phone', required: false, synonyms: PHONE },
    { field: 'email', label: 'Email', required: false, synonyms: EMAIL },
    { field: 'product', label: 'Product / course', required: false, synonyms: ['product', 'course', 'mango name', 'item', 'plan', 'offer', 'product name', 'course name'] },
    { field: 'amount', label: 'Amount', required: false, synonyms: ['amount', 'amount (inr)', 'total', 'price', 'order value', 'net amount', 'paid amount', 'revenue', 'grand total'] },
    { field: 'order_time', label: 'Order time', required: true, synonyms: ['order date', 'order time', 'purchase date', 'created at', 'date', 'paid at', 'transaction date', 'timestamp'] },
    { field: 'order_id', label: 'Order id', required: false, synonyms: ['order id', 'order no', 'transaction id', 'invoice', 'payment id', 'id'] },
    { field: 'status', label: 'Order status', required: false, synonyms: ['order status', 'status', 'payment status', 'state'] },
    {
      field: 'coupon',
      label: 'Coupon / discount code',
      required: false,
      synonyms: ['coupon', 'coupon code', 'discount code', 'promo code', 'promocode', 'offer code', 'voucher', 'discount', 'code'],
      hint: 'Decides whether a ₹0 order is a real 100%-off sale or a test row.',
    },
  ],
  cost: [
    { field: 'bot_name', label: 'Bot / campaign', required: false, synonyms: ['bot name', 'bot', 'campaign', 'agent'] },
    { field: 'talk_minutes', label: 'Talk minutes', required: false, synonyms: ['talk minutes', 'minutes', 'call minutes', 'duration (minutes)', 'usage minutes', 'billed minutes'] },
    { field: 'amount', label: 'Cost', required: false, synonyms: ['amount', 'cost', 'credits', 'charge', 'spend', 'total'] },
    { field: 'period', label: 'Period / date', required: false, synonyms: ['date', 'period', 'month', 'billing period', 'day'] },
  ],
  comeback: [
    { field: 'email', label: 'Email', required: false, synonyms: EMAIL },
    { field: 'phone', label: 'Phone', required: false, synonyms: PHONE },
    {
      field: 'click_time',
      label: 'Click time',
      required: true,
      synonyms: ['msg sent (click proxy)', 'click time', 'clicked at', 'msg sent', 'link clicked', 'event time', 'date'],
      hint: 'NOT "Date Added" — that is when the contact was created, not when they clicked.',
    },
    { field: 'session_date', label: 'Webinar date', required: false, synonyms: ['webinar date', 'session date', 'event date'] },
  ],
};

export function fieldSpecs(role: InputRole): FieldSpec[] {
  return FIELD_SPECS[role] ?? [];
}

// Score one header against one synonym list. 0..1.
function scoreHeader(header: string, synonyms: string[]): number {
  const h = normHeader(header);
  if (!h) return 0;
  let best = 0;
  for (const raw of synonyms) {
    const s = normHeader(raw);
    if (!s) continue;
    if (h === s) return 1;
    if (h.startsWith(s + ' ') || h.endsWith(' ' + s)) best = Math.max(best, 0.8);
    else if (h.includes(s) && s.length >= 4) best = Math.max(best, 0.62);
    else if (s.includes(h) && h.length >= 4) best = Math.max(best, 0.55);
  }
  return best;
}

// Greedy best-first assignment: strongest (field, header) pair wins, then the
// header is consumed so two fields never claim the same column.
export function suggestMapping(role: InputRole, headers: string[]): MappingSuggestion {
  const specs = fieldSpecs(role);
  const pairs: { field: string; header: string; score: number; idx: number; prefer?: 'first' | 'last' }[] = [];
  for (const spec of specs) {
    headers.forEach((h, idx) => {
      const s = scoreHeader(h, spec.synonyms);
      if (s >= 0.5) pairs.push({ field: spec.field, header: h, score: s, idx, prefer: spec.prefer });
    });
  }
  pairs.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    // Same strength: honour the field's preference for the first/last column.
    if (a.field === b.field && a.prefer === 'last') return b.idx - a.idx;
    return a.idx - b.idx;
  });

  const mapping: Record<string, string> = {};
  const confidence: Record<string, number> = {};
  const takenHeaders = new Set<string>();
  for (const p of pairs) {
    if (mapping[p.field] || takenHeaders.has(p.header)) continue;
    mapping[p.field] = p.header;
    confidence[p.field] = Math.round(p.score * 100) / 100;
    takenHeaders.add(p.header);
  }

  const unmapped_required = specs.filter((s) => s.required && !mapping[s.field]).map((s) => s.field);
  return { mapping, confidence, unmapped_required };
}

// Read one canonical field out of a raw row using the confirmed mapping.
export function pick(row: Record<string, unknown>, mapping: Record<string, string>, field: string): string {
  const col = mapping[field];
  if (!col) return '';
  const v = row[col];
  return v == null ? '' : String(v).trim();
}
