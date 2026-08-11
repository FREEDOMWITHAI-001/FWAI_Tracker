import { ok, bad, guard } from '@/lib/api';
import { checkOpenAiAccount, loadAccountForCheck } from '@/lib/openai-check';

export const runtime = 'nodejs';
export const maxDuration = 60;
type Ctx = { params: Promise<{ id: string }> };

// POST /api/openai-accounts/[id]/check
// Probe this project's key now and store the verdict. Alerting is part of
// checkOpenAiAccount(), so a "Check now" from the UI can actually trigger the
// WhatsApp rather than only moving a badge.
//
// The frontend never talks to OpenAI: the key is decrypted here, used for one
// request, and never returned.
export async function POST(_req: Request, { params }: Ctx) {
  return guard(async () => {
    const { id } = await params;
    const acct = await loadAccountForCheck(id);
    if (!acct) return bad('OpenAI account not found', 404);
    return ok(await checkOpenAiAccount(acct));
  });
}
