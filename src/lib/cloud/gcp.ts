import { InstancesClient } from '@google-cloud/compute';
import { MetricServiceClient } from '@google-cloud/monitoring';
import type { CloudAdapter, VM, MetricSeries, MetricKind } from './types';

interface GCPCreds {
  type: 'service_account';
  project_id: string;
  client_email: string;
  private_key: string;
  token_uri?: string;
  [k: string]: unknown;
}

function parseCreds(creds: string): GCPCreds {
  return JSON.parse(creds);
}

function zoneToRegion(zoneUrl: string): { zone: string; region: string } {
  const zone = zoneUrl.split('/').pop() || '';
  const region = zone.replace(/-[a-z]$/, '');
  return { zone, region };
}

const METRIC_MAP: Record<MetricKind, { type: string; unit: string; reducer: 'REDUCE_MEAN' | 'REDUCE_SUM'; aligner: 'ALIGN_MEAN' | 'ALIGN_RATE'; scale?: number }> = {
  cpu_util:         { type: 'compute.googleapis.com/instance/cpu/utilization',        unit: 'percent',     reducer: 'REDUCE_MEAN', aligner: 'ALIGN_MEAN' },
  mem_util:         { type: 'agent.googleapis.com/memory/percent_used',               unit: 'percent',     reducer: 'REDUCE_MEAN', aligner: 'ALIGN_MEAN', scale: 0.01 },
  disk_read_bytes:  { type: 'compute.googleapis.com/instance/disk/read_bytes_count',  unit: 'bytes/s',     reducer: 'REDUCE_SUM',  aligner: 'ALIGN_RATE' },
  disk_write_bytes: { type: 'compute.googleapis.com/instance/disk/write_bytes_count', unit: 'bytes/s',     reducer: 'REDUCE_SUM',  aligner: 'ALIGN_RATE' },
  net_in_bytes:     { type: 'compute.googleapis.com/instance/network/received_bytes_count', unit: 'bytes/s', reducer: 'REDUCE_SUM', aligner: 'ALIGN_RATE' },
  net_out_bytes:    { type: 'compute.googleapis.com/instance/network/sent_bytes_count', unit: 'bytes/s',   reducer: 'REDUCE_SUM',  aligner: 'ALIGN_RATE' },
};

export const gcpAdapter: CloudAdapter = {
  async listVMs(accountId, credsStr): Promise<VM[]> {
    const creds = parseCreds(credsStr);
    const client = new InstancesClient({ credentials: creds, projectId: creds.project_id });
    const out: VM[] = [];
    const iterable = client.aggregatedListAsync({ project: creds.project_id });
    for await (const [zoneKey, scoped] of iterable) {
      const instances = scoped.instances || [];
      for (const inst of instances) {
        const { zone, region } = zoneToRegion(inst.zone || zoneKey);
        const machineType = (inst.machineType || '').split('/').pop() || '';
        const nic = inst.networkInterfaces?.[0];
        const accessConfig = nic?.accessConfigs?.[0];
        const tags: Record<string, string> = {};
        if (inst.labels) for (const [k, v] of Object.entries(inst.labels)) tags[k] = v as string;
        out.push({
          cloud: 'gcp',
          accountId,
          id: String(inst.id),
          name: inst.name || '',
          region,
          zone,
          machineType,
          status: inst.status || 'UNKNOWN',
          publicIp: accessConfig?.natIP || undefined,
          privateIp: nic?.networkIP || undefined,
          tags,
          consoleUrl: `https://console.cloud.google.com/compute/instancesDetail/zones/${zone}/instances/${inst.name}?project=${creds.project_id}`,
        });
      }
    }
    return out;
  },

  async getMetrics(_accountId, credsStr, _vmId, vmContext, kind, startMs, endMs): Promise<MetricSeries> {
    const creds = parseCreds(credsStr);
    const client = new MetricServiceClient({ credentials: creds, projectId: creds.project_id });
    const m = METRIC_MAP[kind];
    const filter = `metric.type="${m.type}" AND metric.label.instance_name="${vmContext.name}"`;
    const alignmentSec = Math.max(60, Math.floor((endMs - startMs) / 1000 / 240));
    const [series] = await client.listTimeSeries({
      name: `projects/${creds.project_id}`,
      filter,
      interval: {
        startTime: { seconds: Math.floor(startMs / 1000) },
        endTime: { seconds: Math.floor(endMs / 1000) },
      },
      aggregation: {
        alignmentPeriod: { seconds: alignmentSec },
        perSeriesAligner: m.aligner,
        crossSeriesReducer: m.reducer,
        groupByFields: ['metric.label.instance_name'],
      },
    });
    const points: { t: number; v: number }[] = [];
    if (series && series[0]?.points) {
      for (const p of series[0].points) {
        const ts = Number(p.interval?.endTime?.seconds || 0) * 1000;
        let val = p.value?.doubleValue ?? p.value?.int64Value ?? 0;
        if (m.scale) val = Number(val) * m.scale;
        points.push({ t: ts, v: Number(val) });
      }
      points.sort((a, b) => a.t - b.t);
    }
    return { name: kind, unit: m.unit, points };
  },
};
