import * as common from 'oci-common';
import * as core from 'oci-core';
import * as monitoring from 'oci-monitoring';
import type { CloudAdapter, VM, MetricSeries, MetricKind } from './types';

// OCI uses API signing-key auth. We store these five (privateKey is the secret):
interface OCICreds {
  tenancyId: string;
  userId: string;
  fingerprint: string;
  privateKey: string; // PEM text
  region: string; // e.g. ap-mumbai-1
  compartmentId?: string; // defaults to the tenancy (root compartment)
  passphrase?: string; // optional key passphrase
}

function parseCreds(creds: string): OCICreds {
  return JSON.parse(creds);
}

function makeProvider(c: OCICreds) {
  return new common.SimpleAuthenticationDetailsProvider(
    c.tenancyId,
    c.userId,
    c.fingerprint,
    c.privateKey,
    c.passphrase ?? null,
    common.Region.fromRegionId(c.region)
  );
}

export const ociAdapter: CloudAdapter = {
  async listVMs(accountId, credsStr): Promise<VM[]> {
    const creds = parseCreds(credsStr);
    const compartmentId = creds.compartmentId || creds.tenancyId;
    const provider = makeProvider(creds);
    const compute = new core.ComputeClient({ authenticationDetailsProvider: provider });

    const out: VM[] = [];
    let page: string | undefined;
    do {
      const resp = await compute.listInstances({ compartmentId, page, limit: 100 });
      for (const inst of resp.items || []) {
        out.push({
          cloud: 'oci' as any,
          accountId,
          id: inst.id,
          name: inst.displayName || inst.id,
          region: inst.region || creds.region,
          zone: inst.availabilityDomain,
          machineType: inst.shape || 'unknown',
          status: inst.lifecycleState || 'unknown',
          consoleUrl: `https://cloud.oracle.com/compute/instances/${inst.id}?region=${creds.region}`,
        });
      }
      page = resp.opcNextPage;
    } while (page);

    return out;
  },

  async getMetrics(_accountId, credsStr, vmId, _vmContext, kind, startMs, endMs): Promise<MetricSeries> {
    const creds = parseCreds(credsStr);
    const compartmentId = creds.compartmentId || creds.tenancyId;
    const provider = makeProvider(creds);
    const mon = new monitoring.MonitoringClient({ authenticationDetailsProvider: provider });

    // We only support CPU here (OCI computeagent). mem/disk need the agent too.
    const metricName = kind === 'cpu_util' ? 'CpuUtilization' : 'CpuUtilization';

    const resp = await mon.summarizeMetricsData({
      compartmentId,
      summarizeMetricsDataDetails: {
        namespace: 'oci_computeagent',
        query: `${metricName}[1m]{resourceId = "${vmId}"}.mean()`,
        startTime: new Date(startMs),
        endTime: new Date(endMs),
      },
    });

    const item = resp.items?.[0];
    const dps = item?.aggregatedDatapoints || [];
    const points = dps.map((d) => ({
      t: new Date(d.timestamp as any).getTime(),
      // OCI returns CPU as a 0..100 percent; the sync layer expects a 0..1 fraction
      v: (d.value ?? 0) / 100,
    }));
    return { name: kind, unit: 'percent', points };
  },
};