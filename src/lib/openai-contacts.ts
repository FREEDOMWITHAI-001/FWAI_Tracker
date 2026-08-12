// WhatsApp recipients for an OpenAI project. Server-only.
//
// Shared by the create and edit routes so both reconcile a submitted list the
// same way — a project's recipients are edited in exactly two places and the
// rules (trim, de-duplicate, preserve the episode latch) must not drift between
// them.

import { exec, sql } from '@/lib/db';

/**
 * Clean a submitted list into what actually goes in the database.
 *
 * De-duplication matters: the same number twice would mean the same person
 * receiving two identical WhatsApps for one incident, and the unique index would
 * reject the insert anyway. Order of first appearance is preserved so the
 * operator's "primary" number stays first in the UI.
 */
export function normalisePhones(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input) {
    const phone = String(raw ?? '').trim();
    if (!phone || seen.has(phone)) continue;
    seen.add(phone);
    out.push(phone);
  }
  return out;
}

/**
 * Make the stored recipients match `phones` exactly.
 *
 * DELETE-THE-GONE, INSERT-THE-NEW, rather than delete-all-then-reinsert. A
 * number that survives an edit keeps its row and therefore its `alerted_at`, so
 * renaming a contact or adding a fourth number in the middle of a no-credit
 * episode does not re-message the three people who were already told. A number
 * that is removed loses its row, so no future alert can reach it.
 */
export async function replaceContacts(accountId: string, phones: string[]): Promise<void> {
  const existing = await sql<{ phone: string }>(
    'select phone from openai_account_contacts where openai_account_id = $1',
    [accountId]
  );
  const current = new Set(existing.map((r) => r.phone));
  const wanted = new Set(phones);

  const gone = [...current].filter((p) => !wanted.has(p));
  if (gone.length) {
    await exec(
      'delete from openai_account_contacts where openai_account_id = $1 and phone = any($2::text[])',
      [accountId, gone]
    );
  }

  const added = phones.filter((p) => !current.has(p));
  if (added.length) {
    // alerted_at defaults to NULL, so a number added during an ongoing episode
    // is messaged on the next check — which is the point of adding it.
    const values = added.map((_, i) => `($1, $${i + 2})`).join(', ');
    await exec(
      `insert into openai_account_contacts (openai_account_id, phone) values ${values}
       on conflict (openai_account_id, phone) do nothing`,
      [accountId, ...added]
    );
  }
}
