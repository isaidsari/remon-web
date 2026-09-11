import { expect, test } from 'bun:test';
import { observedHistory, observedStats } from './observed-history';

test('integer storage does not round the plotted rollup mean', () => {
	const points = [
		{
			timestamp: 0,
			bucket_seconds: 60,
			value: 0,
			statistics: { value: { min: 0, max: 1, sum: 1, valid_count: 2 } }
		}
	];
	const series = observedHistory(points, 'value', (p) => p.value);
	expect(series.data.ys).toEqual([0.5, 0.5]);
	expect(series.summary.current).toBe(0.5);
});

test('per-field counts exclude missing observations without converting them to zero', () => {
	const points = [
		{
			timestamp: 0,
			bucket_seconds: 60,
			value: 100,
			statistics: { value: { min: 100, max: 100, sum: 100, valid_count: 1 } }
		},
		{
			timestamp: 60,
			bucket_seconds: 60,
			value: null,
			statistics: { value: { min: null, max: null, sum: 0, valid_count: 0 } }
		},
		{
			timestamp: 120,
			bucket_seconds: 60,
			value: 0,
			statistics: { value: { min: 0, max: 0, sum: 0, valid_count: 30 } }
		}
	];
	expect(observedStats(points, 'value', (p) => p.value)).toEqual({
		current: 0,
		avg: 100 / 31,
		min: 0,
		max: 100,
		p95: null
	});
	expect(Number.isNaN(observedHistory(points, 'value', (p) => p.value).data.ys[1])).toBe(true);
});

test('repeated endpoint is only geometry and cannot bias a summary', () => {
	const points = [
		{
			timestamp: 0,
			bucket_seconds: 60,
			value: 5,
			statistics: { value: { min: 0, max: 100, sum: 10, valid_count: 2 } }
		}
	];
	const series = observedHistory(points, 'value', (p) => p.value);
	expect(series.data.ys).toEqual([5, 5]);
	expect(series.summary.avg).toBe(5);
	expect(series.summary.max).toBe(100);
	expect(series.showPercentile).toBe(false);
});
