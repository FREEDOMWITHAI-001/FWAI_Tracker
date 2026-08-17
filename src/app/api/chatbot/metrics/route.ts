import { NextRequest, NextResponse } from 'next/server';
import {
  fetchDailyConversationCounts,
  fetchEscalatedConversations,
  fetchHourlyConversationCounts,
  fetchTesterConversations,
  type CWConversation,
} from '@/lib/chatbot/chatwoot';
import type { DailyData } from '@/lib/chatbot/types';
import clientsConfig from '@/config/clients.json';
import baseline from '@/data/baseline.json';
import testExclusions from '@/data/test-exclusions.json';
import excludedContactsConfig from '@/data/excluded-contacts.json';

// Fire-and-forget helper (replaces @vercel/functions waitUntil for non-Vercel deployments)
function waitUntil(p: Promise<unknown>) {
  p.catch(() => {});
}

const LIVE_WINDOW_DAYS = 30;

interface DailyCacheEntry {
  reports: { timestamp: number; value: number }[];
  fetchedAt: number;
}
const dailyCache = new Map<string, DailyCacheEntry>();

function dailyKey(accountId: number, inboxId: number): string {
  return `${accountId}:${inboxId}`;
}

async function fetchDailyWithCache(
  accountId: number,
  inboxId: number
): Promise<{ timestamp: number; value: number }[]> {
  const key = dailyKey(accountId, inboxId);
  try {
    const fresh = await fetchDailyConversationCounts(accountId, inboxId);
    if (fresh.length > 0) {
      dailyCache.set(key, { reports: fresh, fetchedAt: Date.now() });
      return fresh;
    }
  } catch {
    // fall through
  }
  const cached = dailyCache.get(key);
  if (cached) return cached.reports;
  return [];
}

interface EscCacheEntry {
  byDate: Map<string, { human: number; humanResolved: number }>;
  fetchedAt: number;
}
const escCache = new Map<string, EscCacheEntry | 'loading'>();
const ESC_TTL_MS = 30 * 60 * 1000;

function escKey(accountId: number, inboxId: number, labels: string[]): string {
  return `${accountId}:${inboxId}:${[...labels].sort().join(',')}`;
}

interface TesterCacheEntry {
  byDate: Map<string, number>;
  fetchedAt: number;
}
const testerCache = new Map<string, TesterCacheEntry | 'loading'>();
const TESTER_TTL_MS = 60 * 60 * 1000;
const HISTORICAL_SINCE = 1735689600;

function testerKey(accountId: number, inboxId: number): string {
  return `${accountId}:${inboxId}`;
}

function getExcludedContactIds(accountId: number): number[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (excludedContactsConfig as any).accounts?.[String(accountId)] ?? [];
}

function getTesterConvsByDate(
  accountId: number,
  inboxId: number,
  contactIds: number[]
): Map<string, number> {
  if (!contactIds.length) return new Map();
  const key = testerKey(accountId, inboxId);
  const cached = testerCache.get(key);

  if (cached && cached !== 'loading' && Date.now() - cached.fetchedAt < TESTER_TTL_MS) {
    return cached.byDate;
  }
  if (cached === 'loading') return new Map();

  const IST_OFFSET_S = 19800;
  testerCache.set(key, 'loading');
  waitUntil((async () => {
    try {
      const convs = await fetchTesterConversations(accountId, contactIds, inboxId, HISTORICAL_SINCE);
      const byDate = new Map<string, number>();
      for (const conv of convs) {
        const date = toDateStr(conv.created_at + IST_OFFSET_S);
        byDate.set(date, (byDate.get(date) ?? 0) + 1);
      }
      testerCache.set(key, { byDate, fetchedAt: Date.now() });
    } catch {
      testerCache.delete(key);
    }
  })());

  return new Map();
}

function subtractTesterFromDaily(
  dailyReports: { timestamp: number; value: number }[],
  testerByDate: Map<string, number>
): { timestamp: number; value: number }[] {
  if (!testerByDate.size) return dailyReports;
  return dailyReports.map((row) => {
    const date = toDateStr(row.timestamp);
    const offset = testerByDate.get(date) ?? 0;
    return offset > 0 ? { ...row, value: Math.max(0, row.value - offset) } : row;
  });
}

function subtractTesterFromISTDaily(
  istDaily: Map<string, number>,
  testerByDate: Map<string, number>
): Map<string, number> {
  if (!testerByDate.size) return istDaily;
  const result = new Map(istDaily);
  for (const [date, count] of Array.from(testerByDate.entries())) {
    const existing = result.get(date);
    if (existing === undefined) continue;
    const adjusted = Math.max(0, existing - count);
    if (adjusted > 0) result.set(date, adjusted);
    else result.delete(date);
  }
  return result;
}

function getTestByDate(
  accountId: number,
  inboxId: number
): Record<string, { total: number; escalated: number }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const accounts = (testExclusions as any).accounts ?? {};
  return (accounts[String(accountId)] ?? {})[String(inboxId)] ?? {};
}

function subtractTestFromDaily(
  dailyReports: { timestamp: number; value: number }[],
  testByDate: Record<string, { total: number; escalated: number }>
): { timestamp: number; value: number }[] {
  if (Object.keys(testByDate).length === 0) return dailyReports;
  return dailyReports.map((row) => {
    const date = toDateStr(row.timestamp);
    const offset = testByDate[date]?.total ?? 0;
    return offset > 0 ? { ...row, value: Math.max(0, row.value - offset) } : row;
  });
}

function subtractTestFromEscMap(
  escMap: Map<string, { human: number; humanResolved: number }>,
  testByDate: Record<string, { total: number; escalated: number }>
): Map<string, { human: number; humanResolved: number }> {
  if (Object.keys(testByDate).length === 0) return escMap;
  const result = new Map(escMap);
  for (const [date, testCounts] of Object.entries(testByDate)) {
    if (!testCounts.escalated) continue;
    const existing = result.get(date);
    if (!existing) continue;
    result.set(date, {
      human: Math.max(0, existing.human - testCounts.escalated),
      humanResolved: existing.humanResolved,
    });
  }
  return result;
}

function subtractTestFromBaseline(
  baselineMap: Record<string, { human: number; humanResolved: number }>,
  testByDate: Record<string, { total: number; escalated: number }>
): Record<string, { human: number; humanResolved: number }> {
  if (Object.keys(testByDate).length === 0) return baselineMap;
  const result: Record<string, { human: number; humanResolved: number }> = { ...baselineMap };
  for (const [date, testCounts] of Object.entries(testByDate)) {
    if (!testCounts.escalated) continue;
    const existing = result[date];
    if (existing) {
      result[date] = {
        human: Math.max(0, existing.human - testCounts.escalated),
        humanResolved: existing.humanResolved,
      };
    }
  }
  return result;
}

function buildByDate(convs: CWConversation[], liveSince: number): Map<string, { human: number; humanResolved: number }> {
  const byDate = new Map<string, { human: number; humanResolved: number }>();
  for (const conv of convs) {
    if (conv.created_at < liveSince) continue;
    const date = toDateStr(conv.created_at);
    if (!byDate.has(date)) byDate.set(date, { human: 0, humanResolved: 0 });
    const e = byDate.get(date)!;
    e.human++;
    if (conv.status === 'resolved') e.humanResolved++;
  }
  return byDate;
}

function getEscalation(
  accountId: number,
  inboxId: number,
  labels: string[],
  botAgentId?: number,
  excludedContactIds?: number[]
): Map<string, { human: number; humanResolved: number }> {
  const key = escKey(accountId, inboxId, labels);
  const cached = escCache.get(key);

  if (cached && cached !== 'loading' && Date.now() - cached.fetchedAt < ESC_TTL_MS) {
    return cached.byDate;
  }
  if (cached === 'loading') return new Map();

  const liveSince = Math.floor(Date.now() / 1000) - LIVE_WINDOW_DAYS * 86400;
  escCache.set(key, 'loading');
  waitUntil((async () => {
    try {
      const convs = await fetchEscalatedConversations(accountId, inboxId, labels, liveSince, botAgentId, excludedContactIds);
      escCache.set(key, { byDate: buildByDate(convs, liveSince), fetchedAt: Date.now() });
    } catch {
      escCache.delete(key);
    }
  })());

  return new Map();
}

function getTodayIST(): string {
  return new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().split('T')[0];
}

function addDaysStr(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().split('T')[0];
}

function startOfMonthStr(dateStr: string): string {
  return dateStr.substring(0, 7) + '-01';
}

function computeSummaryTotals(
  dailyData: DailyData[],
  presets: Record<string, { from: string; to: string }>
): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const [preset, { from, to }] of Object.entries(presets)) {
    totals[preset] = dailyData
      .filter((d) => d.date >= from && d.date <= to)
      .reduce((s, d) => s + d.total, 0);
  }
  return totals;
}

function toDateStr(timestamp: number): string {
  return new Date(timestamp * 1000).toISOString().split('T')[0];
}

function dateLabel(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function buildDailyData(
  dailyReports: { timestamp: number; value: number }[],
  istOverrides: { istDaily: Map<string, number>; utcReductions: Map<string, number> },
  liveByDate: Map<string, { human: number; humanResolved: number }>,
  baselineMap: Record<string, { human: number; humanResolved: number }>
): DailyData[] {
  const totalByDate = new Map<string, number>();
  for (const row of dailyReports) {
    if (row.value > 0) totalByDate.set(toDateStr(row.timestamp), row.value);
  }
  istOverrides.utcReductions.forEach((reduction, utcDate) => {
    const existing = totalByDate.get(utcDate);
    if (existing !== undefined) {
      const adjusted = existing - reduction;
      if (adjusted > 0) totalByDate.set(utcDate, adjusted);
      else totalByDate.delete(utcDate);
    }
  });
  istOverrides.istDaily.forEach((count, date) => {
    if (count > 0) totalByDate.set(date, count);
    else totalByDate.delete(date);
  });

  const allDates = new Set([
    ...Array.from(totalByDate.keys()),
    ...Array.from(liveByDate.keys()),
  ]);

  return Array.from(allDates)
    .sort()
    .map((date) => {
      const total = totalByDate.get(date) ?? 0;
      const esc = liveByDate.has(date)
        ? liveByDate.get(date)!
        : (baselineMap[date] ?? { human: 0, humanResolved: 0 });
      const { human, humanResolved } = esc;
      const bot = Math.max(0, total - human);
      const open = Math.max(0, human - humanResolved);
      return {
        date,
        label: dateLabel(date),
        total,
        bot,
        human,
        humanResolved,
        open,
        botRate: total > 0 ? Math.round((bot / total) * 1000) / 10 : 0,
      };
    });
}

function aggregateDailyData(arrays: DailyData[][]): DailyData[] {
  const byDate = new Map<string, { total: number; human: number; humanResolved: number }>();
  for (const arr of arrays) {
    for (const row of arr) {
      if (!byDate.has(row.date)) byDate.set(row.date, { total: 0, human: 0, humanResolved: 0 });
      const agg = byDate.get(row.date)!;
      agg.total += row.total;
      agg.human += row.human;
      agg.humanResolved += row.humanResolved;
    }
  }
  return Array.from(byDate.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, { total, human, humanResolved }]) => {
      const bot = Math.max(0, total - human);
      const open = Math.max(0, human - humanResolved);
      return {
        date,
        label: dateLabel(date),
        total,
        bot,
        human,
        humanResolved,
        open,
        botRate: total > 0 ? Math.round((bot / total) * 1000) / 10 : 0,
      };
    });
}

function buildHeatmap(hourlyReports: { timestamp: number; value: number }[]): number[][] {
  const IST_OFFSET = 5.5 * 3600;
  const matrix: number[][] = Array.from({ length: 7 }, () => new Array(24).fill(0));
  for (const row of hourlyReports) {
    if (row.value === 0) continue;
    const d = new Date((row.timestamp + IST_OFFSET) * 1000);
    const hour = d.getUTCHours();
    const rawDow = d.getUTCDay();
    const dow = rawDow === 0 ? 6 : rawDow - 1;
    matrix[dow][hour] += row.value;
  }
  return matrix;
}

function buildISTDailyFromHourly(hourlyReports: { timestamp: number; value: number }[]): {
  istDaily: Map<string, number>;
  utcReductions: Map<string, number>;
} {
  const IST_OFFSET_S = 19800;
  const istDaily = new Map<string, number>();
  const utcReductions = new Map<string, number>();
  for (const row of hourlyReports) {
    if (row.value === 0) continue;
    const utcDate = toDateStr(row.timestamp);
    const istDate = toDateStr(row.timestamp + IST_OFFSET_S);
    istDaily.set(istDate, (istDaily.get(istDate) ?? 0) + row.value);
    if (utcDate !== istDate) {
      utcReductions.set(utcDate, (utcReductions.get(utcDate) ?? 0) + row.value);
    }
  }
  return { istDaily, utcReductions };
}

function subtractTestFromISTDaily(
  istDaily: Map<string, number>,
  testByDate: Record<string, { total: number; escalated: number }>
): Map<string, number> {
  if (Object.keys(testByDate).length === 0) return istDaily;
  const result = new Map(istDaily);
  for (const [date, testCounts] of Object.entries(testByDate)) {
    if (!testCounts.total) continue;
    const existing = result.get(date);
    if (existing === undefined) continue;
    const adjusted = Math.max(0, existing - testCounts.total);
    if (adjusted > 0) result.set(date, adjusted);
    else result.delete(date);
  }
  return result;
}

export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get('clientId');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const config = clientsConfig.find((c) => c.id === clientId) as any;

  if (!config) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 });
  }

  try {
    const channelDefs: { name: string; icon: string; inboxId: number }[] =
      config.channels && Array.isArray(config.channels) && config.channels.length > 0
        ? config.channels
        : [{ name: config.name, icon: '💬', inboxId: config.inboxId }];

    const [allDailyReports, allHourlyReports] = await Promise.all([
      Promise.all(channelDefs.map((ch) => fetchDailyWithCache(config.accountId, ch.inboxId))),
      Promise.all(
        channelDefs.map((ch) =>
          fetchHourlyConversationCounts(config.accountId, ch.inboxId).catch(() => [] as { timestamp: number; value: number }[])
        )
      ),
    ]);

    const channelTestData = channelDefs.map((ch) => getTestByDate(config.accountId, ch.inboxId));
    const excludedContactIds = getExcludedContactIds(config.accountId);
    const channelTesterByDate = channelDefs.map((ch) =>
      getTesterConvsByDate(config.accountId, ch.inboxId, excludedContactIds)
    );

    const adjustedDailyReports = allDailyReports.map((reports, i) => {
      const afterTest = subtractTestFromDaily(reports, channelTestData[i]);
      return subtractTesterFromDaily(afterTest, channelTesterByDate[i]);
    });

    const channelLiveEscRaw = channelDefs.map((ch) =>
      getEscalation(config.accountId, ch.inboxId, config.escalationLabels, config.botAgentId, excludedContactIds)
    );
    const channelLiveEsc = channelLiveEscRaw.map((escMap, i) =>
      subtractTestFromEscMap(escMap, channelTestData[i])
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const baselineAccounts = (baseline as any).accounts ?? {};
    const channelBaseline = channelDefs.map((ch, i) => {
      const raw = (baselineAccounts[String(config.accountId)] ?? {})[String(ch.inboxId)] ?? {};
      return subtractTestFromBaseline(raw, channelTestData[i]);
    });

    const channelISTOverrides = allHourlyReports.map((hourly, i) => {
      const { istDaily, utcReductions } = buildISTDailyFromHourly(hourly);
      const afterTest = subtractTestFromISTDaily(istDaily, channelTestData[i]);
      return { istDaily: subtractTesterFromISTDaily(afterTest, channelTesterByDate[i]), utcReductions };
    });

    const channelDailyArrays = channelDefs.map((_, i) =>
      buildDailyData(adjustedDailyReports[i], channelISTOverrides[i], channelLiveEsc[i], channelBaseline[i])
    );

    const dailyData = aggregateDailyData(channelDailyArrays);
    const heatmap = buildHeatmap(allHourlyReports.flat());

    const hasMultipleChannels = config.channels && config.channels.length > 0;
    const channelDailyData = hasMultipleChannels
      ? channelDefs.map((ch, i) => ({
          name: ch.name,
          icon: ch.icon,
          inboxId: ch.inboxId,
          dailyData: channelDailyArrays[i],
        }))
      : [];

    const escalationReady = channelDefs.every((ch) => {
      const key = escKey(config.accountId, ch.inboxId, config.escalationLabels);
      const c = escCache.get(key);
      return c && c !== 'loading';
    });

    const todayIST = getTodayIST();
    const dataStart = dailyData[0]?.date ?? todayIST;
    const presets = {
      'all-time':   { from: dataStart,               to: todayIST },
      'this-month': { from: startOfMonthStr(todayIST), to: todayIST },
      'last-30':    { from: addDaysStr(todayIST, -30), to: todayIST },
      'last-7':     { from: addDaysStr(todayIST, -7),  to: todayIST },
    };
    const summaryTotals = computeSummaryTotals(dailyData, presets);

    return NextResponse.json({
      dailyData,
      startDate: dailyData[0]?.date ?? todayIST,
      endDate: todayIST,
      heatmap,
      channelDailyData,
      escalationReady,
      summaryTotals,
    });
  } catch (err) {
    console.error('Chatwoot fetch error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch data' },
      { status: 500 }
    );
  }
}
