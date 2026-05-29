import type { ProbeMetricPoint } from '$lib/types/api';
import { fmtBytes, fmtNumber, fmtPercent } from './format';

// Canonical JSON for a label set — keys sorted so the same logical label-set
// always produces the same key regardless of insertion order. Used to group
// multi-label probe metric streams and to persist a selected stream.
export function labelKey(labels: Record<string, string>): string {
	const keys = Object.keys(labels).sort();
	const obj: Record<string, string> = {};
	for (const k of keys) obj[k] = labels[k];
	return JSON.stringify(obj);
}

export interface LabelGroup {
	key: string;
	points: ProbeMetricPoint[];
}

/** Group a flat point list into one stream per label set, most-populated first. */
export function groupPointsByLabel(points: ProbeMetricPoint[]): LabelGroup[] {
	const groups = new Map<string, ProbeMetricPoint[]>();
	for (const p of points) {
		const k = labelKey(p.labels ?? {});
		let arr = groups.get(k);
		if (!arr) {
			arr = [];
			groups.set(k, arr);
		}
		arr.push(p);
	}
	const result: LabelGroup[] = [];
	for (const [key, pts] of groups) result.push({ key, points: pts });
	result.sort((a, b) => b.points.length - a.points.length || a.key.localeCompare(b.key));
	return result;
}

/** `k=v · k2=v2` for a label map; empty string for the unlabelled set. */
export function formatLabels(labels: Record<string, string> | undefined): string {
	if (!labels) return '';
	const entries = Object.entries(labels);
	if (entries.length === 0) return '';
	return entries.map(([k, v]) => `${k}=${v}`).join(' · ');
}

/** Human-readable form of a canonical label-set key (`{}` → empty). */
export function formatLabelKey(key: string): string {
	if (key === '{}' || key === '') return '';
	try {
		return formatLabels(JSON.parse(key) as Record<string, string>);
	} catch {
		return key;
	}
}

function fmtScalar(value: number): string {
	return Number.isInteger(value) ? value.toString() : fmtNumber(value, 2);
}

// Unit-aware value formatting. The probe API gives free-form unit strings; we
// special-case the common ones and pass everything else through as `N unit`.
export function formatMetricValue(value: number, unit: string | null | undefined): string {
	if (!Number.isFinite(value)) return '—';
	switch ((unit ?? '').trim().toLowerCase()) {
		case 'bytes':
		case 'byte':
		case 'b':
			return fmtBytes(value);
		case 'percent':
		case 'pct':
		case '%':
			return fmtPercent(value);
		case '':
			return fmtScalar(value);
		default:
			return `${fmtScalar(value)} ${unit}`;
	}
}
