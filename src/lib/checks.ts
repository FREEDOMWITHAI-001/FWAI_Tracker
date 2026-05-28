import type { SupabaseClient } from '@supabase/supabase-js';
import { probe, probePort, type ProbeResult } from '@/lib/healthcheck';
import type { VM, App } from '@/lib/types';

type CheckTarget = Pick<VM, 'id' | 'host' | 'port' | 'health_url'>;

// Probe one VM, update its current row, and append a metric sample.
// Primary check is TCP host:port; if no port is set it falls back to the
// HTTP Health URL (which can additionally report cpu/mem/disk).
export async function checkVm(db: SupabaseClient, vm: CheckTarget) {
  let r: ProbeResult;
  if (vm.host && vm.port) {
    r = await probePort(vm.host, vm.port);
  } else if (vm.health_url) {
    r = await probe(vm.health_url);
  } else {
    return { skipped: true as const, vm_id: vm.id };
  }

  // "Down only after 2 consecutive misses": a single failed probe is shown as
  // a warning, not down, so one cold-start/blip doesn't flip the badge. We look
  // at the most recent prior sample (recorded below) to decide.
  let displayStatus = r.status;
  if (r.status === 'down') {
    const { data: last } = await db
      .from('vm_metrics')
      .select('status')
      .eq('vm_id', vm.id)
      .order('checked_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!last || last.status !== 'down') displayStatus = 'warning'; // first miss
  }

  const patch: Record<string, unknown> = {
    status: displayStatus,
    last_checked_at: new Date().toISOString(),
    last_response_ms: r.response_ms,
  };
  if (r.cpu != null) patch.cpu = r.cpu;
  if (r.mem != null) patch.mem = r.mem;
  if (r.disk != null) patch.disk = r.disk;

  const { data: updated } = await db.from('vms').update(patch).eq('id', vm.id).select().single();

  // record the true probe result in history (so misses still show on the graph)
  await db.from('vm_metrics').insert({
    vm_id: vm.id,
    status: r.status,
    response_ms: r.response_ms,
    cpu: r.cpu,
    mem: r.mem,
    disk: r.disk,
  });

  return { skipped: false as const, vm_id: vm.id, result: r, vm: updated };
}

type AppCheckTarget = Pick<App, 'id' | 'check_url' | 'check_host' | 'check_port'>;

// Probe one application by host:port (preferred) or URL, update its row, and
// append a response-time sample. Apps have no CPU/mem/disk.
export async function checkApp(db: SupabaseClient, app: AppCheckTarget) {
  let r: ProbeResult;
  if (app.check_host && app.check_port) {
    r = await probePort(app.check_host, app.check_port);
  } else if (app.check_url) {
    r = await probe(app.check_url);
  } else {
    return { skipped: true as const, app_id: app.id };
  }

  // Down only after 2 consecutive misses (see checkVm for rationale).
  let displayStatus = r.status;
  if (r.status === 'down') {
    const { data: last } = await db
      .from('app_metrics')
      .select('status')
      .eq('app_id', app.id)
      .order('checked_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!last || last.status !== 'down') displayStatus = 'warning'; // first miss
  }

  await db
    .from('apps')
    .update({
      status: displayStatus,
      resp_ms: r.response_ms ?? 0,
      health: r.detail,
      last_checked_at: new Date().toISOString(),
      last_response_ms: r.response_ms,
    })
    .eq('id', app.id);

  // record the true probe result in history
  await db.from('app_metrics').insert({ app_id: app.id, status: r.status, response_ms: r.response_ms });

  return { skipped: false as const, app_id: app.id, result: r };
}