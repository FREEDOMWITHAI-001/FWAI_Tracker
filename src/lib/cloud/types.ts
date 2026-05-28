export type Cloud = 'gcp' | 'aws' | 'azure';

export interface VM {
  cloud: Cloud;
  accountId: string;
  id: string;
  name: string;
  region: string;
  zone?: string;
  machineType: string;
  status: string;
  publicIp?: string;
  privateIp?: string;
  tags?: Record<string, string>;
  consoleUrl?: string;
}

export interface MetricPoint {
  t: number;
  v: number;
}

export interface MetricSeries {
  name: string;
  unit: string;
  points: MetricPoint[];
}

export type MetricKind =
  | 'cpu_util'
  | 'mem_util'
  | 'disk_read_bytes'
  | 'disk_write_bytes'
  | 'net_in_bytes'
  | 'net_out_bytes';

export interface CloudAdapter {
  listVMs(accountId: string, creds: string): Promise<VM[]>;
  getMetrics(
    accountId: string,
    creds: string,
    vmId: string,
    vmContext: Pick<VM, 'name' | 'region' | 'zone'>,
    kind: MetricKind,
    startMs: number,
    endMs: number
  ): Promise<MetricSeries>;
}
