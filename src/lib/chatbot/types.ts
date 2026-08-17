export interface Client {
  id: string;
  name: string;
  subtitle: string;
  avgHandlingTimeMinutes: number;
}

export interface MonthlyData {
  month: string;
  bot: number;
  human: number;
  total: number;
  botRate: number;
}

export interface DailyData {
  date: string;
  label: string;
  total: number;
  bot: number;
  human: number;
  humanResolved: number;
  open: number;
  botRate: number;
}

export interface AllTimeMetrics {
  startDate: string;
  endDate: string;
  total: number;
  botResolved: number;
  botResolvedPct: number;
  escalated: number;
  escalatedPct: number;
  humanResolved: number;
  humanResolvedPct: number;
  humanResolvedOfTotalPct: number;
  open: number;
  openPct: number;
  botHandled: number;
  hoursSaved: number;
  minutesSaved: number;
  workingDaysSaved: number;
  botRateTrend: { from: number; to: number; fromMonth: string; toMonth: string };
  monthlyData: MonthlyData[];
  unclassifiedPct: number;
  avgHandlingTimeMinutes: number;
}

export interface WeeklyMetrics {
  startDate: string;
  endDate: string;
  total: number;
  botResolved: number;
  botResolvedPct: number;
  escalated: number;
  escalatedPct: number;
  humanResolved: number;
  humanResolvedPct: number;
  humanResolvedOfTotalPct: number;
  open: number;
  openPct: number;
  peakDay: { label: string; count: number };
  hoursSaved: number;
  dailyData: DailyData[];
  unclassifiedPct: number;
  avgHandlingTimeMinutes: number;
}

export interface DashboardData {
  client: Client;
  allTime: AllTimeMetrics;
  weekly: WeeklyMetrics;
}
