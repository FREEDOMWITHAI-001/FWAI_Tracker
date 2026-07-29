// Styled XLSX export. The palette and number formats deliberately match the
// workbooks we have already shipped to clients (openpyxl: header #4472C4 white
// bold, lavender sub-rows #D9E1F2, peach totals #FCE4D6, green highlight
// #C6EFCE, one-decimal percentages, "+0.0%;-0.0%" deltas) so a generated report
// is visually indistinguishable from the hand-built ones it replaces.

import ExcelJS from 'exceljs';
import { istClock } from './dates';
import { LENS_META } from './lenses';
import type { LensResult, QualityPanel, ReportResult } from './types';

const HDR = 'FF4472C4';
const SUB = 'FFD9E1F2';
const TOTAL = 'FFFCE4D6';
const GREEN = 'FFC6EFCE';
const AMBER = 'FFFFF2CC';
const RED = 'FFFCE4E4';
const TITLE_INK = 'FF1F3864';
const GRID = 'FFBFBFBF';

const PCT = '0.0%';
const PCT2 = '0.00%';
const DELTA = '+0.0%;-0.0%';
// Absolute gaps are written pre-multiplied by 100 (percentage points, not a
// fraction), so the format carries a literal "pp" instead of Excel's %.
const DELTA_PP = '+0.0"pp";-0.0"pp"';
const MONEY = '#,##0';

const border = {
  top: { style: 'thin' as const, color: { argb: GRID } },
  left: { style: 'thin' as const, color: { argb: GRID } },
  bottom: { style: 'thin' as const, color: { argb: GRID } },
  right: { style: 'thin' as const, color: { argb: GRID } },
};

const fill = (argb: string) => ({ type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb } });

type Cell = ExcelJS.Cell;

export interface WorkbookMeta {
  client_name: string;
  report_name: string;
}

export async function renderWorkbook(
  result: ReportResult,
  quality: QualityPanel,
  meta: WorkbookMeta
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'FWAI Tracker';
  wb.created = new Date();

  const blocks = new Set(result.blocks);
  sheetScorecard(wb, result, meta);
  if (blocks.has('funnel')) sheetFunnel(wb, result);
  sheetComparisons(wb, result);
  if (blocks.has('per_webinar')) sheetPerWebinar(wb, result);
  if (blocks.has('who_bought')) sheetWhoBought(wb, result);
  // Rendered whenever the data supports it, even if the template did not ask —
  // "did they buy after a real conversation" is the question every one of these
  // reports gets asked in the review call.
  if (result.buyers_talked?.available) sheetBuyersTalked(wb, result);
  if (blocks.has('roi') && result.roi.available) sheetRoi(wb, result);
  if (result.ai_vs_manual.available) sheetAiVsManual(wb, result);
  sheetQuality(wb, quality, result);
  sheetDefinitions(wb, result);

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

// --- small helpers ---------------------------------------------------------

// `sub` is the prominent line right under the title (row 2) — on the
// Scorecard sheet this is the period label, e.g. "Webinar Sun 19 Jul 2026,
// 11:00 AM · 2,492 registered leads (12 Jul 11am – 19 Jul 11am)", matching
// the client-facing format the team already hand-writes. `sub2` is an
// optional smaller footnote (row 3, previously blank on every sheet) for
// provenance — template name, generation timestamp, dedup mode — that
// clients don't need front and center but still belongs in the file.
function titleRow(ws: ExcelJS.Worksheet, text: string, span: number, sub?: string, sub2?: string) {
  ws.mergeCells(1, 1, 1, span);
  const t = ws.getCell(1, 1);
  t.value = text;
  t.font = { bold: true, size: 14, color: { argb: TITLE_INK } };
  ws.getRow(1).height = 22;
  if (sub) {
    ws.mergeCells(2, 1, 2, span);
    const s = ws.getCell(2, 1);
    s.value = sub;
    s.font = { italic: true, size: 10, color: { argb: 'FF555555' } };
  }
  if (sub2) {
    ws.mergeCells(3, 1, 3, span);
    const s2 = ws.getCell(3, 1);
    s2.value = sub2;
    s2.font = { italic: true, size: 8.5, color: { argb: 'FF999999' } };
  }
}

function headerRow(ws: ExcelJS.Worksheet, rowIdx: number, headers: string[]) {
  const row = ws.getRow(rowIdx);
  headers.forEach((h, i) => {
    const c = row.getCell(i + 1);
    c.value = h;
    c.fill = fill(HDR);
    c.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    c.border = border;
  });
  row.height = 26;
  return rowIdx + 1;
}

function sectionBar(ws: ExcelJS.Worksheet, rowIdx: number, label: string, span: number) {
  ws.mergeCells(rowIdx, 1, rowIdx, span);
  const c = ws.getCell(rowIdx, 1);
  c.value = label;
  c.fill = fill(HDR);
  c.font = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
  c.alignment = { horizontal: 'left', vertical: 'middle' };
  c.border = border;
  return rowIdx + 1;
}

function dataRow(
  ws: ExcelJS.Worksheet,
  rowIdx: number,
  values: (string | number | null)[],
  opts: { fillArgb?: string; bold?: boolean; formats?: Record<number, string> } = {}
) {
  const row = ws.getRow(rowIdx);
  values.forEach((v, i) => {
    const c = row.getCell(i + 1);
    c.value = v as ExcelJS.CellValue;
    c.border = border;
    c.alignment = i === 0 ? { horizontal: 'left', vertical: 'middle', wrapText: true } : { horizontal: 'center', vertical: 'middle' };
    if (opts.fillArgb) c.fill = fill(opts.fillArgb);
    if (opts.bold) c.font = { bold: true };
    const fmt = opts.formats?.[i + 1];
    if (fmt && typeof v === 'number') c.numFmt = fmt;
  });
  return rowIdx + 1;
}

function noteRow(ws: ExcelJS.Worksheet, rowIdx: number, text: string, span: number, height = 46) {
  ws.mergeCells(rowIdx, 1, rowIdx, span);
  const c = ws.getCell(rowIdx, 1);
  c.value = text;
  c.font = { italic: true, size: 9 };
  c.alignment = { wrapText: true, vertical: 'top' };
  ws.getRow(rowIdx).height = height;
  return rowIdx + 1;
}

function widths(ws: ExcelJS.Worksheet, w: number[]) {
  w.forEach((width, i) => {
    ws.getColumn(i + 1).width = width;
  });
}

const credibilityTag = (l: { credibility: string }) =>
  l.credibility === 'causal' ? 'CAUSALLY CREDIBLE' : 'DIRECTIONAL ONLY';

// --- sheets ----------------------------------------------------------------

function sheetScorecard(wb: ExcelJS.Workbook, r: ReportResult, meta: WorkbookMeta) {
  const ws = wb.addWorksheet('Scorecard', { views: [{ showGridLines: false }] });
  const span = 5;
  titleRow(
    ws,
    `${meta.client_name} — ${meta.report_name}`,
    span,
    r.period_label ?? r.template_name,
    `${r.template_name} · generated ${istClock(r.generated_at) ?? '—'} IST · ` +
      `counts are ${r.scorecard.dedup_mode === 'unique_member' ? 'PER UNIQUE MEMBER' : 'PER RAW ROW'}`
  );

  let row = 4;
  row = sectionBar(ws, row, '1.  Headline', span);
  row = noteRow(ws, row, r.scorecard.headline, span, 34);
  row = sectionBar(ws, row, '2.  Bottom line', span);
  row = noteRow(ws, row, r.scorecard.bottom_line, span, 46);
  row++;

  row = sectionBar(ws, row, '3.  Key numbers', span);
  row = headerRow(ws, row, ['Metric', 'Value', 'Detail', '', '']);
  for (const t of r.scorecard.tiles) row = dataRow(ws, row, [t.label, t.value, t.detail, '', '']);
  row++;

  row = sectionBar(ws, row, '4.  Comparison credibility', span);
  row = headerRow(ws, row, ['Lens', 'Comparison', 'Credibility', 'Available', '']);
  for (const l of r.lenses) {
    const causal = l.credibility === 'causal';
    row = dataRow(
      ws,
      row,
      [l.id, l.label, credibilityTag(l), l.available ? 'yes' : `no — ${l.unavailable_reason ?? ''}`, ''],
      { fillArgb: !l.available ? undefined : causal ? GREEN : AMBER }
    );
  }
  row = noteRow(
    ws,
    row,
    'Credibility is not a style choice. A CAUSALLY CREDIBLE lens compares groups that were formed by something ' +
      'unrelated to the person (time, which script they got). A DIRECTIONAL ONLY lens compares groups the world ' +
      'selected for us — people who answer the phone, or leads someone chose to dial — so it measures selection as ' +
      'much as effect and must never be presented as proof.',
    span,
    62
  );

  const rr = r.registered_vs_retargeted;
  if (rr.available) {
    row++;
    const title = rr.basis === 'leads' ? '5.  Registered vs Retargeted' : '5.  Called vs Organic';
    const leftCol = rr.basis === 'leads' ? 'Registered' : 'Called';
    const rightCol = rr.basis === 'leads' ? 'Retargeted*' : 'Organic*';
    row = sectionBar(ws, row, title, span);
    row = headerRow(ws, row, ['', leftCol, rightCol, 'Total', '']);
    const totalAttended = rr.attended_registered + rr.attended_retargeted;
    const totalBought = rr.bought_registered + rr.bought_retargeted;
    row = dataRow(ws, row, ['Attended the webinar', rr.attended_registered, rr.attended_retargeted, totalAttended, ''], {
      formats: { 2: MONEY, 3: MONEY, 4: MONEY },
    });
    row = dataRow(ws, row, ['Bought', rr.bought_registered, rr.bought_retargeted, totalBought, ''], {
      fillArgb: TOTAL,
      bold: true,
      formats: { 2: MONEY, 3: MONEY, 4: MONEY },
    });
    row = noteRow(
      ws,
      row,
      rr.basis === 'leads'
        ? '*Retargeted = attended or bought but never appeared in a leads/registrations file — reached some other ' +
          'way (a prior week\'s list, a direct link, WhatsApp, etc.), not on this report\'s registration list.'
        : '*No leads/registrations file was provided for this report, so "Called" falls back to whoever the AI ' +
          'dialled. Organic = attended or bought without ever being called.',
      span,
      30
    );
  }

  widths(ws, [34, 26, 46, 30, 12]);
}

function sheetFunnel(wb: ExcelJS.Workbook, r: ReportResult) {
  const ws = wb.addWorksheet('Funnel', { views: [{ showGridLines: false }] });
  titleRow(ws, 'Funnel', 4, `Denominator locked at ${r.scorecard.denominator.toLocaleString()} (${r.scorecard.denominator_label}).`);
  let row = headerRow(ws, 4, ['Stage', 'Count', '% of population', '% of basis', 'Basis']);
  r.funnel.forEach((f, i) => {
    row = dataRow(ws, row, [f.stage, f.count, f.pct_of_denominator, f.pct_of_previous, f.pct_of_previous_label ?? '—'], {
      fillArgb: i === 0 ? SUB : i === r.funnel.length - 1 ? TOTAL : undefined,
      bold: i === 0 || i === r.funnel.length - 1,
      formats: { 2: MONEY, 3: PCT, 4: PCT },
    });
  });
  widths(ws, [34, 14, 18, 16, 20]);
  ws.views = [{ state: 'frozen', ySplit: 4, showGridLines: false }];
}

function sheetComparisons(wb: ExcelJS.Workbook, r: ReportResult) {
  const ws = wb.addWorksheet('Comparisons', { views: [{ showGridLines: false }] });
  const span = 11;
  titleRow(
    ws,
    'Comparisons — every lens in this report',
    span,
    'Credible lenses first. Δpp is the absolute percentage-point gap vs the baseline row; Δ% is the relative lift ' +
      '("n/a" means the baseline was 0 and a percentage would be fabricated). "Session-weighted" lines compare each ' +
      'webinar against its OWN baseline and weight the delta by that webinar\'s treated people, negatives kept — ' +
      'pooled totals across lists are never used.'
  );
  let row = 4;
  for (const l of r.lenses) {
    row = sectionBar(ws, row, `${l.id} · ${l.label} — ${credibilityTag(l)}`, span);
    if (!l.available) {
      row = noteRow(ws, row, `Not available: ${l.unavailable_reason ?? 'inputs missing'}`, span, 22);
      row++;
      continue;
    }
    row = headerRow(ws, row, [
      'Group', 'People', 'Showed', 'Show-up %', 'Show-up Δpp', 'Show-up Δ%', 'Bought', 'Buyer %', 'Buyer Δpp', 'Buyer Δ%', 'p-value',
    ]);
    for (const g of l.rows) {
      const isBase = !!g.baseline;
      row = dataRow(
        ws,
        row,
        [
          g.label,
          g.n,
          g.showed,
          g.show_rate,
          g.show_lift_abs != null ? g.show_lift_abs * 100 : 'n/a',
          g.show_lift ?? 'n/a',
          g.bought,
          g.buy_rate,
          g.buy_lift_abs != null ? g.buy_lift_abs * 100 : 'n/a',
          g.buy_lift ?? 'n/a',
          g.significance?.p_value ?? '',
        ],
        {
          fillArgb: isBase ? SUB : l.credibility === 'causal' ? GREEN : undefined,
          bold: isBase,
          formats: { 2: MONEY, 3: MONEY, 4: PCT, 5: DELTA_PP, 6: DELTA, 7: MONEY, 8: PCT, 9: DELTA_PP, 10: DELTA, 11: '0.000' },
        }
      );
    }
    for (const o of l.outcomes) {
      const sig = o.significance;
      const rel = o.rel_lift == null ? 'n/a' : `${o.rel_lift >= 0 ? '+' : ''}${(o.rel_lift * 100).toFixed(1)}%`;
      row = noteRow(
        ws,
        row,
        `${o.label}: ${(o.a.rate * 100).toFixed(1)}% (${o.a.k}/${o.a.n}) vs ${(o.b.rate * 100).toFixed(1)}% (${o.b.k}/${o.b.n}) — ` +
          `${o.abs_lift >= 0 ? '+' : ''}${(o.abs_lift * 100).toFixed(2)}pp (${rel}), ` +
          `p=${sig.p_value == null ? 'n/a' : sig.p_value < 0.001 ? '<0.001' : sig.p_value.toFixed(3)}, ` +
          `${sig.significant ? 'significant' : 'NOT significant'}` +
          (sig.ci95 ? `, 95% CI ${(sig.ci95[0] * 100).toFixed(1)}pp to ${(sig.ci95[1] * 100).toFixed(1)}pp` : '') +
          (sig.warnings.length ? ` — ${sig.warnings.join(' ')}` : ''),
        span,
        34
      );
      const norm = o.normalized;
      if (norm) {
        const nRel = norm.rel_lift == null ? 'n/a' : `${norm.rel_lift >= 0 ? '+' : ''}${(norm.rel_lift * 100).toFixed(1)}%`;
        row = noteRow(
          ws,
          row,
          `${o.label} — session-weighted: ${(norm.a_rate * 100).toFixed(1)}% vs ${(norm.b_rate * 100).toFixed(1)}% — ` +
            `${norm.abs_lift >= 0 ? '+' : ''}${(norm.abs_lift * 100).toFixed(2)}pp (${nRel}), each webinar's delta weighted ` +
            `by its treated people (negatives kept), over ${norm.sessions_used}/${norm.sessions_total} webinars (${Math.round(norm.coverage * 100)}% of people).`,
          span,
          22
        );
      }
    }
    row = noteRow(ws, row, `Why this label: ${l.credibility_note}${l.caveats.length ? ' ' + l.caveats.join(' ') : ''}`, span, 46);
    row++;
  }
  widths(ws, [32, 10, 10, 12, 12, 12, 10, 11, 11, 11, 10]);
}

function sheetPerWebinar(wb: ExcelJS.Workbook, r: ReportResult) {
  const ws = wb.addWorksheet('Per-webinar', { views: [{ showGridLines: false }] });
  titleRow(ws, 'Per-webinar breakdown', 12, 'One row per session. Sessions below the attendee floor are marked and excluded from the totals.');
  let row = headerRow(ws, 4, [
    'Date', 'Week', 'AI week', 'Topic', 'Registered', 'Dialled', 'Connected', 'Showed', 'Show-up %', 'Bought', 'Buyer %', 'Revenue',
  ]);
  const live = r.per_webinar.filter((w) => !w.excluded);
  for (const w of r.per_webinar) {
    row = dataRow(
      ws,
      row,
      [
        w.date ?? '—', w.week ?? '—', w.ai_week ? 'yes' : 'no', w.excluded ? `${w.topic}  (excluded: small session)` : w.topic,
        w.registered, w.dialled, w.connected, w.showed, w.show_rate, w.bought, w.buy_rate, w.revenue,
      ],
      {
        fillArgb: w.excluded ? RED : w.ai_week ? GREEN : undefined,
        formats: { 5: MONEY, 6: MONEY, 7: MONEY, 8: MONEY, 9: PCT, 10: MONEY, 11: PCT, 12: MONEY },
      }
    );
  }
  const sum = (f: (w: (typeof live)[number]) => number) => live.reduce((t, w) => t + f(w), 0);
  const people = sum((w) => w.registered) || live.length;
  const showed = sum((w) => w.showed);
  const bought = sum((w) => w.bought);
  dataRow(
    ws,
    row,
    [
      'TOTAL', `${live.length} sessions`, '', '', sum((w) => w.registered), sum((w) => w.dialled), sum((w) => w.connected),
      showed, people ? showed / people : 0, bought, people ? bought / people : 0, sum((w) => w.revenue),
    ],
    { fillArgb: TOTAL, bold: true, formats: { 5: MONEY, 6: MONEY, 7: MONEY, 8: MONEY, 9: PCT, 10: MONEY, 11: PCT, 12: MONEY } }
  );
  widths(ws, [12, 10, 9, 40, 12, 10, 11, 10, 11, 9, 10, 13]);
  ws.views = [{ state: 'frozen', ySplit: 4, showGridLines: false }];
}

function sheetWhoBought(wb: ExcelJS.Workbook, r: ReportResult) {
  const ws = wb.addWorksheet('Who bought', { views: [{ showGridLines: false }] });
  titleRow(
    ws,
    `Who bought (${r.who_bought.filter((b) => b.within_window).length} attributed, ${r.who_bought.filter((b) => !b.within_window).length} unattributed)`,
    12,
    'Unattributed buyers are listed too — a report that hides them will disagree with the client’s own sales sheet.'
  );
  let row = headerRow(ws, 4, [
    'Name', 'Phone', 'Email', 'Session', 'Session date', 'Dialled', 'Connected', 'Call mode', 'Talk turns', 'Bot(s)', 'Showed', 'Came back', 'Order value', 'Coupon', 'Order time',
  ]);
  for (const b of r.who_bought) {
    row = dataRow(
      ws,
      row,
      [
        b.name ?? '—', b.phone ?? '—', b.email ?? '—', b.within_window ? b.session_key : 'UNATTRIBUTED',
        b.session_date ?? '—', b.dialled ? 'yes' : 'no', b.connected ? 'yes' : 'no',
        b.call_mode ?? '—', b.talk_turns ?? '—',
        b.bots?.length ? b.bots.join(', ') : (b.bot_id ?? '—'),
        b.showed_up ? 'yes' : 'no', b.came_back ? 'yes' : 'no', b.order_value, b.coupon ?? '—',
        b.order_time ? istClock(b.order_time) : '—',
      ],
      { fillArgb: b.within_window ? undefined : RED, formats: { 13: MONEY } }
    );
  }
  widths(ws, [26, 14, 30, 22, 13, 9, 11, 10, 11, 20, 9, 11, 13, 16, 18]);
  ws.views = [{ state: 'frozen', ySplit: 4, showGridLines: false }];
}

function sheetBuyersTalked(wb: ExcelJS.Workbook, r: ReportResult) {
  const b = r.buyers_talked;
  const ws = wb.addWorksheet('Buyers who talked', { views: [{ showGridLines: false }] });
  titleRow(
    ws,
    `Buyers who actually talked — ${b.buyers.length} of ${b.total_buyers} attributed buyers (${(b.share_of_buyers * 100).toFixed(1)}%)`,
    11,
    `Rule: ${b.criterion}. A connected status on its own counts a two-second pickup as a conversation, which is why this ` +
      'sheet exists as a separate cut of the buyer list.'
  );

  let row = 4;
  row = sectionBar(ws, row, 'Summary', 11);
  row = headerRow(ws, row, ['Metric', 'Value', '', '', '', '', '', '', '', '', '']);
  row = dataRow(ws, row, ['Attributed buyers (all)', b.total_buyers, '', '', '', '', '', '', '', '', '']);
  row = dataRow(ws, row, ['…who actually talked', b.buyers.length, '', '', '', '', '', '', '', '', '']);
  row = dataRow(ws, row, ['Share of buyers', b.share_of_buyers, '', '', '', '', '', '', '', '', ''], {
    formats: { 2: PCT },
  });
  row = dataRow(ws, row, ['Revenue from talked buyers', b.revenue, '', '', '', '', '', '', '', '', ''], {
    formats: { 2: MONEY },
  });
  row = dataRow(ws, row, [`Talk-turns threshold`, b.min_turns, '', '', '', '', '', '', '', '', '']);
  row = dataRow(ws, row, [`Duration threshold (seconds)`, b.min_seconds, '', '', '', '', '', '', '', '', '']);
  row += 1;

  row = sectionBar(ws, row, 'The buyers', 11);
  row = headerRow(ws, row, [
    'Name', 'Phone', 'Email', 'Session date', 'Talk turns', 'Call seconds', 'Bot(s)', 'Showed', 'Order value', 'Coupon', 'Order time',
  ]);
  if (!b.buyers.length) {
    row = noteRow(ws, row, 'No attributed buyer met the rule above.', 11, 20);
  }
  for (const x of b.buyers) {
    row = dataRow(
      ws,
      row,
      [
        x.name ?? '—',
        x.phone ?? '—',
        x.email ?? '—',
        x.session_date ?? '—',
        x.talk_turns ?? '—',
        x.call_seconds ?? '—',
        x.bots?.length ? x.bots.join(', ') : (x.bot_id ?? '—'),
        x.showed_up ? 'yes' : 'no',
        x.order_value,
        x.coupon ?? '—',
        x.order_time ? istClock(x.order_time) : '—',
      ],
      { formats: { 9: MONEY } }
    );
  }
  widths(ws, [26, 14, 30, 13, 11, 13, 22, 9, 13, 16, 18]);
}

function sheetAiVsManual(wb: ExcelJS.Workbook, r: ReportResult) {
  const b = r.ai_vs_manual;
  const ws = wb.addWorksheet('AI vs Manual', { views: [{ showGridLines: false }] });
  titleRow(
    ws,
    'AI calling vs Manual calling',
    5,
    `Calls made — Manual ${b.calls_made.manual.toLocaleString()}, AI ${b.calls_made.ai.toLocaleString()}.`
  );

  let row = 4;
  row = sectionBar(ws, row, 'Relative — buy rate by basis', 5);
  row = headerRow(ws, row, ['Basis', 'Manual', 'AI', 'AI vs Manual', 'Winner']);
  for (const g of b.relative) {
    row = dataRow(
      ws,
      row,
      [
        g.label,
        g.manual.rate,
        g.ai.rate,
        g.rel_diff == null ? 'n/a' : `${g.rel_diff >= 0 ? '+' : ''}${(g.rel_diff * 100).toFixed(1)}%`,
        g.winner === 'tie' ? 'TIE' : g.winner.toUpperCase(),
      ],
      { fillArgb: g.winner === 'ai' ? GREEN : g.winner === 'manual' ? AMBER : undefined, formats: { 2: PCT2, 3: PCT2 } }
    );
  }
  for (const g of b.relative) {
    row = noteRow(
      ws,
      row,
      `${g.label}: Manual ${(g.manual.rate * 100).toFixed(2)}% (${g.manual.k}/${g.manual.n}) vs ` +
        `AI ${(g.ai.rate * 100).toFixed(2)}% (${g.ai.k}/${g.ai.n}).`,
      5,
      18
    );
  }
  row++;

  row = sectionBar(ws, row, 'Per-webinar (fair comparison — different webinar counts each side)', 5);
  row = headerRow(ws, row, ['', 'Manual', 'AI', '', '']);
  row = dataRow(ws, row, ['Webinars', b.per_webinar.manual.webinars, b.per_webinar.ai.webinars, '', '']);
  row = dataRow(
    ws,
    row,
    ['Calls made (avg)', b.per_webinar.manual.calls_avg, b.per_webinar.ai.calls_avg, '', ''],
    { formats: { 2: '#,##0.0', 3: '#,##0.0' } }
  );
  row = dataRow(
    ws,
    row,
    ['Buyers (avg)', b.per_webinar.manual.buyers_avg, b.per_webinar.ai.buyers_avg, '', ''],
    { formats: { 2: '#,##0.0', 3: '#,##0.0' } }
  );
  row = dataRow(
    ws,
    row,
    ['Buy rate per dialled lead (avg)', b.per_webinar.manual.buy_rate_avg, b.per_webinar.ai.buy_rate_avg, '', ''],
    { formats: { 2: PCT2, 3: PCT2 } }
  );
  row++;

  for (const n of b.notes) row = noteRow(ws, row, n, 5, 30);
  widths(ws, [38, 16, 16, 16, 12]);
}

function sheetRoi(wb: ExcelJS.Workbook, r: ReportResult) {
  const ws = wb.addWorksheet('ROI', { views: [{ showGridLines: false }] });
  const roi = r.roi;
  titleRow(ws, 'ROI', 4, 'Gross ROI credits calling with every sale from a dialled person. Incremental ROI prices only the lift a credible lens measured.');
  let row = 4;
  row = sectionBar(ws, row, 'Cost', 4);
  row = headerRow(ws, row, ['Component', 'Value', 'Basis', '']);
  row = dataRow(ws, row, ['Talk minutes', roi.talk_minutes, 'connected call duration / cost file', ''], { formats: { 2: '#,##0.0' } });
  row = dataRow(ws, row, ['Call cost', roi.call_cost, '₹ per talk-minute × minutes', ''], { formats: { 2: MONEY } });
  row = dataRow(ws, row, ['Telephony', roi.telephony_cost, '₹ per minute × minutes', ''], { formats: { 2: MONEY } });
  row = dataRow(ws, row, ['Fixed', roi.fixed_cost, 'platform / licence', ''], { formats: { 2: MONEY } });
  row = dataRow(ws, row, ['Total cost', roi.total_cost, '', ''], { fillArgb: TOTAL, bold: true, formats: { 2: MONEY } });
  row++;

  row = sectionBar(ws, row, 'Return', 4);
  row = headerRow(ws, row, ['Measure', 'Value', 'How it was derived', '']);
  row = dataRow(ws, row, ['Attributed revenue', roi.attributed_revenue, 'sales from dialled people inside the window', ''], { formats: { 2: MONEY } });
  row = dataRow(ws, row, ['Average order value', roi.avg_order_value, '', ''], { formats: { 2: MONEY } });
  row = dataRow(ws, row, ['Gross ROI', roi.gross_roi ?? 'n/a', 'attributed revenue ÷ total cost — flattering', ''], { formats: { 2: '0.00"x"' } });
  row = dataRow(
    ws,
    row,
    [
      'Incremental buyers', roi.incremental_buyers ?? 'n/a',
      roi.incremental_lens ? `lift from ${roi.incremental_lens} × treated population` : 'no credible lens available', '',
    ],
    { formats: { 2: '#,##0.0' } }
  );
  row = dataRow(ws, row, ['Incremental revenue', roi.incremental_revenue ?? 'n/a', '', ''], { formats: { 2: MONEY } });
  row = dataRow(
    ws,
    row,
    ['INCREMENTAL ROI', roi.incremental_roi ?? 'n/a', roi.incremental_lens ? `via ${roi.incremental_lens} (${roi.incremental_credibility})` : '', ''],
    { fillArgb: roi.incremental_credibility === 'causal' ? GREEN : AMBER, bold: true, formats: { 2: '0.00"x"' } }
  );
  row++;

  // The audit line: incremental buyers must be a visible per-webinar addition
  // (treated × delta, negatives kept), never a bare claimed total.
  const lens = roi.incremental_lens ? r.lenses.find((l) => l.id === roi.incremental_lens) : null;
  const norm = lens?.outcomes.find((o) => o.metric === 'bought')?.normalized;
  if (norm?.strata?.length) {
    row = sectionBar(ws, row, 'Per-webinar extra buyers — the addition behind the headline (negatives kept)', 4);
    row = headerRow(ws, row, ['Webinar', 'Treated', 'Treated buy% − baseline buy%', 'Extra buyers']);
    const sessions = new Map(r.sessions.map((s) => [s.key, s]));
    for (const st of norm.strata) {
      const s = sessions.get(st.key);
      row = dataRow(
        ws,
        row,
        [s ? `${s.date ?? ''}  ${s.topic}`.trim() : st.key, st.a_n, (st.a_rate - st.b_rate) * 100, st.extra],
        { fillArgb: st.extra < 0 ? RED : undefined, formats: { 2: MONEY, 3: DELTA_PP, 4: '+#,##0.0;-#,##0.0' } }
      );
    }
    row = dataRow(
      ws,
      row,
      ['Total (= incremental buyers)', norm.treated_n, norm.abs_lift * 100, roi.incremental_buyers ?? ''],
      { fillArgb: TOTAL, bold: true, formats: { 2: MONEY, 3: DELTA_PP, 4: '+#,##0.0;-#,##0.0' } }
    );
    row++;
  }

  for (const n of roi.notes) row = noteRow(ws, row, n, 4, 30);
  widths(ws, [40, 16, 56, 14]);
}

function sheetQuality(wb: ExcelJS.Workbook, q: QualityPanel, r: ReportResult) {
  const ws = wb.addWorksheet('Data quality', { views: [{ showGridLines: false }] });
  titleRow(ws, 'Data quality', 4, `Reviewed before export. Panel signature ${q.hash}. Denominator locked at ${q.denominator.toLocaleString()} (${q.denominator_label}).`);
  let row = headerRow(ws, 4, ['Check', 'Value', 'What it means', 'Status']);
  for (const m of q.metrics) {
    row = dataRow(ws, row, [m.label, m.display, m.detail, m.severity.toUpperCase()], {
      fillArgb: m.severity === 'ok' ? undefined : m.severity === 'warn' ? AMBER : RED,
    });
  }
  row++;
  if (q.blockers.length) {
    row = sectionBar(ws, row, 'Blocking problems', 4);
    for (const b of q.blockers) row = noteRow(ws, row, b, 4, 30);
  }
  if (q.warnings.length) {
    row = sectionBar(ws, row, 'Warnings', 4);
    for (const w of q.warnings) row = noteRow(ws, row, w, 4, 30);
  }
  widths(ws, [40, 20, 62, 12]);
  ws.views = [{ state: 'frozen', ySplit: 4, showGridLines: false }];
  void r;
}

function sheetDefinitions(wb: ExcelJS.Workbook, r: ReportResult) {
  const ws = wb.addWorksheet('Definitions', { views: [{ showGridLines: false }] });
  titleRow(ws, 'Definitions & assumptions', 3, 'Every number in this workbook is a consequence of exactly these settings. Change one, re-run, and the whole workbook is regenerated.');
  let row = 4;
  row = sectionBar(ws, row, 'Terms', 3);
  row = headerRow(ws, row, ['Term', 'Meaning', '']);
  const a = r.assumptions;
  const defs: [string, string][] = [
    ['Identity', 'Phone normalised to the last 10 digits (+91 / 0 / ="+91…" all collapse to the same key), email as fallback, name last resort.'],
    ['Counting mode', a.dedup_mode === 'unique_member' ? 'Per unique member — a person who registered for five webinars counts once.' : 'Per raw row — a person counts once per session they registered for.'],
    ['Dialled', 'The person’s number appears in the call log at least once, in any status.'],
    ['Connected', `A call row with a status in: ${a.connected_statuses.join(', ')}.`],
    ['Engaged', `At least ${a.engaged_min_turns} talk turns on a connected call.`],
    ['Showed up', 'Present in the attendance data at all — no minimum watch time.'],
    ['Came back', 'Clicked the Zoom-leave reminder link (or, with no click export, joined the session a second time).'],
    ['Sale attribution', `The order must land after the call and within ${a.attribution_days} day(s) of it${a.attribution_requires_call ? '' : '; buyers we never dialled are anchored on the session start instead'}.`],
    ['₹0 orders', 'Every ₹0 order counts as a real sale, valued at the product list price (or the flat default / notional value if no price is set) — not ₹0.'],
    ['Denominator', `Locked at ${r.scorecard.denominator.toLocaleString()} — every sheet divides by this same number.`],
    ['Timezone', 'All timestamps are read as IST and rendered as IST.'],
    ['Buyer counts', 'A FLOOR. A purchase made under a different phone or email than the one in the lead file cannot be attributed.'],
  ];
  for (const [t, m] of defs) {
    ws.mergeCells(row, 2, row, 3);
    const k = ws.getCell(row, 1);
    k.value = t;
    k.font = { bold: true };
    k.fill = fill(SUB);
    k.border = border;
    k.alignment = { vertical: 'middle' };
    const v = ws.getCell(row, 2);
    v.value = m;
    v.alignment = { wrapText: true, vertical: 'middle' };
    v.border = border;
    ws.getRow(row).height = 30;
    row++;
  }
  row++;

  row = sectionBar(ws, row, 'Lens reference', 3);
  row = headerRow(ws, row, ['Lens', 'Comparison', 'Credibility']);
  (Object.keys(LENS_META) as (keyof typeof LENS_META)[]).forEach((id) => {
    const meta = LENS_META[id];
    row = dataRow(ws, row, [id, meta.label, meta.credibility === 'causal' ? 'CAUSALLY CREDIBLE' : 'DIRECTIONAL ONLY'], {
      fillArgb: meta.credibility === 'causal' ? GREEN : AMBER,
    });
  });
  widths(ws, [24, 74, 24]);
}
