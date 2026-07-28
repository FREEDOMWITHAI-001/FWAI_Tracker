// Shared domain types for the AI Calling Performance Report engine.
//
// The whole engine is one idea: every uploaded file is normalised into rows,
// all rows join into ONE fact table (one row per person x webinar session),
// and every report format is a different cohort split of that fact table.

export type InputRole = 'leads' | 'calls' | 'attendance' | 'sales' | 'cost' | 'comeback';

export const INPUT_ROLES: InputRole[] = ['leads', 'calls', 'attendance', 'sales', 'cost', 'comeback'];

export const ROLE_LABEL: Record<InputRole, string> = {
  leads: 'Leads / registrations',
  calls: 'Call log',
  attendance: 'Attendance',
  sales: 'Sales / orders',
  cost: 'Cost / call credits',
  comeback: 'Comeback link clicks',
};

// Physical file shapes we can read. The four Zoom attendance shapes are the
// reason shape detection exists at all — they are mutually incompatible.
export type DatasetShape =
  | 'simple' // header on row 1 (CSV)
  | 'xlsx_simple' // header on row 1 (XLSX)
  | 'zoom_two_table' // (a) session summary block, blank line, participant table
  | 'zoom_wide_flat' // (b) session + participant columns on every row, dup Duration col
  | 'zoom_preamble' // (c) "Attendee Report" / "Report generated time" rows above the header
  | 'zoom_xlsx_preamble' // (d) XLSX equivalent of (c)
  | 'zoom_api'; // not a file — pulled through lib/zoom.ts

export type LensId = 'L1' | 'L2' | 'L3' | 'L4' | 'L5' | 'L6' | 'L7';

export type BlockId = 'scorecard' | 'funnel' | 'per_webinar' | 'who_bought' | 'buyers_talked' | 'roi';

// The single most important label in the product. L3/L5/L7 compare groups that
// were formed by something close to the thing being tested; L1/L2/L4/L6 compare
// groups the world selected for us, so they measure selection as much as effect.
export type Credibility = 'causal' | 'directional';

export type DedupMode = 'unique_member' | 'raw_row';

// --- assumptions -----------------------------------------------------------

// Every knob that has ever caused a re-version of a hand-built report. Changing
// one of these and re-running must NOT require re-uploading anything.
export interface Assumptions {
  dedup_mode: DedupMode;
  attribution_days: number; // sale counts if order_time within N days after call_time
  attribution_requires_call: boolean; // false => not-called buyers attributed off session start
  zero_order_value: number; // notional value of a ₹0 / 100%-off coupon order
  default_order_value: number | null; // used when the sales file has no amount column
  engaged_min_turns: number; // talk turns that count as "engaged"
  connected_statuses: string[]; // call statuses that count as connected
  showed_up_min_minutes: number; // watch minutes needed to count as showed up
  left_early_minutes: number; // watched less than this => left early
  // Bot names are auto-detected from the call log, so there is nothing to
  // configure. These two remain only so an old saved assumption set still
  // deserialises; nothing reads them.
  /** @deprecated bots are auto-detected from the call log */
  signup_bot_match?: string;
  /** @deprecated bots are auto-detected from the call log */
  dayof_bot_match?: string;
  ai_weeks: string[]; // explicit ISO weeks that are AI weeks; empty => infer from call log
  attendance_precedence: 'upload' | 'zoom_api';
  min_session_attendees: number; // drop Zoom practice/test rooms below this
  cost_per_talk_minute: number;
  telephony_per_minute: number;
  fixed_cost: number;
  l4_randomised: boolean; // operator asserts AI/manual assignment alternated
  significance_alpha: number;
  min_cohort_n: number; // below this a comparison is flagged underpowered
  exclude_products: string[]; // product-name substrings that are not "the course"
  timezone_offset_minutes: number; // all data is IST => 330

  // --- identity crosswalk ---------------------------------------------------
  // A Zoom attendee export has no phone column, so without this an attendance
  // row can never meet a phone-keyed call log. Learned from the leads file.
  crosswalk_enabled: boolean;
  crosswalk_use_name: boolean; // also bridge on name — off by default, names collide

  // --- "actually talked" threshold -----------------------------------------
  // A connected status alone counts a 2-second pickup as a conversation. This
  // adds a duration floor; `talk_rule` decides what the floor is allowed to do.
  talk_min_seconds: number;
  talk_rule: TalkRule;

  // --- coupon-aware ₹0 orders ----------------------------------------------
  // A ₹0 row is either a 100%-off coupon (a real conversion worth the product
  // price) or a test/free row. The coupon code is what distinguishes them.
  coupon_codes: string[]; // comma-separated in the UI; empty => any coupon value counts
  zero_without_coupon: 'exclude' | 'count_zero' | 'count_notional';
  product_prices: ProductPrice[]; // per-product list price, for ₹0 coupon orders
}

// What the talk-duration floor is allowed to affect.
export type TalkRule =
  | 'off' // ignore duration entirely (original behaviour)
  | 'cohort' // keep `connected` as-is, expose a separate "talked" cohort
  | 'tighten_connected'; // a call must ALSO clear the floor to count as connected

export interface ProductPrice {
  match: string; // substring of the product name
  price: number;
}

export const DEFAULT_ASSUMPTIONS: Assumptions = {
  dedup_mode: 'unique_member',
  attribution_days: 7,
  attribution_requires_call: false,
  zero_order_value: 0,
  default_order_value: null,
  engaged_min_turns: 2,
  connected_statuses: ['completed', 'answered', 'connected', 'success', 'successful'],
  showed_up_min_minutes: 1,
  left_early_minutes: 15,
  ai_weeks: [],
  attendance_precedence: 'upload',
  min_session_attendees: 25,
  cost_per_talk_minute: 0,
  telephony_per_minute: 0,
  fixed_cost: 0,
  l4_randomised: false,
  significance_alpha: 0.05,
  min_cohort_n: 30,
  exclude_products: [],
  timezone_offset_minutes: 330,
  crosswalk_enabled: true,
  crosswalk_use_name: false,
  talk_min_seconds: 15,
  talk_rule: 'cohort',
  coupon_codes: [],
  zero_without_coupon: 'exclude',
  product_prices: [],
};

// --- facts -----------------------------------------------------------------

// One row per (person x webinar session). This is the join target for every
// input file and the only thing the lenses read.
export interface Fact {
  person_key: string;
  session_key: string;
  name: string | null;
  phone: string | null; // normalised last-10
  email: string | null;
  registered: boolean;
  dialled: boolean;
  connected: boolean;
  talk_turns: number | null;
  engaged: boolean;
  talked: boolean; // connected AND cleared the talk_min_seconds floor
  bots: string[]; // every bot that reached this person (auto-detected names)
  bot_id: string | null;
  call_mode: 'ai' | 'manual' | null;
  call_time: string | null;
  call_seconds: number | null;
  showed_up: boolean;
  watch_minutes: number | null;
  left_early: boolean;
  came_back: boolean;
  bought: boolean;
  order_value: number | null;
  order_time: string | null;
  holdout: boolean; // registered but never dialled
  week: string | null; // ISO week in IST, e.g. "2026-W27"
  session_date: string | null; // yyyy-mm-dd (IST)
  ai_week: boolean;
}

export interface SessionInfo {
  key: string;
  topic: string;
  date: string | null; // yyyy-mm-dd IST
  week: string | null;
  start_time: string | null;
  source: 'upload' | 'zoom_api' | 'derived';
  attendees: number;
  registrants: number;
  excluded: boolean; // below min_session_attendees
}

// --- statistics ------------------------------------------------------------

export interface Significance {
  z: number | null;
  p_value: number | null;
  significant: boolean;
  ci95: [number, number] | null; // CI on the absolute difference in rates
  mde: number | null; // minimum detectable effect at 80% power, in rate points
  warnings: string[];
}

export interface Proportion {
  label: string;
  n: number;
  k: number;
  rate: number; // k / n, 0 when n = 0
}

export interface Outcome {
  metric: 'showed_up' | 'bought' | 'came_back';
  label: string;
  a: Proportion;
  b: Proportion;
  abs_lift: number; // a.rate - b.rate
  rel_lift: number | null; // (a.rate - b.rate) / b.rate, null when baseline is 0
  significance: Significance;
}

export interface LensRow {
  label: string;
  n: number;
  showed: number;
  show_rate: number;
  show_lift: number | null;
  bought: number;
  buy_rate: number;
  buy_lift: number | null;
  baseline?: boolean;
  significance?: Significance;
}

export interface LensResult {
  id: LensId;
  label: string;
  question: string;
  credibility: Credibility;
  credibility_note: string;
  available: boolean;
  unavailable_reason?: string;
  cohort_a_label: string;
  cohort_b_label: string;
  outcomes: Outcome[];
  rows: LensRow[]; // tabular form (L5 is a matrix, the rest are two rows + baseline)
  caveats: string[];
}

// --- output blocks ---------------------------------------------------------

export interface Scorecard {
  headline: string;
  bottom_line: string;
  primary_lens: LensId | null;
  primary_credibility: Credibility | null;
  tiles: { label: string; value: string; detail: string }[];
  dedup_mode: DedupMode;
  denominator: number;
  denominator_label: string;
}

export interface FunnelStage {
  stage: string;
  count: number;
  pct_of_denominator: number;
  pct_of_previous: number | null;
}

export interface PerWebinarRow {
  session_key: string;
  topic: string;
  date: string | null;
  week: string | null;
  ai_week: boolean;
  registered: number;
  dialled: number;
  connected: number;
  showed: number;
  bought: number;
  revenue: number;
  show_rate: number;
  buy_rate: number;
  excluded: boolean;
}

export interface BuyerRow {
  name: string | null;
  phone: string | null;
  email: string | null;
  session_key: string;
  session_date: string | null;
  dialled: boolean;
  connected: boolean;
  talked: boolean; // cleared the talk-duration floor
  talk_turns: number | null;
  engaged: boolean; // met the talk-turns threshold
  call_seconds: number | null;
  bot_id: string | null;
  bots: string[];
  call_mode: string | null;
  call_time: string | null;
  showed_up: boolean;
  came_back: boolean;
  order_value: number;
  coupon: string | null;
  order_time: string | null;
  within_window: boolean;
}

// "Buyers who actually TALKED" — buyers filtered to the ones who held a real
// conversation. Both thresholds are reported so the sheet is self-explaining:
// a reader can see exactly which rule admitted each row.
export interface BuyersTalkedBlock {
  available: boolean;
  reason?: string;
  criterion: string; // human-readable rule, printed on the sheet
  min_turns: number;
  min_seconds: number;
  buyers: BuyerRow[]; // buyers who met it
  total_buyers: number; // attributed buyers overall, for the share below
  share_of_buyers: number; // buyers.length / total_buyers
  revenue: number; // revenue from the talked buyers
}

export interface RoiBlock {
  available: boolean;
  reason?: string;
  talk_minutes: number;
  call_cost: number;
  telephony_cost: number;
  fixed_cost: number;
  total_cost: number;
  attributed_revenue: number;
  gross_roi: number | null;
  incremental_lens: LensId | null;
  incremental_credibility: Credibility | null;
  incremental_buyers: number | null;
  incremental_revenue: number | null;
  incremental_roi: number | null;
  avg_order_value: number;
  notes: string[];
}

// --- data quality ----------------------------------------------------------

export interface QualityMetric {
  key: string;
  label: string;
  value: number;
  display: string;
  severity: 'ok' | 'warn' | 'bad';
  detail: string;
}

export interface QualityPanel {
  metrics: QualityMetric[];
  blockers: string[]; // hard problems — report is still exportable but loudly flagged
  warnings: string[];
  denominator_locked: boolean;
  denominator: number;
  denominator_label: string;
  hash: string; // acknowledging the panel acknowledges THIS hash
}

// --- the assembled report --------------------------------------------------

export interface ReportResult {
  template_key: string;
  template_name: string;
  generated_at: string;
  period_label: string | null;
  assumptions: Assumptions;
  scorecard: Scorecard;
  funnel: FunnelStage[];
  per_webinar: PerWebinarRow[];
  who_bought: BuyerRow[];
  // Buyers who held an actual conversation, not just a pickup. Its own block
  // because "did the call work" and "did they buy" are different questions.
  buyers_talked: BuyersTalkedBlock;
  roi: RoiBlock;
  lenses: LensResult[];
  sessions: SessionInfo[];
  fact_count: number;
  blocks: BlockId[];
}

// --- templates -------------------------------------------------------------

export interface ReportTemplate {
  id: string;
  client_id: string | null;
  key: string;
  name: string;
  description: string | null;
  lenses: LensId[];
  blocks: BlockId[];
  requires: InputRole[];
  optional_roles: InputRole[];
  primary_lens: LensId | null;
  is_builtin: boolean;
  sort_order: number;
}

// --- ingestion -------------------------------------------------------------

export interface ParsedGrid {
  grid: string[][];
  kind: 'csv' | 'xlsx';
  sheet_name: string | null;
}

export interface ShapeDetection {
  shape: DatasetShape;
  header_row: number;
  headers: string[];
  session_header_row: number | null;
  session_headers: string[];
  duplicate_headers: string[];
  notes: string[];
}

export interface DatasetPreview {
  headers: string[];
  rows: Record<string, string>[];
  session_rows: Record<string, string>[];
}

export interface MappingSuggestion {
  mapping: Record<string, string>; // field -> header
  confidence: Record<string, number>; // field -> 0..1
  unmapped_required: string[];
}
