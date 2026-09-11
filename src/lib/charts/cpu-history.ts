import type { CpuPoint } from '$lib/types/api';
import { observedHistory, observedStats } from './observed-history';
export type { ObservedBucket } from './observed-history';
export const cpuUsageHistory = (points: CpuPoint[]) =>
	observedHistory(points, 'usage_percent', (p) => p.usage_percent);
export const cpuUsageStats = (points: CpuPoint[]) =>
	observedStats(points, 'usage_percent', (p) => p.usage_percent);
