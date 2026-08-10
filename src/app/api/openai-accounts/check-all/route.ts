import { ok, guard } from '@/lib/api';
import { syncOpenAiCredits } from '@/lib/openai-credits';

export const runtime = 'nodejs';
export const maxDuration = 120;

// POST /api/openai-accounts/check-all (GET also works)
// Refresh every account's usage and fire any low-credit alerts. Same shape as
// /api/vms/check-all and /api/cloud-accounts/sync-all so an external scheduler
// can drive it the same way.
async function run() {
  return guard(async () => {
    const started = Date.now();
    const { checked } = await syncOpenAiCredits();
    return ok({ checked, ms: Date.now() - started });
  });
}

export const POST = run;
export const GET = run;
