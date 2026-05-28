import type { CloudAdapter, Cloud } from './types';
import { gcpAdapter } from './gcp';
import { awsAdapter } from './aws';
import { azureAdapter } from './azure';
import { ociAdapter } from './oci';

export const adapters: Record<Cloud, CloudAdapter> = {
  gcp: gcpAdapter,
  aws: awsAdapter,
  azure: azureAdapter,
  oci: ociAdapter,
};

export type { Cloud, CloudAdapter, VM, MetricSeries, MetricKind, MetricPoint } from './types';