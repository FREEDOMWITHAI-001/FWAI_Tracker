'use client';

import { useState, useMemo, useEffect } from 'react';
import dynamic from 'next/dynamic';
import clientsConfig from '@/config/clients.json';
import type { DailyData } from '@/lib/chatbot/types';
import {
  filterByDateRange,
  computeAllTimeMetrics,
  formatDisplayDate,
  addDays,
  startOfMonth,
  groupByWeek,
} from '@/lib/chatbot/metrics';
import ChatbotHeader, { type DatePreset } from '@/components/chatbot/ChatbotHeader';
import ReportHero from '@/components/chatbot/ReportHero';
import KpiStrip from '@/components/chatbot/KpiStrip';
import DonutCard from '@/components/chatbot/DonutCard';
import TimeSavedCard from '@/components/chatbot/TimeSavedCard';
import ImpactBoxes from '@/components/chatbot/ImpactBoxes';
import WeeklyPerfTable from '@/components/chatbot/WeeklyPerfTable';
import HoursSavedBand from '@/components/chatbot/HoursSavedBand';
import AiVsTeam from '@/components/chatbot/AiVsTeam';
import ChannelBreakdown from '@/components/chatbot/ChannelBreakdown';
import ConversationLog from '@/components/chatbot/ConversationLog';
import { generateHTMLReport, downloadReport } from '@/lib/chatbot/generateReport';

const WeeklyCharts = dynamic(() => import('@/components/chatbot/WeeklyCharts'), { ssr: false });
const ActivityHeatmap = dynamic(() => import('@/components/chatbot/ActivityHeatmap'), { ssr: false });

interface ChannelDailyData {
  name: string;
  icon: string;
  inboxId: number;
  dailyData: DailyData[];
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: '11px', fontWeight: 700, textTransform: 'uppercase',
      letterSpacing: '.8px', color: '#94a3b8', margin: '44px 0 18px',
    }}>
      {children}
    </div>
  );
}

export default function ChatbotReportPage() {
  const [selectedClientId, setSelectedClientId] = useState(clientsConfig[0]?.id ?? 'gonature');
  const [datePreset, setDatePreset] = useState<DatePreset>('all-time');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');

  const [allDailyData, setAllDailyData] = useState<DailyData[]>([]);
  const [dataStartDate, setDataStartDate] = useState('');
  const [dataEndDate, setDataEndDate] = useState('');
  const [heatmap, setHeatmap] = useState<number[][]>([]);
  const [channelDailyData, setChannelDailyData] = useState<ChannelDailyData[]>([]);
  const [escalationReady, setEscalationReady] = useState(true);
  const [summaryTotals, setSummaryTotals] = useState<Record<string, number>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  const config = clientsConfig.find((c) => c.id === selectedClientId) ?? clientsConfig[0];

  useEffect(() => {
    let cancelled = false;
    const fetchData = (showSpinner = false) => {
      if (showSpinner) { setIsLoading(true); setAllDailyData([]); setHeatmap([]); setChannelDailyData([]); setEscalationReady(true); }
      setError('');
      fetch(`/api/chatbot/metrics?clientId=${selectedClientId}`)
        .then((r) => r.json())
        .then((data) => {
          if (cancelled) return;
          if (data.error) { setError(data.error); return; }
          setAllDailyData(data.dailyData ?? []);
          setDataStartDate(data.startDate ?? '');
          setDataEndDate(data.endDate ?? new Date().toISOString().split('T')[0]);
          setHeatmap(data.heatmap ?? []);
          setChannelDailyData(data.channelDailyData ?? []);
          setEscalationReady(data.escalationReady ?? true);
          setSummaryTotals(data.summaryTotals ?? {});
        })
        .catch((e: Error) => { if (!cancelled) setError(e.message); })
        .finally(() => { if (!cancelled) setIsLoading(false); });
    };
    fetchData(true);
    const interval = setInterval(() => fetchData(false), 60_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [selectedClientId]);

  const handleClientChange = (id: string) => {
    setSelectedClientId(id);
    setDatePreset('all-time');
    setCustomFrom('');
    setCustomTo('');
  };

  const today = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().split('T')[0];

  const effectiveRange = useMemo(() => {
    const start = dataStartDate || today;
    switch (datePreset) {
      case 'all-time': return { from: start, to: today };
      case 'this-month': return { from: startOfMonth(today), to: today };
      case 'last-30': return { from: addDays(today, -29), to: today };
      case 'last-7': return { from: addDays(today, -6), to: today };
      case 'custom': return {
        from: customFrom && customFrom >= start ? customFrom : start,
        to: customTo && customTo <= (dataEndDate || today) ? customTo : (dataEndDate || today),
      };
    }
  }, [dataStartDate, dataEndDate, datePreset, customFrom, customTo, today]);

  const filteredData = useMemo(
    () => filterByDateRange(allDailyData, effectiveRange.from, effectiveRange.to),
    [allDailyData, effectiveRange]
  );

  const atBase = useMemo(
    () => computeAllTimeMetrics(filteredData, (config as any).avgHandlingTimeMinutes),
    [filteredData, config]
  );

  const at = useMemo(() => {
    const startDate = filteredData.length > 0 ? formatDisplayDate(filteredData[0].date) : '';
    const endDate   = filteredData.length > 0 ? formatDisplayDate(filteredData[filteredData.length - 1].date) : '';

    const accurateTotal =
      datePreset !== 'custom' && summaryTotals[datePreset] != null
        ? summaryTotals[datePreset]
        : atBase.total;

    if (accurateTotal === atBase.total) {
      return { ...atBase, startDate, endDate };
    }

    const total = accurateTotal;
    const human = atBase.escalated;
    const bot = Math.max(0, total - human);
    const humanResolved = atBase.humanResolved;
    const open = atBase.open;
    const avgHandlingTimeMinutes = (config as any).avgHandlingTimeMinutes;
    const minutesSaved = bot * avgHandlingTimeMinutes;
    const hoursSaved = Math.round(minutesSaved / 60);
    const workingDaysSaved = Math.round((hoursSaved / 8) * 10) / 10;

    return {
      ...atBase,
      total,
      botResolved: bot,
      botHandled: bot,
      botResolvedPct:          total > 0 ? Math.round((bot          / total) * 1000) / 10 : 0,
      escalatedPct:            total > 0 ? Math.round((human        / total) * 1000) / 10 : 0,
      humanResolvedOfTotalPct: total > 0 ? Math.round((humanResolved / total) * 1000) / 10 : 0,
      openPct:                 total > 0 ? Math.round((open          / total) * 1000) / 10 : 0,
      hoursSaved,
      minutesSaved,
      workingDaysSaved,
      startDate,
      endDate,
    };
  }, [atBase, datePreset, summaryTotals, config, filteredData]);

  const weekGroups = useMemo(() => groupByWeek(filteredData), [filteredData]);

  const bestWeek = useMemo(() => {
    if (!weekGroups.length) return { botRate: 0, label: '' };
    return weekGroups.reduce((best, w) => (w.botRate > best.botRate ? w : best), weekGroups[0]);
  }, [weekGroups]);

  const rangeLabel = `${at.startDate} \u2013 ${at.endDate}`;
  const hasChannels = channelDailyData.length > 0;

  const handleDownload = () => {
    const html = generateHTMLReport(
      (config as any).name,
      (config as any).subtitle,
      at,
      weekGroups,
      rangeLabel,
      channelDailyData,
      heatmap,
      effectiveRange.from,
      effectiveRange.to,
      (config as any).avgHandlingTimeMinutes
    );
    downloadReport(html, (config as any).name, rangeLabel);
  };

  return (
    <div style={{ minHeight: '100vh', background: '#f5f7fa', color: '#1a2332', fontFamily: "'Segoe UI', system-ui, sans-serif" }}>
      <ChatbotHeader
        clients={clientsConfig.map((c) => ({ id: c.id, name: c.name }))}
        selectedClientId={selectedClientId}
        onClientChange={handleClientChange}
        clientName={(config as any).name}
        clientSubtitle={(config as any).subtitle}
        activePreset={datePreset}
        onPresetChange={setDatePreset}
        customFrom={customFrom}
        customTo={customTo}
        onCustomFromChange={setCustomFrom}
        onCustomToChange={setCustomTo}
        minDate={dataStartDate || today}
        maxDate={today}
        allTimeLabel={rangeLabel}
        allTimeCount={at.total}
        onDownload={handleDownload}
      />

      <main style={{ maxWidth: '1200px', margin: '0 auto', padding: '0 32px 80px' }}>
        {isLoading && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '96px 0' }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ width: 40, height: 40, border: '4px solid #1e3a5f', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto' }} />
              <p style={{ color: '#94a3b8', fontSize: '14px', marginTop: '12px' }}>Fetching live data from Chatwoot…</p>
            </div>
          </div>
        )}

        {!isLoading && error && (
          <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '12px', padding: '20px 24px', color: '#dc2626', marginTop: '24px' }}>
            <p style={{ fontWeight: 600 }}>Failed to load data</p>
            <p style={{ fontSize: '13px', marginTop: '4px' }}>{error}</p>
          </div>
        )}

        {!isLoading && !error && !escalationReady && (
          <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '10px', padding: '12px 18px', marginTop: '20px', fontSize: '12.5px', color: '#92400e', display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ width: 14, height: 14, border: '2px solid #d97706', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite', flexShrink: 0 }} />
            <span>
              <strong>Escalation data is loading in the background.</strong>{' '}
              Bot vs. human split will appear on the next auto-refresh (within 60s). Total conversation counts are accurate.
            </span>
          </div>
        )}

        {!isLoading && !error && (
          <>
            <ReportHero
              clientName={(config as any).name}
              subtitle={(config as any).subtitle}
              startDate={at.startDate}
              endDate={at.endDate}
              total={at.total}
              botRate={at.botResolvedPct}
            />

            <SectionLabel>Key numbers — {rangeLabel}</SectionLabel>
            <KpiStrip
              total={at.total}
              botResolved={at.botResolved}
              botResolvedPct={at.botResolvedPct}
              hoursSaved={at.hoursSaved}
              workingDaysSaved={at.workingDaysSaved}
              bestWeekRate={bestWeek.botRate}
              bestWeekLabel={bestWeek.label}
            />

            <SectionLabel>How every customer query was handled</SectionLabel>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '24px' }}>
              <DonutCard
                bot={at.botResolved}
                human={at.escalated}
                total={at.total}
                botResolvedPct={at.botResolvedPct}
              />
              <TimeSavedCard
                hoursSaved={at.hoursSaved}
                workingDaysSaved={at.workingDaysSaved}
                botResolved={at.botResolved}
                avgHandlingTimeMinutes={at.avgHandlingTimeMinutes}
                totalDays={filteredData.length}
              />
            </div>

            {hasChannels && (
              <>
                <SectionLabel>Performance by channel</SectionLabel>
                <ChannelBreakdown
                  channels={channelDailyData}
                  from={effectiveRange.from}
                  to={effectiveRange.to}
                  avgHandlingTimeMinutes={(config as any).avgHandlingTimeMinutes}
                />
              </>
            )}

            {weekGroups.length >= 2 && (
              <>
                <SectionLabel>Week-by-week — volume and AI performance</SectionLabel>
                <WeeklyCharts weekGroups={weekGroups} />
              </>
            )}

            <SectionLabel>What this means for the business</SectionLabel>
            <ImpactBoxes
              botResolved={at.botResolved}
              hoursSaved={at.hoursSaved}
              botRateTrend={at.botRateTrend}
            />

            <SectionLabel>How AI and your team work together</SectionLabel>
            <AiVsTeam
              botResolved={at.botResolved}
              human={at.escalated}
              humanResolved={at.humanResolved}
              open={at.open}
            />

            {weekGroups.length > 0 && (
              <>
                <SectionLabel>Week-by-week: AI vs Team effort — and how performance grew</SectionLabel>
                <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '14px 18px', marginBottom: '12px', fontSize: '12px', color: '#475569', lineHeight: 1.7 }}>
                  <strong style={{ color: '#1e3a5f' }}>How performance improved:</strong> Each week, when the team answered an escalated query, that answer was added to the AI knowledge base. Next week, the bot handled the same question on its own — no human needed. This is why bot rate improves over time.
                </div>
                <WeeklyPerfTable
                  weekGroups={weekGroups}
                  avgHandlingTimeMinutes={(config as any).avgHandlingTimeMinutes}
                />
              </>
            )}

            <SectionLabel>Time saved for your team</SectionLabel>
            <HoursSavedBand
              hoursSaved={at.hoursSaved}
              botResolved={at.botResolved}
              avgHandlingTimeMinutes={at.avgHandlingTimeMinutes}
              workingDaysSaved={at.workingDaysSaved}
            />

            {heatmap.length > 0 && (
              <>
                <SectionLabel>When your customers reach out</SectionLabel>
                <ActivityHeatmap heatmap={heatmap} />
              </>
            )}

            <SectionLabel>Validate: real conversations from Chatwoot</SectionLabel>
            <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '10px', padding: '10px 16px', marginBottom: '16px', fontSize: '12px', color: '#92400e' }}>
              This table fetches real conversations from Chatwoot and classifies them as AI-resolved vs human-handled.
              <strong> Human handled</strong> = assigned to a human agent OR has escalation label. <strong>AI resolved</strong> = bot handled end-to-end (no assignee, no escalation label).
            </div>
            <ConversationLog clientId={selectedClientId} />

            <div style={{ textAlign: 'center', fontSize: '11px', color: '#94a3b8', padding: '20px 24px 40px', borderTop: '1px solid #e5e9f0', marginTop: '20px' }}>
              {(config as any).name} Chatbot Performance Report · desk.freedomwithai.com · Auto-refreshes every 60s · Prepared by FWAI
            </div>
          </>
        )}
      </main>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
