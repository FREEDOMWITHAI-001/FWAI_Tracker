import { DailyData, AllTimeMetrics, WeeklyMetrics, MonthlyData } from './types';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function sumField(arr: DailyData[], key: keyof DailyData): number {
  return arr.reduce((s, d) => s + (d[key] as number), 0);
}

function groupByMonth(data: DailyData[]): Record<string, DailyData[]> {
  const groups: Record<string, DailyData[]> = {};
  data.forEach((d) => {
    const key = d.date.substring(0, 7);
    if (!groups[key]) groups[key] = [];
    groups[key].push(d);
  });
  return groups;
}

function monthLabel(key: string): string {
  const parts = key.split('-');
  const monthIdx = parseInt(parts[1]) - 1;
  return `${MONTHS[monthIdx]} ${parts[0]}`;
}

export function computeMonthlyData(data: DailyData[]): MonthlyData[] {
  const groups = groupByMonth(data);
  return Object.keys(groups)
    .sort()
    .map((key) => {
      const g = groups[key];
      const total = sumField(g, 'total');
      const bot = sumField(g, 'bot');
      const human = sumField(g, 'human');
      return {
        month: monthLabel(key),
        bot,
        human,
        total,
        botRate: total > 0 ? Math.round((bot / total) * 1000) / 10 : 0,
      };
    });
}

export function computeAllTimeMetrics(
  data: DailyData[],
  avgHandlingTimeMinutes: number
): Omit<AllTimeMetrics, 'startDate' | 'endDate'> {
  if (data.length === 0) {
    return {
      total: 0, botResolved: 0, botResolvedPct: 0,
      escalated: 0, escalatedPct: 0,
      humanResolved: 0, humanResolvedPct: 0, humanResolvedOfTotalPct: 0,
      open: 0, openPct: 0, botHandled: 0,
      hoursSaved: 0, minutesSaved: 0, workingDaysSaved: 0,
      botRateTrend: { from: 0, to: 0, fromMonth: '', toMonth: '' },
      monthlyData: [], unclassifiedPct: 0, avgHandlingTimeMinutes,
    };
  }

  const total = sumField(data, 'total');
  const bot = sumField(data, 'bot');
  const human = sumField(data, 'human');
  const humanResolved = sumField(data, 'humanResolved');
  const open = sumField(data, 'open');
  const minutesSaved = bot * avgHandlingTimeMinutes;
  const hoursSaved = Math.round(minutesSaved / 60);
  const workingDaysSaved = Math.round((hoursSaved / 8) * 10) / 10;
  const monthlyData = computeMonthlyData(data);
  const fromMonth = monthlyData.length > 0 ? monthlyData[0].month.split(' ')[0] : '';
  const toMonth = monthlyData.length > 0 ? monthlyData[monthlyData.length - 1].month.split(' ')[0] : '';
  const firstRate = monthlyData.length > 0 ? Math.round(monthlyData[0].botRate) : 0;
  const lastRate = monthlyData.length > 0 ? Math.round(monthlyData[monthlyData.length - 1].botRate) : 0;

  return {
    total,
    botResolved: bot,
    botResolvedPct: total > 0 ? Math.round((bot / total) * 1000) / 10 : 0,
    escalated: human,
    escalatedPct: total > 0 ? Math.round((human / total) * 1000) / 10 : 0,
    humanResolved,
    humanResolvedPct: human > 0 ? Math.round((humanResolved / human) * 1000) / 10 : 0,
    humanResolvedOfTotalPct: total > 0 ? Math.round((humanResolved / total) * 1000) / 10 : 0,
    open,
    openPct: total > 0 ? Math.round((open / total) * 1000) / 10 : 0,
    botHandled: bot,
    hoursSaved,
    minutesSaved,
    workingDaysSaved,
    botRateTrend: { from: firstRate, to: lastRate, fromMonth, toMonth },
    monthlyData,
    unclassifiedPct: 0,
    avgHandlingTimeMinutes,
  };
}

export function computeWeeklyMetrics(
  data: DailyData[],
  avgHandlingTimeMinutes: number
): Omit<WeeklyMetrics, 'startDate' | 'endDate'> {
  if (data.length === 0) {
    return {
      total: 0, botResolved: 0, botResolvedPct: 0,
      escalated: 0, escalatedPct: 0,
      humanResolved: 0, humanResolvedPct: 0, humanResolvedOfTotalPct: 0,
      open: 0, openPct: 0,
      peakDay: { label: '-', count: 0 },
      hoursSaved: 0, dailyData: [], unclassifiedPct: 0, avgHandlingTimeMinutes,
    };
  }

  const total = sumField(data, 'total');
  const bot = sumField(data, 'bot');
  const human = sumField(data, 'human');
  const humanResolved = sumField(data, 'humanResolved');
  const open = sumField(data, 'open');
  const hoursSaved = Math.round((bot * avgHandlingTimeMinutes) / 60);
  const peakDayData = data.reduce((best, d) => (d.total > best.total ? d : best), data[0]);

  return {
    total,
    botResolved: bot,
    botResolvedPct: total > 0 ? Math.round((bot / total) * 1000) / 10 : 0,
    escalated: human,
    escalatedPct: total > 0 ? Math.round((human / total) * 1000) / 10 : 0,
    humanResolved,
    humanResolvedPct: human > 0 ? Math.round((humanResolved / human) * 1000) / 10 : 0,
    humanResolvedOfTotalPct: total > 0 ? Math.round((humanResolved / total) * 1000) / 10 : 0,
    open,
    openPct: total > 0 ? Math.round((open / total) * 1000) / 10 : 0,
    peakDay: { label: peakDayData.label, count: peakDayData.total },
    hoursSaved,
    dailyData: data,
    unclassifiedPct: 0,
    avgHandlingTimeMinutes,
  };
}

export interface WeekGroup {
  label: string;
  startDate: string;
  endDate: string;
  total: number;
  bot: number;
  human: number;
  humanResolved: number;
  open: number;
  botRate: number;
}

export function groupByWeek(dailyData: DailyData[]): WeekGroup[] {
  if (!dailyData.length) return [];
  const buckets = new Map<string, DailyData[]>();
  for (const day of dailyData) {
    const d = new Date(day.date + 'T00:00:00Z');
    const dow = d.getUTCDay();
    const offset = dow === 0 ? 6 : dow - 1;
    const mon = new Date(d);
    mon.setUTCDate(d.getUTCDate() - offset);
    const key = mon.toISOString().split('T')[0];
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(day);
  }
  const fmt = (s: string) =>
    new Date(s + 'T00:00:00Z').toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', timeZone: 'UTC',
    });
  return Array.from(buckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, days]) => {
      const total = days.reduce((s: number, d: DailyData) => s + d.total, 0);
      const bot = days.reduce((s: number, d: DailyData) => s + d.bot, 0);
      const human = days.reduce((s: number, d: DailyData) => s + d.human, 0);
      const humanResolved = days.reduce((s: number, d: DailyData) => s + d.humanResolved, 0);
      const open = days.reduce((s: number, d: DailyData) => s + d.open, 0);
      const start = days[0].date;
      const end = days[days.length - 1].date;
      return {
        label: `${fmt(start)} \u2013 ${fmt(end)}`,
        startDate: start,
        endDate: end,
        total,
        bot,
        human,
        humanResolved,
        open,
        botRate: total > 0 ? Math.round((bot / total) * 1000) / 10 : 0,
      };
    });
}

export function filterByDateRange(data: DailyData[], from: string, to: string): DailyData[] {
  return data.filter((d) => d.date >= from && d.date <= to);
}

export function formatDisplayDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

export function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split('T')[0];
}

export function startOfMonth(dateStr: string): string {
  return dateStr.substring(0, 7) + '-01';
}
