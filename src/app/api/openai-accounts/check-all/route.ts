import { ok, guard } from '@/lib/api';
import { runManualOpenAiChecks } from '@/lib/openai-check';

export const runtime = 'nodejs';
export const maxDuration = 120;

// POST /api/openai-accounts/check-all (GET also works)
// The UI's "Check now" for the whole list. Forced — it ignores the claim, its
// interval and each project's daily_check_enabled, because an operator pressing
// a button is not the scheduler. The automatic run is a different entry point
// entirely: /api/cron/check-all, on the 5-minute monitoring cron.
async function run() {
  return guard(async () => {
    const started = Date.now();
    const { checked } = await runManualOpenAiChecks();
    return ok({ checked, ms: Date.now() - started });
  });
}

export const POST = run;
export const GET = run;
