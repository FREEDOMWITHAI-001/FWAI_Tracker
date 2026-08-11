import { maybeOne } from '@/lib/db';
import { ok, bad, guard } from '@/lib/api';
import { checkOpenAiAccount, runOpenAiAlerts, type OpenAiAccountRow } from '@/lib/openai-credits';

export const runtime = 'nodejs';
export const maxDuration = 60;
type Ctx = { params: Promise<{ id: string }> };

// POST /api/openai-accounts/[id]/check
// Refresh this account's usage now, then evaluate low-credit alerts so a "Check
// now" from the UI can actually trigger the WhatsApp, not just move a number.
export async function POST(_req: Request, { params }: Ctx) {
  return guard(async () => {
    const { id } = await params;
    const acct = await maybeOne<OpenAiAccountRow>(
      `select a.*, c.name as client_name, c.alert_name as client_alert_name, c.alert_phone as client_alert_phone
         from openai_accounts a
         left join clients c on c.id = a.client_id
        where a.id = $1`,
      [id]
    );
    if (!acct) return bad('OpenAI account not found', 404);

    const outcome = await checkOpenAiAccount(acct);
    // Alert evaluation is global but idempotent, and it is what turns a crossed
    // threshold into a message. A failure here must not lose the fresh usage
    // figure the check just wrote.
    let alerts_evaluated = true;
    try {
      await runOpenAiAlerts();
    } catch (e) {
      alerts_evaluated = false;
      console.error('[openai] alert evaluation failed:', e instanceof Error ? e.message : e);
    }
    return ok({ ...outcome, alerts_evaluated });
  });
}
