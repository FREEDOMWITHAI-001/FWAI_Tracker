import type { SupabaseClient } from '@supabase/supabase-js';
import { probe, probePort, type ProbeResult } from '@/lib/healthcheck';
import { collectSshMetrics, sshPortCheck } from '@/lib/ssh-metrics';
import { decrypt } from '@/lib/crypto';
import type { VM, App } from '@/lib/types';

type CheckTarget = Pick<VM, 'id' | 'host' | 'port' | 'health_url'> & {
  ssh_user?: string | null;
  ssh_port?: number | null;
  ssh_key_encrypted?: string | null;
  ssh_pass_encrypted?: string | null;
};

// Probe one VM, update its current row, and append a metric sample.
// Order: SSH (CPU/mem/disk) > TCP host:port (reachability) > HTTP Health URL.
export async function checkVm(db: SupabaseClient, vm: CheckTarget) {
  let r: ProbeResult;
  if (vm.ssh_user && vm.host && vm.ssh_key_encrypted) {
    try {
      const m = await collectSshMetrics({
        host: vm.host,
        port: vm.ssh_port || 22,
        username: vm.ssh_user,
        privateKey: decrypt(vm.ssh_key_encrypted),
        passphrase: vm.ssh_pass_encrypted ? decrypt(vm.ssh_pass_encrypted) : undefined,
      });
      const worst = Math.max(m.cpu ?? 0, m.mem ?? 0, m.disk ?? 0);
      const status = !m.reachable ? 'down' : worst >= 90 ? 'warning' : 'healthy';
      r = { status, response_ms: null, cpu: m.cpu, mem: m.mem, disk: m.disk, detail: m.detail };
    } catch (e) {
      r = { status: 'down', response_ms: null, cpu: null, mem: null, disk: null, detail: e instanceof Error ? e.message : 'ssh error' };
    }
  } else if (vm.host && vm.port) {
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

type AppCheckTarget = Pick<App, 'id' | 'check_url' | 'check_host' | 'check_port'> & {
  vm_id?: string | null;
};

// Probe one application. Preference order:
//   1) If linked to a VM that has SSH set up and the app has a port → tunnel
//      through that VM's SSH and check the port on the VM's localhost.
//      (Lets app ports stay closed to the public internet.)
//   2) Else external host:port TCP probe.
//   3) Else HTTP URL probe.
export async function checkApp(db: SupabaseClient, app: AppCheckTarget) {
  let r: ProbeResult | undefined;

  // 1) SSH tunnel via parent VM (preferred — keeps app ports off the public internet).
  if (app.vm_id && app.check_port) {
    const { data: host } = await db
      .from('vms')
      .select('host,ssh_user,ssh_port,ssh_key_encrypted,ssh_pass_encrypted')
      .eq('id', app.vm_id)
      .single();
    if (host?.host && host.ssh_user && host.ssh_key_encrypted) {
      try {
        const pr = await sshPortCheck(
          {
            host: host.host,
            port: host.ssh_port || 22,
            username: host.ssh_user,
            privateKey: decrypt(host.ssh_key_encrypted),
            passphrase: host.ssh_pass_encrypted ? decrypt(host.ssh_pass_encrypted) : undefined,
          },
          app.check_port,
        );
        const status: ProbeResult['status'] = !pr.reachable ? 'down' : pr.response_ms > 1500 ? 'warning' : 'healthy';
        r = { status, response_ms: pr.response_ms || null, cpu: null, mem: null, disk: null, detail: pr.detail };
      } catch (e) {
        r = { status: 'down', response_ms: null, cpu: null, mem: null, disk: null, detail: e instanceof Error ? e.message : 'ssh error' };
      }
    }
  }

  // 2) External fallbacks (TCP host:port, then HTTP URL).
  if (!r) {
    if (app.check_host && app.check_port) r = await probePort(app.check_host, app.check_port);
    else if (app.check_url) r = await probe(app.check_url);
    else return { skipped: true as const, app_id: app.id };
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