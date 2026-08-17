import { NextRequest, NextResponse } from 'next/server';
import clientsConfig from '@/config/clients.json';

const BASE_URL = 'https://desk.freedomwithai.com';

function getToken(): string {
  const token = process.env.CHATWOOT_API_TOKEN;
  if (!token) throw new Error('CHATWOOT_API_TOKEN is not set');
  return token;
}

async function chatwootFetch(path: string) {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { api_access_token: getToken() },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Chatwoot API error ${res.status}: ${path}`);
  return res.json();
}

interface RawConv {
  id: number;
  status: string;
  created_at: number;
  labels: string[];
  inbox_id: number;
  meta?: {
    assignee?: { id: number; name: string } | null;
  };
}

export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get('clientId');
  const days = parseInt(req.nextUrl.searchParams.get('days') ?? '30', 10);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const config = clientsConfig.find((c) => c.id === clientId) as any;
  if (!config) return NextResponse.json({ error: 'Client not found' }, { status: 404 });

  const channelDefs: { name: string; inboxId: number }[] =
    config.channels?.length > 0
      ? config.channels
      : [{ name: config.name, inboxId: config.inboxId }];

  const escalationLabels: string[] = config.escalationLabels ?? [];
  const since = Math.floor(Date.now() / 1000) - days * 86400;

  const allConvs: (RawConv & { inboxName: string })[] = [];

  for (const ch of channelDefs) {
    try {
      const page1 = await chatwootFetch(
        `/api/v1/accounts/${config.accountId}/conversations?inbox_id=${ch.inboxId}&status=all&page=1&created_after=${since}`
      );
      const first: RawConv[] = page1?.data?.payload ?? [];
      const allCount: number = page1?.data?.meta?.all_count ?? 0;
      const totalPages = Math.min(Math.ceil(allCount / 25), 8);

      const tagged = first.map((c) => ({ ...c, inboxName: ch.name }));
      allConvs.push(...tagged);

      if (totalPages > 1) {
        const remaining = await Promise.all(
          Array.from({ length: totalPages - 1 }, (_, i) =>
            chatwootFetch(
              `/api/v1/accounts/${config.accountId}/conversations?inbox_id=${ch.inboxId}&status=all&page=${i + 2}&created_after=${since}`
            )
              .then((d) => (d?.data?.payload ?? []) as RawConv[])
              .catch(() => [] as RawConv[])
          )
        );
        for (const page of remaining) {
          allConvs.push(...page.map((c) => ({ ...c, inboxName: ch.name })));
        }
      }
    } catch {
      // skip failed inbox
    }
  }

  const conversations = allConvs.map((c) => {
    const hasEscalationLabel = c.labels.some((l) => escalationLabels.includes(l));
    const hasAssignee = !!c.meta?.assignee;
    const classification: 'ai' | 'human' = hasEscalationLabel || hasAssignee ? 'human' : 'ai';
    return {
      id: c.id,
      date: new Date(c.created_at * 1000).toISOString().split('T')[0],
      status: c.status,
      labels: c.labels,
      assignee: c.meta?.assignee?.name ?? null,
      inbox: c.inboxName,
      classification,
    };
  });

  conversations.sort((a, b) => b.date.localeCompare(a.date));

  const ai = conversations.filter((c) => c.classification === 'ai').length;
  const human = conversations.filter((c) => c.classification === 'human').length;
  const total = conversations.length;

  return NextResponse.json({
    conversations,
    summary: {
      total,
      ai,
      human,
      aiRate: total > 0 ? Math.round((ai / total) * 1000) / 10 : 0,
      days,
      escalationLabels,
    },
  });
}
