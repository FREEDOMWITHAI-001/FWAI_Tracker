import { ClientSecretCredential } from '@azure/identity';
import { ComputeManagementClient } from '@azure/arm-compute';
import { MonitorClient } from '@azure/arm-monitor';
import type { CloudAdapter, VM, MetricSeries, MetricKind } from './types';

interface AzureCreds {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  subscriptionId: string;
}

function parseCreds(creds: string): AzureCreds {
  return JSON.parse(creds);
}

const METRIC_MAP: Record<MetricKind, { name: string; unit: string; agg: 'Average' | 'Total'; transform?: (v: number) => number }> = {
  cpu_util:         { name: 'Percentage CPU',          unit: 'percent', agg: 'Average', transform: v => v / 100 },
  mem_util:         { name: 'Available Memory Bytes',  unit: 'percent', agg: 'Average' },
  disk_read_bytes:  { name: 'Disk Read Bytes',         unit: 'bytes/s', agg: 'Total' },
  disk_write_bytes: { name: 'Disk Write Bytes',        unit: 'bytes/s', agg: 'Total' },
  net_in_bytes:     { name: 'Network In Total',        unit: 'bytes/s', agg: 'Total' },
  net_out_bytes:    { name: 'Network Out Total',       unit: 'bytes/s', agg: 'Total' },
};

function credFor(c: AzureCreds) {
  return new ClientSecretCredential(c.tenantId, c.clientId, c.clientSecret);
}

export const azureAdapter: CloudAdapter = {
  async listVMs(accountId, credsStr): Promise<VM[]> {
    const c = parseCreds(credsStr);
    const compute = new ComputeManagementClient(credFor(c), c.subscriptionId);
    const out: VM[] = [];
    for await (const vm of compute.virtualMachines.listAll({ statusOnly: 'true' })) {
      const region = vm.location || 'unknown';
      const machineType = vm.hardwareProfile?.vmSize || 'unknown';
      const id = vm.id || '';
      const name = vm.name || '';
      const statuses = vm.instanceView?.statuses || [];
      const ps = statuses.find(s => s.code?.startsWith('PowerState/'));
      const status = ps?.code?.replace('PowerState/', '') || 'unknown';
      const tags: Record<string, string> = {};
      if (vm.tags) for (const [k, v] of Object.entries(vm.tags)) tags[k] = v;
      out.push({
        cloud: 'azure',
        accountId,
        id,
        name,
        region,
        machineType,
        status,
        tags,
        consoleUrl: `https://portal.azure.com/#@${c.tenantId}/resource${id}/overview`,
      });
    }
    return out;
  },

  async getMetrics(_accountId, credsStr, vmId, _vmContext, kind, startMs, endMs): Promise<MetricSeries> {
    const c = parseCreds(credsStr);
    const monitor = new MonitorClient(credFor(c), c.subscriptionId);
    const m = METRIC_MAP[kind];
    const intervalMin = Math.max(1, Math.floor((endMs - startMs) / 60_000 / 240));
    const interval = `PT${intervalMin}M`;
    const timespan = `${new Date(startMs).toISOString()}/${new Date(endMs).toISOString()}`;
    const resp = await monitor.metrics.list(vmId, {
      timespan,
      interval,
      metricnames: m.name,
      aggregation: m.agg,
    });
    const series = resp.value?.[0]?.timeseries?.[0]?.data || [];
    const periodSec = intervalMin * 60;
    const points = series
      .filter(d => d.timeStamp)
      .map(d => {
        const raw = m.agg === 'Average' ? d.average : d.total;
        let val = raw == null ? 0 : raw;
        if (m.transform) val = m.transform(val);
        if (kind.includes('bytes')) val = val / periodSec;
        return { t: new Date(d.timeStamp!).getTime(), v: val };
      });
    return { name: kind, unit: m.unit, points };
  },
};
