// Ingestion: bytes -> raw grid -> detected shape -> row objects.
//
// The hard part is Zoom. The same "attendance export" arrives in four mutually
// incompatible physical shapes and the operator cannot be expected to know
// which one they downloaded, so we detect it:
//
//   (a) zoom_two_table  participants_*.csv / zoom.csv — a session summary table,
//                       a blank line, then the participant table underneath.
//   (b) zoom_wide_flat  meetinglistdetails_*.csv — session AND participant
//                       columns repeated on every row, with "Duration (Minutes)"
//                       appearing TWICE (session duration, then participant).
//   (c) zoom_preamble   attendee_*.csv — "Attendee Report" / "Report generated
//                       time" rows sit above the real header.
//   (d) zoom_xlsx_preamble — the XLSX equivalent of (c).
//
// Everything else (GoHighLevel leads, dialer logs, orders) is 'simple'.

import Papa from 'papaparse';
import ExcelJS from 'exceljs';
import type { DatasetShape, ParsedGrid, ShapeDetection } from './types';

const MAX_ROWS = 200_000; // hard cap so one pathological upload cannot OOM the function

export function normHeader(s: unknown): string {
  return String(s ?? '')
    .replace(/ /g, ' ')
    .trim()
    .toLowerCase()
    .replace(/[_\-]+/g, ' ')
    .replace(/[^a-z0-9%() ]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Tokens that mark a row as a participant/person header.
const PERSON_TOKENS = new Set([
  'name', 'name (original name)', 'user name', 'username', 'first name', 'last name', 'full name',
  'display name', 'attendee name', 'participant name', 'contact name',
  'email', 'user email', 'attendee email', 'email address', 'participant email',
  'join time', 'leave time', 'joined at', 'left at',
  'phone', 'mobile', 'phone number', 'mobile number', 'contact number',
]);

// Tokens that mark a row as a session/meeting header.
const SESSION_TOKENS = new Set([
  'topic', 'meeting id', 'webinar id', 'meeting topic', 'webinar topic',
  'start time', 'end time', 'actual start time', 'actual duration (minutes)',
  'host', 'host email', 'host name', 'department',
  'participants', 'unique viewers', 'registrants', 'has zoom rooms',
]);

const PREAMBLE_RE = /(attendee report|report generated time|meeting report|webinar report|registration report|topic report)/i;

// --- file -> grid ----------------------------------------------------------

export async function parseFile(filename: string, buf: Buffer): Promise<ParsedGrid> {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.xlsx') || lower.endsWith('.xlsm')) return parseXlsx(buf);
  return parseCsv(buf);
}

function parseCsv(buf: Buffer): ParsedGrid {
  // Strip a UTF-8 BOM — Zoom and GHL both emit one and it poisons the first header.
  let text = buf.toString('utf8');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const res = Papa.parse<string[]>(text, {
    header: false,
    skipEmptyLines: false,
    dynamicTyping: false,
    delimiter: '', // let Papa sniff , ; \t |
  });
  const grid = (res.data as unknown[][]).slice(0, MAX_ROWS).map((r) => (r as unknown[]).map(cell));
  return { grid: trimGrid(grid), kind: 'csv', sheet_name: null };
}

async function parseXlsx(buf: Buffer): Promise<ParsedGrid> {
  const wb = new ExcelJS.Workbook();
  // ExcelJS wants an ArrayBuffer-ish; a Node Buffer works at runtime.
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  if (!ws) return { grid: [], kind: 'xlsx', sheet_name: null };
  const grid: string[][] = [];
  ws.eachRow({ includeEmpty: true }, (row, i) => {
    if (i > MAX_ROWS) return;
    const vals = row.values as unknown[]; // 1-indexed; [0] is always undefined
    grid.push(vals.slice(1).map(cell));
  });
  return { grid: trimGrid(grid), kind: 'xlsx', sheet_name: ws.name };
}

// Flatten whatever a cell parser hands back into a trimmed string.
function cell(v: unknown): string {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (typeof o.text === 'string') return o.text.trim();
    if (typeof o.result === 'string' || typeof o.result === 'number') return String(o.result).trim();
    if (Array.isArray(o.richText)) return o.richText.map((r: any) => r.text ?? '').join('').trim();
    if (typeof o.hyperlink === 'string') return String(o.hyperlink).trim();
    return '';
  }
  return String(v).trim();
}

// Drop trailing all-empty columns and trailing all-empty rows.
function trimGrid(grid: string[][]): string[][] {
  let lastRow = -1;
  let width = 0;
  grid.forEach((r, i) => {
    const w = lastNonEmpty(r) + 1;
    if (w > 0) {
      lastRow = i;
      if (w > width) width = w;
    }
  });
  return grid.slice(0, lastRow + 1).map((r) => {
    const out = r.slice(0, width);
    while (out.length < width) out.push('');
    return out;
  });
}

function lastNonEmpty(row: string[]): number {
  for (let i = row.length - 1; i >= 0; i--) if (row[i] !== '') return i;
  return -1;
}

const isBlank = (row: string[]) => row.every((c) => c === '');

// --- shape detection -------------------------------------------------------

function score(row: string[]) {
  const cells = row.map(normHeader).filter(Boolean);
  if (cells.length < 2) return { person: 0, session: 0, filled: cells.length, numeric: 0 };
  let person = 0;
  let session = 0;
  let numeric = 0;
  for (const c of cells) {
    if (PERSON_TOKENS.has(c) || /(^|\s)(email|name|join time|leave time|phone|mobile)(\s|$)/.test(c)) person++;
    if (SESSION_TOKENS.has(c) || /(^|\s)(topic|meeting id|webinar id|start time|host)(\s|$)/.test(c)) session++;
    if (/^[\d.,%/:\s-]+$/.test(c)) numeric++;
  }
  return { person, session, filled: cells.length, numeric };
}

// A row is header-like when it names at least two things we recognise and is
// not mostly numbers (which would make it a data row).
function isHeaderish(row: string[]): boolean {
  const s = score(row);
  return s.person + s.session >= 2 && s.numeric < s.filled / 2;
}

export function detectShape(grid: string[][], kind: 'csv' | 'xlsx'): ShapeDetection {
  const notes: string[] = [];
  const empty: ShapeDetection = {
    shape: kind === 'xlsx' ? 'xlsx_simple' : 'simple',
    header_row: 0,
    headers: [],
    session_header_row: null,
    session_headers: [],
    duplicate_headers: [],
    notes: ['File contained no readable rows.'],
  };
  if (!grid.length) return empty;

  // Every header-like row, in order.
  const heads: number[] = [];
  for (let i = 0; i < Math.min(grid.length, 400); i++) if (isHeaderish(grid[i])) heads.push(i);
  if (!heads.length) {
    notes.push('No recognisable header row found — assuming row 1 is the header.');
    return finish(grid, 0, null, kind === 'xlsx' ? 'xlsx_simple' : 'simple', notes);
  }

  // (c)/(d) preamble: a report banner above the real header.
  const bannerRow = grid.slice(0, Math.min(8, grid.length)).findIndex((r) => r.some((c) => PREAMBLE_RE.test(c)));
  const realHeader = heads.find((i) => i > bannerRow);
  if (bannerRow >= 0 && realHeader != null && realHeader > bannerRow) {
    notes.push(
      `Preamble detected: row ${bannerRow + 1} is a report banner ("${firstNonEmpty(grid[bannerRow])}"); ` +
        `real header is row ${realHeader + 1}.`
    );
    return finish(grid, realHeader, null, kind === 'xlsx' ? 'zoom_xlsx_preamble' : 'zoom_preamble', notes);
  }

  // (a) two-table: a session header block, a gap, then a participant header.
  for (let a = 0; a < heads.length - 1; a++) {
    const first = heads[a];
    const sFirst = score(grid[first]);
    for (let b = a + 1; b < heads.length; b++) {
      const second = heads[b];
      if (second <= first + 1) continue;
      const sSecond = score(grid[second]);
      const gap = grid.slice(first + 1, second).some(isBlank);
      const sessionFirst = sFirst.session >= 2 && sFirst.session > sFirst.person;
      const personSecond = sSecond.person >= 2;
      if (gap && sessionFirst && personSecond) {
        notes.push(
          `Two-table export: session summary header on row ${first + 1}, participant header on row ${second + 1}.`
        );
        return finish(grid, second, first, 'zoom_two_table', notes);
      }
    }
  }

  // (b) wide flat: one header carrying both session and participant columns.
  const h = heads[0];
  const s = score(grid[h]);
  if (s.session >= 2 && s.person >= 2) {
    notes.push(`Wide flat export: session and participant columns share one header row (row ${h + 1}).`);
    return finish(grid, h, null, 'zoom_wide_flat', notes);
  }

  if (h > 0) notes.push(`Header found on row ${h + 1}; rows above it were ignored.`);
  return finish(grid, h, null, kind === 'xlsx' ? 'xlsx_simple' : 'simple', notes);
}

function firstNonEmpty(row: string[]): string {
  return row.find((c) => c !== '') ?? '';
}

function finish(
  grid: string[][],
  headerRow: number,
  sessionHeaderRow: number | null,
  shape: DatasetShape,
  notes: string[]
): ShapeDetection {
  const { headers, duplicates } = dedupeHeaders(grid[headerRow] ?? []);
  if (duplicates.length) {
    notes.push(
      `Duplicate column name(s): ${duplicates.join(', ')}. Later copies were renamed with a " #n" suffix ` +
        `(Zoom's wide export repeats "Duration (Minutes)" — the first is the session length, the second is the person's watch time).`
    );
  }
  const sessionHeaders = sessionHeaderRow == null ? [] : dedupeHeaders(grid[sessionHeaderRow] ?? []).headers;
  return {
    shape,
    header_row: headerRow,
    headers,
    session_header_row: sessionHeaderRow,
    session_headers: sessionHeaders,
    duplicate_headers: duplicates,
    notes,
  };
}

// Zoom repeats header names. Keep both columns but make the names addressable.
export function dedupeHeaders(row: string[]): { headers: string[]; duplicates: string[] } {
  const seen = new Map<string, number>();
  const duplicates: string[] = [];
  const headers = row.map((raw, i) => {
    const base = String(raw ?? '').trim() || `Column ${i + 1}`;
    const key = normHeader(base);
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    if (n > 1) {
      if (!duplicates.includes(base)) duplicates.push(base);
      return `${base} #${n}`;
    }
    return base;
  });
  return { headers, duplicates };
}

// --- grid -> row objects ---------------------------------------------------

export interface ExtractedRows {
  main: Record<string, string>[];
  session: Record<string, string>[];
}

export function extractRows(grid: string[][], d: ShapeDetection): ExtractedRows {
  const main: Record<string, string>[] = [];
  const session: Record<string, string>[] = [];

  // The session block of a two-table export: rows between its header and the
  // blank line (or the participant header) below it.
  if (d.session_header_row != null) {
    for (let i = d.session_header_row + 1; i < d.header_row; i++) {
      const row = grid[i];
      if (!row || isBlank(row)) break;
      session.push(toObject(d.session_headers, row));
    }
  }

  for (let i = d.header_row + 1; i < grid.length; i++) {
    const row = grid[i];
    if (!row || isBlank(row)) continue;
    // A second banner/header repeated mid-file (Zoom does this when a report
    // spans several meetings) — skip it rather than importing it as data.
    if (isHeaderish(row) && sameAsHeader(d.headers, row)) continue;
    main.push(toObject(d.headers, row));
  }
  return { main, session };
}

function sameAsHeader(headers: string[], row: string[]): boolean {
  const a = headers.map(normHeader).filter(Boolean).join('|');
  const b = row.map(normHeader).filter(Boolean).join('|');
  return a.length > 0 && a === b;
}

function toObject(headers: string[], row: string[]): Record<string, string> {
  const o: Record<string, string> = {};
  for (let c = 0; c < headers.length; c++) o[headers[c]] = row[c] ?? '';
  return o;
}

// Stable signature of a file's header list, used to look up a saved mapping.
export function headerSignature(headers: string[]): string {
  const norm = headers.map(normHeader).filter(Boolean).sort().join('');
  // Small, dependency-free FNV-1a — this only needs to be stable, not secure.
  let hash = 0x811c9dc5;
  for (let i = 0; i < norm.length; i++) {
    hash ^= norm.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}
