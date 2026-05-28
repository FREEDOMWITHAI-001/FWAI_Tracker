import type { CloudAdapter, Cloud } from './types';
import { gcpAdapter } from './gcp';
import { awsAdapter } from './aws';
import { azureAdapter } from './azure';

export const adapters: Record<Cloud, CloudAdapter> = {
  gcp: gcpAdapter,
  aws: awsAdapter,
  azure: azureAdapter,
};

export type { Cloud, CloudAdapter, VM, MetricSeries, MetricKind, MetricPoint } from './types';
