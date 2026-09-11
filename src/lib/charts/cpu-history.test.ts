import { describe, expect, test } from 'bun:test';
import { cpuUsageHistory, cpuUsageStats } from './cpu-history';
import type { CpuPoint } from '$lib/types/api';

const point = (timestamp: number, extra: Partial<CpuPoint> = {}): CpuPoint => ({
	timestamp,
	bucket_seconds: 0,
	statistics: null,
	usage_percent: 10,
	load_1m: 0,
	load_5m: 0,
	load_15m: 0,
	...extra
});

describe('CPU observed ranges', () => {
	test('summary weights samples and never estimates percentiles from rollup means', () => {
		const result = cpuUsageStats([
			point(0, {
				bucket_seconds: 60,
				statistics: { usage_percent: { min: 10, max: 10, sum: 300, valid_count: 30 } }
			}),
			point(60, {
				usage_percent: 100,
				bucket_seconds: 60,
				statistics: { usage_percent: { min: 100, max: 100, sum: 100, valid_count: 1 } }
			})
		]);
		expect(result.avg).toBe(400 / 31);
		expect(result.max).toBe(100);
		expect(result.p95).toBeNull();
		expect(cpuUsageStats([point(0)]).max).toBeNull();
	});
	test('keeps the peak independent of the mean and extends the last bucket', () => {
		const result = cpuUsageHistory([
			point(0, {
				bucket_seconds: 60,
				statistics: {
					usage_percent: { min: 1, max: 100, sum: 300, valid_count: 30 }
				}
			})
		]);
		expect(result.data).toEqual({ xs: [0, 60], ys: [10, 10] });
		expect(result.buckets[0]).toEqual({ start: 0, end: 60, min: 1, max: 100, count: 30 });
	});
	test('does not infer an envelope from legacy means', () => {
		const result = cpuUsageHistory([point(0, { bucket_seconds: 60, statistics: null })]);
		expect(result.buckets[0]?.min).toBeNull();
		expect(result.buckets[0]?.max).toBeNull();
	});
	test('inserts a real gap without extending the previous range', () => {
		const result = cpuUsageHistory([
			point(0, { bucket_seconds: 60 }),
			point(180, { bucket_seconds: 60 })
		]);
		expect(result.data.xs).toEqual([0, 60, 60, 180, 240]);
		expect(Number.isNaN(result.data.ys[2])).toBe(true);
		expect(result.buckets[2]).toBeNull();
	});
	test('raw observations keep their timestamps', () => {
		const result = cpuUsageHistory([point(0), point(2, { bucket_seconds: 0 })]);
		expect(result.data.xs).toEqual([0, 2]);
		expect(result.buckets).toEqual([null, null]);
	});
});
