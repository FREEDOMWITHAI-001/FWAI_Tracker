import type { SupabaseClient } from '@supabase/supabase-js';
import { adapters, type Cloud } from '@/lib/cloud';
import { decrypt } from '@/lib/crypto';
import type { Status } from '@/lib/types';

const PROVIDER_LABEL: Record<Cloud, string> = {
  aws: 'AWS EC2',
  azure: 'Azure VM',
  gcp: 'GCP CE',
};

// Map each provider's raw instance state to our healthy/warning/down model.
function mapStatus(cloud: Cloud, raw: string): Status {
  const s = (raw || '').toLowerCase();
  if (s.includes('run')) return 'healthy';
  const transitional = ['pending', 'starting', 'stopping', 'shutting-down', 'provisioning', 'staging', 'deallocating', 'repairing'];
  if (transitional.some((t) => s.includes(t))) return 'warning';
  return 'down'; // stopped / terminated / deallocated / suspended / unknown
}

export interface CloudAccountRow {
  id: string;
  client_id: string;
  provider: Cloud;
  credentials_encrypted: string;
}

// Probe one cloud account: list its instances, best-effort current CPU, and
// upsert each as a VM under the account's client. Records sync status on the
// account row. Throws only on a hard failure (e.g. bad credentials).
export async function syncCloudAccount(db: SupabaseClient, acct: CloudAccountRow) {
  const cloud = acct.provider;
  const adapter = adapters[cloud];
  let creds: string;
  try {
    creds = decrypt(acct.credentials_encrypted);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'cannot decrypt credentials';
    await db.from('cloud_accounts').update({ last_sync_error: msg }).eq('id', acct.id);
    throw e;
  }

  let instances;
  try {
    instances = await adapter.listVMs(acct.id, creds);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'provider list failed';
    await db.from('cloud_accounts').update({ last_sync_error: msg }).eq('id', acct.id);
    throw e;
  }

  const end = Date.now();
  const start = end - 15 * 60 * 1000;

  let imported = 0;
  for (const vm of instances) {
    let cpu = 0;
    try {
      const series = await adapter.getMetrics(
        acct.id,
        creds,
        vm.id,
        { name: vm.name, region: vm.region, zone: vm.zone },
        'cpu_util',
        start,
        end
      );
      const last = series.points.at(-1);
      // adapters return cpu_util as a 0..1 fraction
      if (last) cpu = Math.round(Math.max(0, Math.min(1, last.v)) * 100);
    } catch {
      /* metrics are best-effort — leave cpu at 0 if unavailable */
    }

    const status = mapStatus(cloud, vm.status);
    const upsertRow: Record<string, unknown> = {
      client_id: acct.client_id,
      cloud_account_id: acct.id,
      external_id: vm.id,
      source: 'cloud',
      name: vm.name || vm.id,
      provider: PROVIDER_LABEL[cloud],
      region: vm.region,
      status,
      cpu,
      uptime_label: vm.status,
    };
    // Auto-fill the host with the instance's public IP so it can also be
    // port-checked for response time. (Port is left untouched — set it once
    // in the VM editor.) Only set when the provider reports a public IP.
    if (vm.publicIp) upsertRow.host = vm.publicIp;

    const { data: row } = await db
      .from('vms')
      .upsert(upsertRow, { onConflict: 'cloud_account_id,external_id' })
      .select('id')
      .single();

    // append a history point so the CPU graph builds up over repeated syncs
    if (row?.id) {
      await db.from('vm_metrics').insert({ vm_id: row.id, status, response_ms: null, cpu, mem: null, disk: null });
    }
    imported++;
  }

  await db
    .from('cloud_accounts')
    .update({ last_synced_at: new Date().toISOString(), last_sync_error: null })
    .eq('id', acct.id);

  return { imported };
}