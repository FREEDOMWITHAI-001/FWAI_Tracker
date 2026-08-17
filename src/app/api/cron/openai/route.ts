import { ok, guard, requireCronSecret } from '@/lib/api';
import { runOpenAiChecks } from '@/lib/openai-check';

export const runtime = 'nodejs';
export const maxDuration = 60;

// GET /api/cron/openai
//
// The scheduled OpenAI credit check. Called FOUR TIMES A DAY — 10:00, 13:00,
// 18:00 and 22:00 Asia/Kolkata — by an external cron-job.org job, which sends
// the same "Authorization: Bearer <CRON_SECRET>" header as the monitoring
// workflow. cron-job.org rather than Vercel Cron because this project is on
// Vercel's Hobby plan, which allows one cron execution per day with ±59 minutes
// of imprecision; and rather than a second GitHub Actions workflow because
// GitHub disables scheduled workflows on repos that go quiet.
//
// SEPARATE FROM /api/cron/check-all ON PURPOSE. That route is the 5-minute VM
// and app tick, and each OpenAI check is a real billable request — running them
// on the same schedule cost 288 probes per project per day. Keeping them apart
// means the cadences cannot be coupled again by accident, neither can eat the
// other's 60-second budget, and this endpoint's response says only whether the
// credit check worked, which is what cron-job.org's execution log shows.
//
// CALLING IT MORE OFTEN DOES NOT PROBE MORE OFTEN. runOpenAiChecks claims each
// project for MIN_CHECK_INTERVAL_MS inside the same UPDATE that selects it, so
// the spend is capped in SQL no matter who calls this or how often. The WhatsApp
// rate is capped separately again by the per-recipient latch in handleAlert.
export async function GET(req: Request) {
  return guard(async () => {
    const refused = requireCronSecret(req, 'cron:openai');
    if (refused) return refused;

    const started = Date.now();
    let checked = 0;
    let claimed = 0;
    let openaiOk = true;
    try {
      const r = await runOpenAiChecks();
      checked = r.checked;
      claimed = r.claimed;
    } catch (e: any) {
      openaiOk = false;
      console.error('[cron:openai] check failed', e?.message);
    }

    return ok({
      // `openai_checked: 0` is the normal state for a call that arrives inside
      // MIN_CHECK_INTERVAL_MS of the last one — it means nothing was due, not
      // that anything failed. `openai_ok` is the field that reports failure.
      openai_checked: checked,
      openai_claimed: claimed,
      openai_ok: openaiOk,
      ms: Date.now() - started,
    });
  });
}
