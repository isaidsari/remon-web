import { expect, test } from 'bun:test';
import { bandOf, bandOver, drawsBaseline, outsideBand, type BaselineBand } from './baseline';
import { observedHistory } from './observed-history';
import type { BaselineResponse, ChartMetadata } from '$lib/types/api';

/** 10–30 everywhere, except 70–90 over [1200, 1500). */
const band: BaselineBand = {
	step: 300,
	points: [0, 300, 600, 900, 1200, 1500, 1800, 2100].map((ts) =>
		ts === 1200 ? { ts, median: 80, low: 70, high: 90 } : { ts, median: 20, low: 10, high: 30 }
	)
};

/** One bucketed point per `seconds`, through the same helper the charts use. */
function series(values: number[], seconds: number) {
	const points = values.map((v, i) => ({
		timestamp: i * seconds,
		bucket_seconds: seconds,
		value: v,
		statistics: null
	}));
	return observedHistory(points, 'value', (p) => p.value);
}

test('a coarse bucket is judged against the widest normal it spans', () => {
	expect(bandOver(band, 0, 300)).toEqual({ low: 10, high: 30 });
	expect(bandOver(band, 1200, 1500)).toEqual({ low: 70, high: 90 });
	expect(bandOver(band, 900, 1800)).toEqual({ low: 10, high: 90 });
	// Inside one point, and across the edge of two.
	expect(bandOver(band, 1250, 1310)).toEqual({ low: 70, high: 90 });
	expect(bandOver(band, 1450, 1550)).toEqual({ low: 10, high: 90 });
	expect(bandOver(band, 5000, 5300)).toBeNull();
});

test('a stretch outside the band is marked once it outlasts five minutes', () => {
	// 60 s buckets: 20 for five minutes, then 50 for six, then back.
	const values = [...Array(5).fill(20), ...Array(6).fill(50), ...Array(4).fill(20)];
	const s = series(values, 60);
	expect(outsideBand(s.data.xs, s.data.ys, s.buckets, band)).toEqual([{ start: 300, end: 660 }]);
});

test('a single noisy bucket is not news', () => {
	const values = [20, 20, 50, 20, 20, 50, 50, 20];
	const s = series(values, 60);
	expect(outsideBand(s.data.xs, s.data.ys, s.buckets, band)).toEqual([]);
});

test('the nightly job is inside its own slot, and a quiet one there is outside', () => {
	const job = series([20, 20, 20, 20, 80, 20], 300);
	expect(outsideBand(job.data.xs, job.data.ys, job.buckets, band)).toEqual([]);
	const missed = series([20, 20, 20, 20, 20, 20], 300);
	expect(outsideBand(missed.data.xs, missed.data.ys, missed.buckets, band)).toEqual([
		{ start: 1200, end: 1500 }
	]);
});

test('raw samples carry no buckets and are never judged', () => {
	const raw = { xs: [0, 2, 4], ys: [99, 99, 99] };
	expect(outsideBand(raw.xs, raw.ys, [null, null, null], band)).toEqual([]);
});

test('the band is drawn only over bucketed charts, and never while learning', () => {
	const chart = (bucket_seconds: number) => ({ bucket_seconds }) as ChartMetadata;
	expect(drawsBaseline(chart(0))).toBe(false);
	expect(drawsBaseline(chart(30))).toBe(false);
	expect(drawsBaseline(chart(60))).toBe(true);
	expect(drawsBaseline(undefined)).toBe(false);

	const res = (level: BaselineResponse['level'], n: number) =>
		({ level, step_seconds: 300, points: band.points.slice(0, n) }) as BaselineResponse;
	expect(bandOf(res('learning', 0))).toBeNull();
	expect(bandOf(res('recent', 0))).toBeNull();
	expect(bandOf(res('recent', 3))?.points.length).toBe(3);
	expect(bandOf(null)).toBeNull();
});
