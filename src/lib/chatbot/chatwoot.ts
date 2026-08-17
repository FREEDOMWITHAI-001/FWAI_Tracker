const BASE_URL = 'https://desk.freedomwithai.com';

function getToken(): string {
  const token = process.env.CHATWOOT_API_TOKEN;
  if (!token) throw new Error('CHATWOOT_API_TOKEN is not set in environment');
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

export interface DailyReport {
  timestamp: number;
  value: number;
}

export async function fetchDailyConversationCounts(
  accountId: number,
  inboxId: number
): Promise<DailyReport[]> {
  const since = 1735689600; // Jan 1, 2025
  const until = Math.floor(Date.now() / 1000) + 86400;
  return chatwootFetch(
    `/api/v2/accounts/${accountId}/reports?type=inbox&metric=conversations_count&group_by=day&id=${inboxId}&since=${since}&until=${until}`
  );
}

export async function fetchHourlyConversationCounts(
  accountId: number,
  inboxId: number
): Promise<DailyReport[]> {
  const since = Math.floor(Date.now() / 1000) - 90 * 86400;
  const until = Math.floor(Date.now() / 1000) + 86400;
  return chatwootFetch(
    `/api/v2/accounts/${accountId}/reports?type=inbox&metric=conversations_count&group_by=hour&id=${inboxId}&since=${since}&until=${until}`
  );
}

export interface CWConversation {
  id: number;
  inbox_id?: number;
  status: 'open' | 'resolved' | 'pending' | 'snoozed';
  created_at: number;
  labels: string[];
  meta?: {
    assignee?: { id: number; name: string };
    sender?: { id: number; name: string };
  };
}

const PAGE_BATCH = 4;

async function fetchConversationsByLabel(
  accountId: number,
  inboxId: number,
  label: string,
  since: number
): Promise<CWConversation[]> {
  const url = (p: number) =>
    `/api/v1/accounts/${accountId}/conversations?inbox_id=${inboxId}&labels[]=${label}&status=all&created_after=${since}&page=${p}`;

  const page1 = await chatwootFetch(url(1));
  const allCount: number = page1?.data?.meta?.all_count ?? 0;
  const first: CWConversation[] = page1?.data?.payload ?? [];
  if (first.length === 0) return [];

  const totalPages = Math.ceil(allCount / 25);
  if (totalPages <= 1) return first;

  const all: CWConversation[] = [...first];
  for (let start = 2; start <= totalPages; start += PAGE_BATCH) {
    const end = Math.min(start + PAGE_BATCH - 1, totalPages);
    const batch = await Promise.all(
      Array.from({ length: end - start + 1 }, (_, i) =>
        chatwootFetch(url(start + i))
          .then((d) => (d?.data?.payload ?? []) as CWConversation[])
          .catch(() => [] as CWConversation[])
      )
    );
    for (const convs of batch) all.push(...convs);
  }

  return all;
}

async function fetchAssignedConversations(
  accountId: number,
  inboxId: number,
  since: number
): Promise<CWConversation[]> {
  const url = (p: number) =>
    `/api/v1/accounts/${accountId}/conversations?inbox_id=${inboxId}&assignee_type=assigned&status=all&created_after=${since}&page=${p}`;

  const page1 = await chatwootFetch(url(1));
  const allCount: number = page1?.data?.meta?.assigned_count ?? 0;
  const first: CWConversation[] = page1?.data?.payload ?? [];
  if (first.length === 0) return [];

  const totalPages = Math.ceil(allCount / 25);
  if (totalPages <= 1) return first;

  const all: CWConversation[] = [...first];
  for (let start = 2; start <= totalPages; start += PAGE_BATCH) {
    const end = Math.min(start + PAGE_BATCH - 1, totalPages);
    const batch = await Promise.all(
      Array.from({ length: end - start + 1 }, (_, i) =>
        chatwootFetch(url(start + i))
          .then((d) => (d?.data?.payload ?? []) as CWConversation[])
          .catch(() => [] as CWConversation[])
      )
    );
    for (const convs of batch) all.push(...convs);
  }

  return all;
}

export async function fetchEscalatedConversations(
  accountId: number,
  inboxId: number,
  escalationLabels: string[],
  since: number,
  botAgentId?: number,
  excludedContactIds?: number[]
): Promise<CWConversation[]> {
  const seen = new Map<number, CWConversation>();
  const isTester = (conv: CWConversation) =>
    !!excludedContactIds?.length &&
    conv.meta?.sender?.id !== undefined &&
    excludedContactIds.includes(conv.meta.sender.id);

  try {
    const assignedConvs = await fetchAssignedConversations(accountId, inboxId, since);
    for (const conv of assignedConvs) {
      if (botAgentId && conv.meta?.assignee?.id === botAgentId) continue;
      if (isTester(conv)) continue;
      seen.set(conv.id, conv);
    }
  } catch {
    // fall back to label-only
  }

  for (const label of escalationLabels) {
    try {
      const convs = await fetchConversationsByLabel(accountId, inboxId, label, since);
      for (const conv of convs) {
        if (botAgentId && conv.meta?.assignee?.id === botAgentId) continue;
        if (isTester(conv)) continue;
        if (!seen.has(conv.id)) seen.set(conv.id, conv);
      }
    } catch {
      // label doesn't exist in this inbox
    }
  }

  return Array.from(seen.values());
}

export async function fetchTesterConversations(
  accountId: number,
  contactIds: number[],
  inboxId: number,
  since: number
): Promise<CWConversation[]> {
  if (!contactIds.length) return [];
  const allConvs: CWConversation[] = [];
  for (const contactId of contactIds) {
    try {
      const data = await chatwootFetch(
        `/api/v1/accounts/${accountId}/contacts/${contactId}/conversations`
      );
      const raw = data?.payload;
      const convs: CWConversation[] = Array.isArray(raw)
        ? raw
        : (raw?.data?.payload ?? []);
      for (const conv of convs) {
        if (conv.inbox_id === inboxId && conv.created_at >= since) {
          allConvs.push(conv);
        }
      }
    } catch {
      // contact has no conversations
    }
  }
  return allConvs;
}
