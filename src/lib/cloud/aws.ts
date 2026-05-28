import { EC2Client, DescribeInstancesCommand } from '@aws-sdk/client-ec2';
import { CloudWatchClient, GetMetricDataCommand } from '@aws-sdk/client-cloudwatch';
import type { CloudAdapter, VM, MetricSeries, MetricKind } from './types';

interface AWSCreds {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  region: string;
  regions?: string[] | string; // optional: scan these instead of just `region`
}

function parseCreds(creds: string): AWSCreds {
  return JSON.parse(creds);
}

const METRIC_MAP: Record<MetricKind, { name: string; namespace: string; unit: string; stat: string }> = {
  cpu_util:         { name: 'CPUUtilization',     namespace: 'AWS/EC2', unit: 'percent', stat: 'Average' },
  mem_util:         { name: 'mem_used_percent',   namespace: 'CWAgent', unit: 'percent', stat: 'Average' },
  disk_read_bytes:  { name: 'DiskReadBytes',      namespace: 'AWS/EC2', unit: 'bytes/s', stat: 'Sum' },
  disk_write_bytes: { name: 'DiskWriteBytes',     namespace: 'AWS/EC2', unit: 'bytes/s', stat: 'Sum' },
  net_in_bytes:     { name: 'NetworkIn',          namespace: 'AWS/EC2', unit: 'bytes/s', stat: 'Sum' },
  net_out_bytes:    { name: 'NetworkOut',         namespace: 'AWS/EC2', unit: 'bytes/s', stat: 'Sum' },
};

export const awsAdapter: CloudAdapter = {
  async listVMs(accountId, credsStr): Promise<VM[]> {
    const creds = parseCreds(credsStr);
    const baseCreds = {
      accessKeyId: creds.accessKeyId,
      secretAccessKey: creds.secretAccessKey,
      ...(creds.sessionToken ? { sessionToken: creds.sessionToken } : {}),
    };
    // Scan the configured region only (avoids opening ~30 parallel connections,
    // which causes "socket hang up" on serverless hosts and is usually slow).
    // Set creds.regions (array or comma list) to scan more than one.
    const regions: string[] =
      creds.regions && (Array.isArray(creds.regions) ? creds.regions.length : String(creds.regions).trim())
        ? Array.isArray(creds.regions)
          ? creds.regions
          : String(creds.regions).split(',').map((s) => s.trim()).filter(Boolean)
        : [creds.region];

    const out: VM[] = [];
    for (const region of regions) {
      const client = new EC2Client({ credentials: baseCreds, region });
      try {
        const resp = await client.send(new DescribeInstancesCommand({}));
        for (const res of resp.Reservations || []) {
          for (const inst of res.Instances || []) {
            const nameTag = (inst.Tags || []).find((t) => t.Key === 'Name')?.Value || '';
            const tags: Record<string, string> = {};
            for (const t of inst.Tags || []) if (t.Key && t.Value) tags[t.Key] = t.Value;
            out.push({
              cloud: 'aws',
              accountId,
              id: inst.InstanceId!,
              name: nameTag || inst.InstanceId!,
              region,
              zone: inst.Placement?.AvailabilityZone,
              machineType: inst.InstanceType || 'unknown',
              status: inst.State?.Name || 'unknown',
              publicIp: inst.PublicIpAddress,
              privateIp: inst.PrivateIpAddress,
              tags,
              consoleUrl: `https://${region}.console.aws.amazon.com/ec2/home?region=${region}#InstanceDetails:instanceId=${inst.InstanceId}`,
            });
          }
        }
      } catch (e) {
        // With a single region, surface the real error; with several, skip the bad one.
        if (regions.length === 1) throw e;
      }
    }
    return out;
  },

  async getMetrics(_accountId, credsStr, vmId, vmContext, kind, startMs, endMs): Promise<MetricSeries> {
    const creds = parseCreds(credsStr);
    const region = vmContext.region || creds.region;
    const cw = new CloudWatchClient({
      credentials: { accessKeyId: creds.accessKeyId, secretAccessKey: creds.secretAccessKey },
      region,
    });
    const m = METRIC_MAP[kind];
    const period = Math.max(60, Math.floor((endMs - startMs) / 1000 / 240));
    const resp = await cw.send(new GetMetricDataCommand({
      StartTime: new Date(startMs),
      EndTime: new Date(endMs),
      ScanBy: 'TimestampAscending',
      MetricDataQueries: [{
        Id: 'q1',
        MetricStat: {
          Metric: {
            Namespace: m.namespace,
            MetricName: m.name,
            Dimensions: [{ Name: 'InstanceId', Value: vmId }],
          },
          Period: period,
          Stat: m.stat,
        },
        ReturnData: true,
      }],
    }));
    const result = resp.MetricDataResults?.[0];
    const ts = result?.Timestamps || [];
    const vals = result?.Values || [];
    const points = ts.map((t, i) => ({
      t: t.getTime(),
      v: kind.includes('bytes') ? (vals[i] / period) : (kind === 'cpu_util' ? vals[i] / 100 : vals[i]),
    }));
    return { name: kind, unit: m.unit, points };
  },
};