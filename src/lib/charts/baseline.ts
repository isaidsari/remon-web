import type { BaselinePoint, BaselineResponse, ChartMetadata } from '$lib/types/api';
import type { ObservedBucket } from './cpu-history';

/** A learned normal range, one point per `step` seconds. */
export interface BaselineBand {
	points: BaselinePoint[];
	step: number;
}

/** The band describes 5-minute means. Below a minute per point the line is
 *  raw samples, and every short spike would leave it. */
const MIN_BUCKET_SECONDS = 60;

/** A stretch outside the band counts once it outlasts one 5-minute slot: on a
 *  chart finer than the band, a single noisy bucket is not news. */
export const MIN_OUTSIDE_SECONDS = 300;

export function drawsBaseline(chart: ChartMetadata | undefined | null): boolean {
	return chart != null && chart.bucket_seconds >= MIN_BUCKET_SECONDS;
}

/** A band worth drawing, or null while the daemon is still learning. */
export function bandOf(res: BaselineResponse | null | undefined): BaselineBand | null {
	if (!res || res.level === 'learning' || res.points.length === 0) return null;
	return { points: res.points, step: res.step_seconds };
}

/** Index of the point covering `ts`, or -1. Points are sorted by `ts`. */
function indexAt(points: BaselinePoint[], ts: number): number {
	let lo = 0,
		hi = points.length - 1,
		found = -1;
	while (lo <= hi) {
		const mid = (lo + hi) >> 1;
		if (points[mid].ts <= ts) {
			found = mid;
			lo = mid + 1;
		} else hi = mid - 1;
	}
	return found;
}

/** The expected range across `[start, end)`: the envelope of every band point
 *  it overlaps, so a coarse bucket is judged against the widest normal it
 *  spans, as the daemon widens its own coarse points. */
export function bandOver(
	band: BaselineBand,
	start: number,
	end: number
): { low: number; high: number } | null {
	let i = indexAt(band.points, start);
	if (i < 0 || band.points[i].ts + band.step <= start) {
		i = band.points.findIndex((p) => p.ts >= start);
		if (i < 0) return null;
	}
	let low = Infinity,
		high = -Infinity;
	for (; i < band.points.length && band.points[i].ts < Math.max(end, start + 1); i++) {
		low = Math.min(low, band.points[i].low);
		high = Math.max(high, band.points[i].high);
	}
	return Number.isFinite(low) ? { low, high } : null;
}

/** Stretches of a bucketed series that stay outside the band for at least
 *  `MIN_OUTSIDE_SECONDS`. Only bucket starts are observations; the duplicated
 *  bucket ends that extend the line are not. */
export function outsideBand(
	xs: number[],
	ys: number[],
	buckets: (ObservedBucket | null)[] | undefined,
	band: BaselineBand
): { start: number; end: number }[] {
	const runs: { start: number; end: number }[] = [];
	let run: { start: number; end: number } | null = null;
	const close = () => {
		if (run && run.end - run.start >= MIN_OUTSIDE_SECONDS) runs.push(run);
		run = null;
	};
	for (let i = 0; i < xs.length; i++) {
		const b = buckets?.[i];
		const y = ys[i];
		if (!b || xs[i] !== b.start || !Number.isFinite(y)) continue;
		const expected = bandOver(band, b.start, b.end);
		const outside = expected != null && (y < expected.low || y > expected.high);
		if (!outside) {
			close();
			continue;
		}
		if (run && b.start <= run.end) run.end = b.end;
		else {
			close();
			run = { start: b.start, end: b.end };
		}
	}
	close();
	return runs;
}
