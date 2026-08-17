import type { AllTimeMetrics, DailyData } from './types';
import { filterByDateRange, computeAllTimeMetrics } from './metrics';
import type { WeekGroup } from './metrics';

// Dashboard colors (exact match)
const C = {
  navy: "#1e3a5f",
  green: "#16a34a",
  greenLight: "#dcfce7",
  greenBg: "#f0fdf4",
  greenBorder: "#bbf7d0",
  amber: "#d97706",
  amberLight: "#fef3c7",
  amberBg: "#fff7ed",
  amberBorder: "#fed7aa",
  slate: "#64748b",
  slateLight: "#94a3b8",
  border: "#e5e9f0",
  bg: "#f5f7fa",
  text: "#1a2332",
};

interface ChannelDailyData {
  name: string;
  icon: string;
  inboxId: number;
  dailyData: DailyData[];
}

// ── Section label (matches SectionLabel from page.tsx) ──────────────────────
function secLabel(text: string): string {
  return `<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:${C.slateLight};margin:44px 0 18px">${text}</div>`;
}

// ── ReportHero (matches ReportHero.tsx exactly) ───────────────────────────────
function reportHeroHtml(
  clientName: string,
  subtitle: string,
  startDate: string,
  endDate: string,
  total: number,
  botRate: number
): string {
  return `
  <div style="background:${C.navy};border-radius:14px;padding:36px 40px;margin-top:24px;color:#fff">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:20px">
      <div>
        <h2 style="font-size:22px;font-weight:700;line-height:1.3">${clientName} &mdash; AI Chatbot Performance Report</h2>
        <p style="font-size:13px;opacity:.6;margin-top:6px">${subtitle}</p>
        <div style="display:flex;gap:20px;flex-wrap:wrap;margin-top:18px">
          <div style="font-size:12px;opacity:.55;border-left:2px solid rgba(255,255,255,.25);padding-left:12px">${startDate} &ndash; ${endDate}</div>
          <div style="font-size:12px;opacity:.55;border-left:2px solid rgba(255,255,255,.25);padding-left:12px">${total.toLocaleString()} conversations</div>
        </div>
      </div>
      <div style="background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.2);border-radius:10px;padding:16px 22px;text-align:center;flex-shrink:0">
        <div style="font-size:32px;font-weight:900;color:#34d399;line-height:1">${botRate}%</div>
        <div style="font-size:11px;opacity:.6;margin-top:6px;line-height:1.5">Queries handled<br>by AI instantly</div>
      </div>
    </div>
  </div>`;
}

// ── KpiStrip (matches KpiStrip.tsx exactly) ───────────────────────────────────
function kpiStripHtml(
  total: number,
  botResolved: number,
  botResolvedPct: number,
  hoursSaved: number,
  workingDaysSaved: number,
  bestWeekRate: number,
  bestWeekLabel: string
): string {
  const cards = [
    { value: total.toLocaleString(), label: "Total Conversations", sub: "All inbound queries", border: C.navy, color: C.navy },
    { value: botResolved.toLocaleString(), label: "Answered by AI Alone", sub: `No team member needed &mdash; ${botResolvedPct}%`, border: C.green, color: C.green },
    { value: `${hoursSaved} hrs`, label: "Team Time Saved", sub: `&asymp; ${workingDaysSaved} full working days`, border: C.amber, color: C.amber },
    { value: `${bestWeekRate}%`, label: "Best Week Bot Rate", sub: bestWeekLabel || "&mdash;", border: "#0e7490", color: "#0e7490" },
  ];
  const cells = cards.map(c => `
    <div style="background:#fff;border-radius:12px;padding:22px 24px;border:1px solid ${C.border};border-top:4px solid ${c.border}">
      <div style="font-size:38px;font-weight:900;line-height:1;color:${c.color};font-variant-numeric:tabular-nums">${c.value}</div>
      <div style="font-size:12px;font-weight:600;color:${C.slate};margin-top:10px;text-transform:uppercase;letter-spacing:.4px">${c.label}</div>
      <div style="font-size:12px;color:${C.slateLight};margin-top:4px">${c.sub}</div>
    </div>`).join("");
  return `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:32px">${cells}</div>`;
}

// ── DonutCard (matches DonutCard.tsx exactly) ─────────────────────────────────
function donutCardHtml(bot: number, human: number, total: number, botResolvedPct: number): string {
  if (total === 0) return "";
  const R = 70, circ = 2 * Math.PI * R, gap = 4;
  const slices = [
    { color: C.green, label: "AI Handled", count: bot, pct: bot / total },
    { color: C.amber, label: "Human Involved", count: human, pct: human / total },
  ];
  let trackingOffset = -circ * 0.25;
  const segments = slices.map((s) => {
    const len = circ * s.pct;
    const dashOffset = -trackingOffset;
    trackingOffset += len;
    return {
      color: s.color,
      dashArray: `${Math.max(0, len - gap).toFixed(1)} ${(circ - Math.max(0, len - gap)).toFixed(1)}`,
      dashOffset: dashOffset.toFixed(1),
    };
  });
  const segSvg = segments.map(seg =>
    `<circle cx="90" cy="90" r="${R}" fill="none" stroke="${seg.color}" stroke-width="28" stroke-dasharray="${seg.dashArray}" stroke-dashoffset="${seg.dashOffset}" stroke-linecap="butt"/>`
  ).join("");
  const legend = slices.map((s) => `
    <div>
      <div style="display:flex;align-items:flex-start;gap:12px">
        <div style="width:14px;height:14px;border-radius:4px;background:${s.color};flex-shrink:0;margin-top:3px"></div>
        <div style="flex:1">
          <div style="display:flex;align-items:center;justify-content:space-between">
            <span style="font-size:13px;font-weight:600;color:${C.text}">${s.label}</span>
            <span style="font-size:20px;font-weight:900;color:${s.color};font-variant-numeric:tabular-nums">${Math.round(s.pct * 100)}%</span>
          </div>
          <div style="font-size:12px;color:${C.slate};margin-top:3px">${s.count.toLocaleString()} queries</div>
        </div>
      </div>
    </div>`).join("");

  return `
  <div style="background:#fff;border-radius:14px;padding:28px;border:1px solid ${C.border}">
    <div style="font-size:13px;font-weight:700;color:${C.text};margin-bottom:6px">Out of every query &mdash; how many were handled by AI?</div>
    <div style="font-size:12px;color:${C.slateLight};margin-bottom:24px">Based on ${total.toLocaleString()} conversations</div>
    <div style="display:flex;align-items:center;gap:32px;flex-wrap:wrap">
      <div style="position:relative;width:180px;height:180px;flex-shrink:0">
        <svg width="180" height="180" viewBox="0 0 180 180" xmlns="http://www.w3.org/2000/svg">
          <circle cx="90" cy="90" r="${R}" fill="none" stroke="#f1f5f9" stroke-width="28"/>
          ${segSvg}
        </svg>
        <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);text-align:center">
          <div style="font-size:34px;font-weight:900;color:${C.green};line-height:1;font-variant-numeric:tabular-nums">${botResolvedPct}%</div>
          <div style="font-size:10px;font-weight:700;color:${C.slate};text-transform:uppercase;letter-spacing:.3px;margin-top:3px">AI handled</div>
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:20px;flex:1">${legend}</div>
    </div>
  </div>`;
}

// ── TimeSavedCard (matches TimeSavedCard.tsx exactly) ─────────────────────────
function timeSavedCardHtml(
  hoursSaved: number,
  workingDaysSaved: number,
  botResolved: number,
  avgHandlingTimeMinutes: number,
  totalDays: number
): string {
  const minutesSaved = botResolved * avgHandlingTimeMinutes;
  const dailyAvg = totalDays > 0 ? Math.round(botResolved / totalDays) : 0;
  return `
  <div style="background:#fff;border-radius:14px;padding:28px;border:1px solid ${C.border}">
    <div style="font-size:13px;font-weight:700;color:${C.text};margin-bottom:6px">Time saved &mdash; what AI handled = what team didn&apos;t have to</div>
    <div style="font-size:12px;color:${C.slateLight};margin-bottom:20px">Estimated at ${avgHandlingTimeMinutes} minutes average handling time per query</div>
    <div style="display:flex;flex-direction:column;gap:16px">
      <div style="background:${C.greenBg};border-radius:10px;padding:20px 22px;border:1px solid ${C.greenBorder}">
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;color:${C.green}">Total time saved</div>
        <div style="font-size:44px;font-weight:900;color:${C.green};line-height:1;margin-top:6px;font-variant-numeric:tabular-nums">${hoursSaved} hrs</div>
        <div style="font-size:13px;color:${C.green};margin-top:6px">${botResolved.toLocaleString()} queries &times; ${avgHandlingTimeMinutes} min = ${minutesSaved.toLocaleString()} min &asymp; ${hoursSaved} hours</div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div style="background:#f8fafc;border-radius:10px;padding:16px;border:1px solid ${C.border};text-align:center">
          <div style="font-size:26px;font-weight:900;color:${C.navy};font-variant-numeric:tabular-nums">${workingDaysSaved}</div>
          <div style="font-size:11px;color:${C.slate};margin-top:4px;line-height:1.5">Working days saved<br>(8 hrs/day)</div>
        </div>
        <div style="background:#f8fafc;border-radius:10px;padding:16px;border:1px solid ${C.border};text-align:center">
          <div style="font-size:26px;font-weight:900;color:${C.navy};font-variant-numeric:tabular-nums">${dailyAvg}/day</div>
          <div style="font-size:11px;color:${C.slate};margin-top:4px;line-height:1.5">Avg queries AI<br>handled daily</div>
        </div>
      </div>
    </div>
  </div>`;
}

// ── Channel Breakdown (matches ChannelBreakdown.tsx exactly) ──────────────────
const CH_COLORS = [
  { bg: "#f0fdf4", border: "#bbf7d0", accent: "#15803d", pill: "#dcfce7", pillText: "#166534" },
  { bg: "#eff6ff", border: "#bfdbfe", accent: "#1d4ed8", pill: "#dbeafe", pillText: "#1e40af" },
  { bg: "#fff7ed", border: "#fed7aa", accent: "#c2410c", pill: "#fef3c7", pillText: "#92400e" },
  { bg: "#fdf4ff", border: "#e9d5ff", accent: "#7e22ce", pill: "#f3e8ff", pillText: "#6b21a8" },
];

function channelBreakdownHtml(
  channelDailyData: ChannelDailyData[],
  from: string,
  to: string,
  avgHandlingTimeMinutes: number
): string {
  if (!channelDailyData || channelDailyData.length === 0) return "";
  const channelMetrics = channelDailyData.map((ch) => {
    const filtered = filterByDateRange(ch.dailyData, from, to);
    const m = computeAllTimeMetrics(filtered, avgHandlingTimeMinutes);
    return { ...ch, m };
  });
  const grandTotal = channelMetrics.reduce((s, c) => s + c.m.total, 0);
  const cards = channelMetrics.map((ch, i) => {
    const col = CH_COLORS[i % CH_COLORS.length];
    const share = grandTotal > 0 ? Math.round((ch.m.total / grandTotal) * 100) : 0;
    const barW = grandTotal > 0 ? (ch.m.total / grandTotal) * 100 : 0;
    return `
    <div style="background:${col.bg};border:1px solid ${col.border};border-radius:14px;padding:22px 24px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
        <div style="font-size:15px;font-weight:700;color:${col.accent}">${ch.icon} ${ch.name}</div>
        <span style="background:${col.pill};color:${col.pillText};border-radius:20px;padding:3px 10px;font-size:11px;font-weight:700">${share}% of traffic</span>
      </div>
      <div style="height:6px;background:#e2e8f0;border-radius:3px;overflow:hidden;margin-bottom:16px">
        <div style="height:100%;width:${barW.toFixed(1)}%;background:${col.accent};border-radius:3px"></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div>
          <div style="font-size:22px;font-weight:900;color:${col.accent}">${ch.m.total.toLocaleString()}</div>
          <div style="font-size:11px;color:${C.slate};margin-top:2px">Total conversations</div>
        </div>
        <div>
          <div style="font-size:22px;font-weight:900;color:#15803d">${ch.m.botResolved.toLocaleString()}</div>
          <div style="font-size:11px;color:${C.slate};margin-top:2px">AI resolved</div>
        </div>
        <div>
          <div style="font-size:22px;font-weight:900;color:${C.amber}">${ch.m.escalated.toLocaleString()}</div>
          <div style="font-size:11px;color:${C.slate};margin-top:2px">Escalated to team</div>
        </div>
        <div>
          <div style="font-size:22px;font-weight:900;color:${C.navy}">${ch.m.botResolvedPct}%</div>
          <div style="font-size:11px;color:${C.slate};margin-top:2px">AI resolution rate</div>
        </div>
      </div>
      <div style="margin-top:14px;background:${col.pill};border-radius:8px;padding:10px 14px;font-size:12px;color:${col.pillText};font-weight:600">
        &#9201; ${ch.m.hoursSaved.toLocaleString()} hours saved on this channel
      </div>
    </div>`;
  }).join("");
  const cols = Math.min(channelMetrics.length, 2);
  return `
  ${secLabel("Performance by channel")}
  <div style="display:grid;grid-template-columns:repeat(${cols},1fr);gap:20px;margin-bottom:24px">${cards}</div>`;
}

// ── Weekly Charts: Stacked Bar + Trend Line (matches WeeklyCharts.tsx) ────────
function weeklyChartsHtml(weekGroups: WeekGroup[]): string {
  if (weekGroups.length < 2) return "";
  const maxTotal = Math.max(...weekGroups.map((w) => w.total), 1);
  const H = 180; // bar chart height px

  // Stacked bar columns
  const barCols = weekGroups.map((w) => {
    const colH = (w.total / maxTotal) * (H - 40);
    const botH = w.total > 0 ? (w.bot / w.total) * colH : 0;
    const humanH = colH - botH;
    const shortLabel = (() => {
      const parts = w.label.split(" – ");
      if (parts.length !== 2) return w.label;
      const [s, e] = parts;
      const sp = s.split(" "), ep = e.split(" ");
      return sp[0] === ep[0] ? `${s}&ndash;${ep[1]}` : `${sp[1]} ${sp[0]}<br>&ndash;${ep[1]} ${ep[0]}`;
    })();
    return `
    <div style="flex:1;display:flex;flex-direction:column;align-items:center;min-width:0;gap:0">
      <div style="font-size:10px;font-weight:800;color:#334155;margin-bottom:3px">${w.total}</div>
      <div style="width:100%;display:flex;flex-direction:column;justify-content:flex-end;height:${H - 40}px">
        <div style="height:${humanH.toFixed(1)}px;background:${C.amber};border-radius:4px 4px 0 0;${w.human > 0 ? "min-height:2px" : ""}"></div>
        <div style="height:${botH.toFixed(1)}px;background:${C.green};${w.bot > 0 ? "min-height:2px" : ""}"></div>
      </div>
      <div style="font-size:8px;color:${C.slateLight};text-align:center;margin-top:5px;line-height:1.3">${shortLabel}</div>
    </div>`;
  }).join("");

  // SVG trend line
  const svgW = 460, svgH = H;
  const pad = { top: 16, right: 80, bottom: 38, left: 36 };
  const chartW = svgW - pad.left - pad.right;
  const chartH = svgH - pad.top - pad.bottom;
  const n = weekGroups.length;
  const xStep = n > 1 ? chartW / (n - 1) : chartW;
  const yOf = (r: number) => pad.top + chartH - (r / 100) * chartH;

  const pts = weekGroups.map((w, i) => ({
    x: pad.left + i * xStep, y: yOf(w.botRate), rate: w.botRate,
    label: (() => {
      const parts = w.label.split(" – ");
      if (parts.length !== 2) return w.label;
      const [s, e] = parts;
      const sp = s.split(" "), ep = e.split(" ");
      return sp[0] === ep[0] ? `${s}–${ep[1]}` : `${sp[1]} ${sp[0]}`;
    })(),
  }));

  const linePoints = pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const targetY1 = yOf(100), targetY2 = yOf(75);
  const step = Math.ceil(n / 6);

  const gridLines = [0, 25, 50, 75, 100].map((v) => {
    const y = yOf(v);
    return `<line x1="${pad.left}" y1="${y.toFixed(1)}" x2="${(pad.left + chartW).toFixed(1)}" y2="${y.toFixed(1)}" stroke="#f1f5f9" stroke-width="1"/>
    <text x="${(pad.left - 5).toFixed(0)}" y="${(y + 4).toFixed(0)}" text-anchor="end" font-size="9" fill="${C.slateLight}">${v}%</text>`;
  }).join("");

  const xLabels = pts.filter((_, i) => i % step === 0 || i === n - 1).map((p) =>
    `<text x="${p.x.toFixed(1)}" y="${(pad.top + chartH + 16).toFixed(0)}" text-anchor="middle" font-size="8" fill="${C.slateLight}">${p.label}</text>`
  ).join("");

  const dots = pts.map((p) =>
    `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="5" fill="${C.green}" stroke="#fff" stroke-width="2"/>`
  ).join("");

  return `
  ${secLabel("Week-by-week &mdash; volume and AI performance")}
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:24px">
    <!-- Stacked bar -->
    <div style="background:#fff;border-radius:14px;padding:28px;border:1px solid ${C.border}">
      <div style="font-size:13px;font-weight:700;color:${C.text};margin-bottom:6px">Number of queries per week &mdash; split by outcome</div>
      <div style="font-size:12px;color:${C.slateLight};margin-bottom:16px">Taller green = more queries resolved by AI that week</div>
      <div style="display:flex;gap:20px;margin-bottom:14px">
        <div style="display:flex;align-items:center;gap:7px;font-size:12px;color:${C.slate};font-weight:600">
          <div style="width:12px;height:12px;border-radius:3px;background:${C.green}"></div>AI Handled
        </div>
        <div style="display:flex;align-items:center;gap:7px;font-size:12px;color:${C.slate};font-weight:600">
          <div style="width:12px;height:12px;border-radius:3px;background:${C.amber}"></div>Human Involved
        </div>
      </div>
      <div style="display:flex;align-items:flex-end;gap:3px;height:${H}px">${barCols}</div>
    </div>
    <!-- Trend line -->
    <div style="background:#fff;border-radius:14px;padding:28px;border:1px solid ${C.border}">
      <div style="font-size:13px;font-weight:700;color:${C.text};margin-bottom:6px">AI success rate &mdash; week by week trend</div>
      <div style="font-size:12px;color:${C.slateLight};margin-bottom:8px">% of queries fully answered by AI with no human involvement</div>
      <svg width="100%" viewBox="0 0 ${svgW} ${svgH}" xmlns="http://www.w3.org/2000/svg">
        ${gridLines}
        <rect x="${pad.left}" y="${targetY1.toFixed(1)}" width="${chartW}" height="${(targetY2 - targetY1).toFixed(1)}" fill="rgba(240,253,244,0.7)"/>
        <line x1="${pad.left}" y1="${targetY2.toFixed(1)}" x2="${(pad.left + chartW).toFixed(1)}" y2="${targetY2.toFixed(1)}" stroke="${C.green}" stroke-dasharray="4 3" stroke-width="1.5"/>
        <text x="${(pad.left + 4).toFixed(0)}" y="${(targetY2 - 4).toFixed(0)}" font-size="9" fill="${C.green}" font-weight="700">Target 75%</text>
        <polyline points="${linePoints}" fill="none" stroke="${C.green}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
        ${dots}
        ${xLabels}
      </svg>
      <div style="font-size:11px;color:${C.slateLight};margin-top:4px">Target zone: above 75% means AI is handling most queries independently</div>
    </div>
  </div>`;
}

// ── ImpactBoxes (matches ImpactBoxes.tsx exactly) ─────────────────────────────
function impactBoxesHtml(
  botResolved: number,
  botRateTrend: { from: number; to: number; fromMonth: string; toMonth: string }
): string {
  const boxes = [
    {
      icon: "&#9201;",
      title: "Team focused on real problems",
      body: `With AI handling ${botResolved.toLocaleString()} repetitive queries automatically, the team only gets involved for complex issues &mdash; payment problems, escalations, and cases requiring human judgment. No more answering the same questions repeatedly.`,
      stat: `${botResolved.toLocaleString()} queries handled without team`,
    },
    {
      icon: "&#9889;",
      title: "Customers get instant answers",
      body: "AI replies in seconds &mdash; 24 hours a day, 7 days a week. Customers don&apos;t wait for a reply. This improves customer experience significantly, especially for queries outside business hours.",
      stat: "Instant reply vs hours of wait",
    },
    {
      icon: "&#128200;",
      title: "AI keeps getting smarter",
      body: `The AI bot rate went from ${botRateTrend.from}% in ${botRateTrend.fromMonth} to ${botRateTrend.to}% in ${botRateTrend.toMonth} &mdash; improving as the knowledge base grows. Each escalation that gets resolved becomes a learning opportunity.`,
      stat: `${botRateTrend.from}% &rarr; ${botRateTrend.to}% improvement`,
    },
  ];
  const cells = boxes.map((b) => `
    <div style="background:#fff;border-radius:12px;padding:24px;border:1px solid ${C.border};border-left:4px solid ${C.navy};display:flex;flex-direction:column">
      <h3 style="font-size:14px;font-weight:700;margin-bottom:10px;color:${C.text}">${b.icon} ${b.title}</h3>
      <p style="font-size:13px;color:${C.slate};line-height:1.7;flex:1">${b.body}</p>
      <div style="font-size:18px;font-weight:800;color:${C.green};margin-top:16px">${b.stat}</div>
    </div>`).join("");
  return `<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:20px;margin-bottom:24px">${cells}</div>`;
}

// ── AiVsTeam (matches AiVsTeam.tsx exactly) ───────────────────────────────────
function aiVsTeamHtml(botResolved: number, human: number, humanResolved: number, open: number): string {
  const aiItems = [
    "Batch dates, schedule &amp; how to join",
    "Course levels, membership &amp; what&apos;s included",
    "Fees, pricing &amp; payment links",
    "App access, portal login &amp; lesson links",
    "General FAQ &mdash; trial class, eligibility, etc.",
  ];
  const aiRows = aiItems.map((item) => `
    <div style="display:flex;justify-content:space-between;align-items:center;font-size:12.5px">
      <span style="color:#374151">${item}</span>
      <span style="font-weight:700;color:#15803d;background:#dcfce7;padding:2px 10px;border-radius:20px;font-size:11px;flex-shrink:0;margin-left:8px">Instant &#10003;</span>
    </div>`).join("");
  return `
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:24px;align-items:start">
    <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:14px;padding:24px 26px">
      <div style="font-size:13px;font-weight:700;color:#15803d;margin-bottom:16px">&#10003; What AI handles on its own &mdash; ${botResolved.toLocaleString()} queries</div>
      <div style="display:flex;flex-direction:column;gap:10px">${aiRows}</div>
      <div style="margin-top:16px;font-size:11.5px;color:#166534;background:#dcfce7;padding:10px 14px;border-radius:8px;line-height:1.6">
        These queries were answered in seconds, 24&times;7 &mdash; with zero team involvement.
      </div>
    </div>
    <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:14px;padding:24px 26px">
      <div style="font-size:13px;font-weight:700;color:#c2410c;margin-bottom:16px">&#128101; When team stepped in &mdash; ${human.toLocaleString()} queries</div>
      <div style="display:flex;flex-direction:column;gap:10px">
        <div style="font-size:12.5px;color:#374151;background:#fff;border-radius:8px;padding:12px 14px;border:1px solid #fed7aa">
          <strong style="color:#c2410c">&#128179; Refund &amp; billing disputes</strong><br>
          <span style="color:#6b7280;font-size:11.5px;line-height:1.6">Payment reversal requests need human authorization. AI identifies and routes these to the team &mdash; by design.</span>
        </div>
        <div style="font-size:12.5px;color:#374151;background:#fff;border-radius:8px;padding:12px 14px;border:1px solid #fed7aa">
          <strong style="color:#c2410c">&#127891; Complex or sensitive queries</strong><br>
          <span style="color:#6b7280;font-size:11.5px;line-height:1.6">Queries requiring personal judgment, account-level access, or sensitive decisions that need a human touch.</span>
        </div>
        <div style="font-size:12.5px;color:#374151;background:#fff;border-radius:8px;padding:12px 14px;border:1px solid #fed7aa">
          <strong style="color:#c2410c">&#128230; Fulfilled by team &mdash; ${humanResolved.toLocaleString()} resolved &middot; ${open} still open</strong><br>
          <span style="color:#6b7280;font-size:11.5px;line-height:1.6">Every escalation was intentional &mdash; AI knew when it couldn&apos;t help and handed off correctly.</span>
        </div>
      </div>
      <div style="margin-top:16px;font-size:11.5px;color:#92400e;background:#fef3c7;padding:10px 14px;border-radius:8px;line-height:1.6">
        Every escalation was intentional &mdash; AI knew when it couldn&apos;t help and handed off correctly.
      </div>
    </div>
  </div>`;
}

// ── WeeklyPerfTable (matches WeeklyPerfTable.tsx exactly) ─────────────────────
function weeklyPerfTableHtml(weekGroups: WeekGroup[], avgHandlingTimeMinutes: number): string {
  if (!weekGroups.length) return "";
  const maxRate = Math.max(...weekGroups.map((w) => w.botRate));
  const totTotal = weekGroups.reduce((s, w) => s + w.total, 0);
  const totBot = weekGroups.reduce((s, w) => s + w.bot, 0);
  const totHuman = weekGroups.reduce((s, w) => s + w.human, 0);
  const totRate = totTotal > 0 ? Math.round((totBot / totTotal) * 1000) / 10 : 0;
  const totHrs = ((totBot * avgHandlingTimeMinutes) / 60).toFixed(1);

  const headers = ["Week", "Total Queries", "&#129302; AI Handled", "&#128101; Human", "AI Rate", "vs Prev Week", "Team Hrs Saved"];
  const headerHtml = headers.map((h) =>
    `<th style="color:rgba(255,255,255,.78);font-size:10px;text-transform:uppercase;letter-spacing:.5px;padding:13px 16px;text-align:${h === "Week" ? "left" : "right"};font-weight:600;white-space:nowrap">${h}</th>`
  ).join("");

  const rows = weekGroups.map((w, i) => {
    const isBest = w.botRate === maxRate && maxRate > 0 && w.total > 0;
    const prev = i > 0 ? weekGroups[i - 1].botRate : null;
    const delta = prev !== null ? w.botRate - prev : null;
    const hrs = ((w.bot * avgHandlingTimeMinutes) / 60).toFixed(1);
    const rateColor = w.botRate >= 75 ? "#15803d" : w.botRate >= 50 ? C.amber : w.botRate > 0 ? "#dc2626" : C.slateLight;
    const deltaColor = delta === null ? C.slateLight : delta > 0 ? "#15803d" : delta < 0 ? "#dc2626" : C.slateLight;
    const deltaStr = delta === null ? "&mdash;" : delta > 0 ? `+${delta.toFixed(1)}%` : delta < 0 ? `${delta.toFixed(1)}%` : "&mdash;";
    return `
    <tr style="border-bottom:1px solid #f1f5f9;${isBest ? "background:#f0fdf4;" : ""}">
      <td style="padding:12px 16px;font-weight:600;color:${C.navy}">
        ${w.label}${isBest ? `<span style="font-size:10px;font-weight:700;color:#15803d;background:#dcfce7;padding:1px 7px;border-radius:10px;margin-left:6px">&#9733; Best</span>` : ""}
      </td>
      <td style="padding:12px 16px;text-align:right;font-weight:600">${w.total.toLocaleString()}</td>
      <td style="padding:12px 16px;text-align:right">
        <span style="font-weight:700;color:#15803d">${w.bot.toLocaleString()}</span>
        ${w.total > 0 ? `<span style="font-size:10px;color:${C.slateLight};margin-left:3px">(${Math.round((w.bot / w.total) * 100)}%)</span>` : ""}
      </td>
      <td style="padding:12px 16px;text-align:right">
        <span style="font-weight:600;color:#475569">${w.human.toLocaleString()}</span>
        ${w.total > 0 ? `<span style="font-size:10px;color:${C.slateLight};margin-left:3px">(${Math.round((w.human / w.total) * 100)}%)</span>` : ""}
      </td>
      <td style="padding:12px 16px;text-align:right"><strong style="color:${rateColor};font-size:14px">${w.botRate}%</strong></td>
      <td style="padding:12px 16px;text-align:right;font-weight:700;color:${deltaColor}">${deltaStr}</td>
      <td style="padding:12px 16px;text-align:right">
        <strong style="color:${C.navy}">${hrs} hrs</strong>
        <div style="font-size:10px;color:${C.slateLight}">${w.bot} &times; ${avgHandlingTimeMinutes} min</div>
      </td>
    </tr>`;
  }).join("");

  return `
  <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:14px 18px;margin-bottom:12px;font-size:12px;color:#475569;line-height:1.7">
    <strong style="color:${C.navy}">How performance is measured:</strong> Each week the AI handled a subset of queries autonomously. Human team hours are saved for every query the bot resolved. The vs-prev column shows week-on-week change in AI success rate.
  </div>
  <div style="background:#fff;border-radius:12px;border:1px solid ${C.border};overflow:hidden">
    <table style="width:100%;border-collapse:collapse;font-size:13px;font-variant-numeric:tabular-nums">
      <thead style="background:${C.navy}"><tr>${headerHtml}</tr></thead>
      <tbody>
        ${rows}
        <tr style="background:#f0fdf4;border-top:2px solid ${C.border}">
          <td style="padding:12px 16px;font-weight:800;color:${C.navy}">Total</td>
          <td style="padding:12px 16px;text-align:right;font-weight:800">${totTotal.toLocaleString()}</td>
          <td style="padding:12px 16px;text-align:right;color:#15803d;font-weight:800">${totBot.toLocaleString()} (${Math.round((totBot / totTotal) * 100)}%)</td>
          <td style="padding:12px 16px;text-align:right;font-weight:700">${totHuman.toLocaleString()} (${Math.round((totHuman / totTotal) * 100)}%)</td>
          <td style="padding:12px 16px;text-align:right"><strong style="color:#15803d;font-size:14px">${totRate}%</strong></td>
          <td style="padding:12px 16px;text-align:right;color:${C.slateLight}">&mdash;</td>
          <td style="padding:12px 16px;text-align:right"><strong style="color:${C.navy};font-size:14px">${totHrs} hrs</strong></td>
        </tr>
      </tbody>
    </table>
  </div>
  <div style="font-size:11px;color:${C.slateLight};margin-top:8px">* Team hours saved = AI-answered queries &times; ${avgHandlingTimeMinutes} min avg per query, converted to hours.</div>`;
}

// ── HoursSavedBand (matches HoursSavedBand.tsx exactly) ───────────────────────
function hoursSavedBandHtml(
  hoursSaved: number,
  botResolved: number,
  avgHandlingTimeMinutes: number,
  workingDaysSaved: number
): string {
  return `
  <div style="background:linear-gradient(135deg,#1e3a5f 0%,#164e3b 100%);border-radius:14px;padding:28px 36px;display:flex;align-items:center;gap:36px;margin-bottom:24px;flex-wrap:wrap">
    <div style="flex-shrink:0">
      <div style="font-size:56px;font-weight:800;color:#fff;line-height:1;font-variant-numeric:tabular-nums">${hoursSaved}</div>
      <div style="font-size:18px;font-weight:600;color:rgba(255,255,255,.7);margin-top:4px">hours saved</div>
    </div>
    <div style="color:rgba(255,255,255,.82);font-size:13.5px;line-height:1.8">
      <strong style="color:#fff">${botResolved.toLocaleString()} conversations were handled completely by the AI</strong> &mdash; no human agent needed.<br>
      At an average of ${avgHandlingTimeMinutes} minutes per conversation, that&apos;s <strong style="color:#fff">${hoursSaved}+ hours</strong> of agent time saved.<br>
      That&apos;s the equivalent of <strong style="color:#fff">~${workingDaysSaved} working days</strong> of a support agent.
    </div>
  </div>`;
}

// ── Activity Heatmap (matches ActivityHeatmap component) ──────────────────────
function heatmapHtml(heatmap: number[][]): string {
  if (!heatmap || heatmap.length === 0) return "";
  const HOURS = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21];
  const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const maxVal = Math.max(
    ...DAYS.map((_, dow) => Math.max(...HOURS.map((h) => heatmap[dow]?.[h] ?? 0))),
    1
  );
  const headerCells = HOURS.map(
    (h) => `<th style="font-size:9px;color:${C.slateLight};font-weight:600;text-align:center;padding:0 2px 6px;min-width:30px">${h}:00</th>`
  ).join("");
  const bodyRows = DAYS.map((day, dow) => {
    const cells = HOURS.map((h) => {
      const val = heatmap[dow]?.[h] ?? 0;
      const intensity = val / maxVal;
      const bg = intensity > 0 ? `rgba(30,58,95,${(0.1 + intensity * 0.85).toFixed(2)})` : "#f8fafc";
      const textColor = intensity > 0.45 ? "#fff" : intensity > 0 ? C.navy : "#e2e8f0";
      return `<td style="width:30px;height:26px;background:${bg};border-radius:4px;text-align:center;font-size:9px;font-weight:600;color:${textColor}">${val > 0 ? val : ""}</td>`;
    }).join("");
    return `<tr><td style="font-size:10px;font-weight:700;color:${C.slate};padding:3px 10px 3px 0;white-space:nowrap">${day}</td>${cells}</tr>`;
  }).join("");
  const scaleDots = [0.1, 0.3, 0.5, 0.7, 0.9]
    .map((a) => `<span style="width:18px;height:14px;background:rgba(30,58,95,${a});border-radius:2px;display:inline-block"></span>`)
    .join("");
  return `
  <div style="background:#fff;border-radius:14px;border:1px solid ${C.border};box-shadow:0 2px 8px rgba(30,58,95,0.07);padding:28px;margin-bottom:24px;overflow-x:auto">
    <div style="font-size:13px;font-weight:700;color:${C.text};margin-bottom:6px">When your customers reach out</div>
    <div style="font-size:12px;color:${C.slateLight};margin-bottom:18px">IST hours, Mon&ndash;Sun</div>
    <table style="border-collapse:separate;border-spacing:4px">
      <thead><tr><th></th>${headerCells}</tr></thead>
      <tbody>${bodyRows}</tbody>
    </table>
    <div style="display:flex;align-items:center;gap:6px;margin-top:14px;font-size:10px;color:${C.slateLight}">
      <span>Less</span>${scaleDots}<span>More</span>
    </div>
  </div>`;
}

// ── Main export ───────────────────────────────────────────────────────────────
export function generateHTMLReport(
  clientName: string,
  subtitle: string,
  at: AllTimeMetrics,
  weekGroups: WeekGroup[],
  rangeLabel: string,
  channelDailyData: ChannelDailyData[],
  heatmap: number[][],
  from: string,
  to: string,
  avgHandlingTimeMinutes: number
): string {
  const now = new Date().toLocaleDateString("en-US", {
    month: "long", day: "numeric", year: "numeric",
  });

  const fromDate = new Date(from + "T00:00:00Z");
  const toDate = new Date(to + "T00:00:00Z");
  const totalDays = Math.max(1, Math.round((toDate.getTime() - fromDate.getTime()) / 86400000) + 1);

  const bestWeek = weekGroups.length > 0
    ? weekGroups.reduce((best, w) => (w.botRate > best.botRate ? w : best), weekGroups[0])
    : null;

  const hasChannels = channelDailyData && channelDailyData.length > 0;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <title>${clientName} &mdash; AI Performance Report</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', system-ui, sans-serif; background: #f5f7fa; color: #1a2332; }
    .page { max-width: 1200px; margin: 0 auto; padding: 0 32px 80px; }
    @media print { body { background: white; } .page { padding: 0 16px 40px; } }
  </style>
</head>
<body>

<!-- HEADER -->
<div style="background:linear-gradient(135deg,#1e3a5f 0%,#0f2540 100%);padding:20px 32px">
  <div style="max-width:1200px;margin:0 auto;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px">
    <div style="display:flex;align-items:center;gap:16px">
      <div style="font-size:15px;font-weight:800;color:#fff">${clientName} Dashboard</div>
      <div style="font-size:12px;color:rgba(255,255,255,.5)">${subtitle}</div>
    </div>
    <div style="font-size:11px;color:rgba(255,255,255,.5)">Generated ${now} &middot; desk.freedomwithai.com</div>
  </div>
</div>

<div class="page">

  ${reportHeroHtml(clientName, subtitle, at.startDate, at.endDate, at.total, at.botResolvedPct)}

  ${secLabel(`Key numbers &mdash; ${rangeLabel}`)}
  ${kpiStripHtml(at.total, at.botResolved, at.botResolvedPct, at.hoursSaved, at.workingDaysSaved, bestWeek?.botRate ?? 0, bestWeek?.label ?? "")}

  ${secLabel("How every customer query was handled")}
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:24px">
    ${donutCardHtml(at.botResolved, at.escalated, at.total, at.botResolvedPct)}
    ${timeSavedCardHtml(at.hoursSaved, at.workingDaysSaved, at.botResolved, at.avgHandlingTimeMinutes, totalDays)}
  </div>

  ${hasChannels ? channelBreakdownHtml(channelDailyData, from, to, avgHandlingTimeMinutes) : ""}

  ${weekGroups.length >= 2 ? weeklyChartsHtml(weekGroups) : ""}

  ${secLabel("What this means for the business")}
  ${impactBoxesHtml(at.botResolved, at.botRateTrend)}

  ${secLabel("How AI and your team work together")}
  ${aiVsTeamHtml(at.botResolved, at.escalated, at.humanResolved, at.open)}

  ${weekGroups.length > 0 ? `
  ${secLabel("Week-by-week: AI vs Team effort &mdash; and how performance grew")}
  ${weeklyPerfTableHtml(weekGroups, avgHandlingTimeMinutes)}` : ""}

  ${secLabel("Time saved for your team")}
  ${hoursSavedBandHtml(at.hoursSaved, at.botResolved, at.avgHandlingTimeMinutes, at.workingDaysSaved)}

  ${heatmap.length > 0 ? `
  ${secLabel("When your customers reach out")}
  ${heatmapHtml(heatmap)}` : ""}

  <!-- FOOTER -->
  <div style="text-align:center;font-size:11px;color:${C.slateLight};padding:20px 24px 40px;border-top:1px solid #e5e9f0;margin-top:20px">
    ${clientName} Chatbot Performance Report &middot; desk.freedomwithai.com &middot; Auto-refreshes every 60s &middot; Prepared by FWAI
  </div>

</div>
</body>
</html>`;
}

export function downloadReport(html: string, clientName: string, rangeLabel: string) {
  void rangeLabel;
  const slug = clientName.toLowerCase().replace(/\s+/g, "-");
  const date = new Date().toISOString().split("T")[0];
  const filename = `${slug}-report-${date}.html`;
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
