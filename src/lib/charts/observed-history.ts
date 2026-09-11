import type { GaugeStatistics } from '$lib/types/api';

export interface HistoricalObservation {
	timestamp: number;
	bucket_seconds?: number;
	statistics?: Record<string, GaugeStatistics> | null;
}

export interface ObservedBucket {
	start: number;
	end: number;
	min: number | null;
	max: number | null;
	count: number | null;
}

function observationValue<T extends HistoricalObservation>(
	p: T,
	field: string,
	pick: (p: T) => number | null | undefined
) {
	const stats = p.statistics?.[field];
	return stats ? (stats.valid_count > 0 ? stats.sum / stats.valid_count : null) : (pick(p) ?? null);
}

export function observedStats<T extends HistoricalObservation>(
	points: T[],
	field: string,
	pick: (p: T) => number | null | undefined
) {
	const current = points.length ? observationValue(points[points.length - 1], field, pick) : null;
	const summaries = points.map((p) => p.statistics?.[field]);
	if (!points.length || summaries.some((s) => s == null))
		return { current, avg: null, min: null, max: null, p95: null };
	const valid = summaries.filter((s): s is GaugeStatistics => s != null && s.valid_count > 0);
	const count = valid.reduce((n, s) => n + s.valid_count, 0);
	const raw = points.every((p) => p.bucket_seconds === 0);
	const ordered = raw
		? points
				.map(pick)
				.filter((v): v is number => v != null && Number.isFinite(v))
				.sort((a, b) => a - b)
		: [];
	return {
		current,
		avg: count ? valid.reduce((n, s) => n + s.sum, 0) / count : null,
		min: count ? Math.min(...valid.map((s) => s.min ?? Infinity)) : null,
		max: count ? Math.max(...valid.map((s) => s.max ?? -Infinity)) : null,
		p95: ordered.length ? ordered[Math.ceil(ordered.length * 0.95) - 1] : null
	};
}

/** Interval rectangles carry observed extrema; line endpoints never count as new observations. */
export function observedHistory<T extends HistoricalObservation>(
	points: T[],
	field: string,
	pick: (p: T) => number | null | undefined
) {
	const xs: number[] = [],
		ys: number[] = [];
	const buckets: (ObservedBucket | null)[] = [];
	for (let i = 0; i < points.length; i++) {
		const p = points[i],
			seconds = p.bucket_seconds ?? 0,
			stats = p.statistics?.[field];
		const bucket =
			seconds > 0
				? {
						start: p.timestamp,
						end: p.timestamp + seconds,
						min: stats?.min ?? null,
						max: stats?.max ?? null,
						count: stats?.valid_count ?? null
					}
				: null;
		const value = observationValue(p, field, pick) ?? Number.NaN;
		xs.push(p.timestamp);
		ys.push(value);
		buckets.push(bucket);
		const next = points[i + 1];
		if (bucket && (!next || next.timestamp > bucket.end)) {
			xs.push(bucket.end);
			ys.push(value);
			buckets.push(bucket);
			if (next) {
				xs.push(bucket.end);
				ys.push(Number.NaN);
				buckets.push(null);
			}
		}
	}
	return {
		data: { xs, ys },
		buckets,
		summary: observedStats(points, field, pick),
		showPercentile: points.every((p) => p.bucket_seconds === 0)
	};
}

export function groupHistory<T>(points: T[], key: (p: T) => string): Map<string, T[]> {
	const grouped = new Map<string, T[]>();
	for (const p of points) {
		const k = key(p);
		const rows = grouped.get(k);
		if (rows) rows.push(p);
		else grouped.set(k, [p]);
	}
	return grouped;
}
