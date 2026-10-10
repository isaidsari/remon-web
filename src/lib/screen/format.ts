import type { QueryUnit } from '$lib/types/screen';
import { fmtBps, fmtBytes, fmtNumber, fmtPercent, fmtScalar } from '$lib/utils/format';

/** A value in the unit POST /query reported for it; `—` when there is none. */
export function formatValue(value: number | null | undefined, unit?: QueryUnit): string {
	if (value == null || !Number.isFinite(value)) return '—';
	switch (unit) {
		case 'percent':
			return fmtPercent(value, 1);
		case 'bytes':
			return fmtBytes(value);
		case 'bytes/s':
			return fmtBps(value);
		case '/s':
			return `${fmtNumber(value, 1)}/s`;
		case 'celsius':
			return `${fmtNumber(value, 1)} °C`;
		default:
			return fmtScalar(value);
	}
}

/** Axis ticks want round numbers; the tooltip keeps `formatValue`'s precision. */
export function formatAxis(value: number | null | undefined, unit?: QueryUnit): string {
	if (unit === 'percent' && value != null && Number.isFinite(value)) return fmtPercent(value, 0);
	return formatValue(value, unit);
}
