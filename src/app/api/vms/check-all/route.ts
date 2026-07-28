import { sql } from '@/lib/db';
import { ok, guard } from '@/lib/api';
import { checkVm } from '@/lib/checks';

export const runtime = 'nodejs';
export const maxDuration = 30;

// POST /api/vms/check-all -> probe every VM that has SSH, a host:port or a
// health_url, in parallel. Used by the manual "Check now" button and the page
// auto-poll.
//
// This does NOT send alerts — that is /api/cron/check-all's job, so there is one
// place responsible for notifications.
//
// The SSH columns have to be selected AND matched: this endpoint previously
// filtered on `port or health_url` only, so on an all-SSH fleet it matched zero
// rows and "Check now" silently did nothing.
export async function POST() {
  return guard(async () => {
    const vms = await sql<{
      id: string;
      host: string | null;
      port: number | null;
      health_url: string | null;
      ssh_user: string | null;
      ssh_port: number | null;
      ssh_key_encrypted: string | null;
      ssh_pass_encrypted: string | null;
    }>(
      `select id, host, port, health_url, ssh_user, ssh_port, ssh_key_encrypted, ssh_pass_encrypted
         from vms
        where port is not null or health_url is not null or ssh_key_encrypted is not null`
    );
    const results = await Promise.all(vms.map((vm) => checkVm(vm)));
    const checked = results.filter((r) => !r.skipped).length;
    return ok({ checked, total: vms.length });
  });
}

export const GET = POST; // allow cron/uptime pings via GET too
