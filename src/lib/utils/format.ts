import { m } from '$lib/paraglide/messages';
import { currentLocale, type Locale } from './lang';

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];

/** Bytes → human ("1.2 GB"). Decimal SI for size, IEC scale (1024). */
export function fmtBytes(n: number, fractionDigits = 1): string {
	if (!Number.isFinite(n) || n <= 0) return '0 B';
	const i = Math.max(0, Math.min(BYTE_UNITS.length - 1, Math.floor(Math.log(n) / Math.log(1024))));
	const v = n / Math.pow(1024, i);
	return `${v.toFixed(i === 0 ? 0 : fractionDigits)} ${BYTE_UNITS[i]}`;
}

/** Bytes/sec → ("1.2 MB/s"). */
export function fmtBps(n: number, fractionDigits = 1): string {
	return `${fmtBytes(n, fractionDigits)}/s`;
}

/** Number → ("12.3 %"). Caller passes the percent already (0–100). */
export function fmtPercent(p: number, fractionDigits = 1): string {
	if (!Number.isFinite(p)) return '—';
	return `${p.toFixed(fractionDigits)} %`;
}

/** Seconds → "h m s" compact form. */
export function fmtDuration(secs: number): string {
	if (!Number.isFinite(secs) || secs <= 0) return '0s';
	const d = Math.floor(secs / 86400);
	const h = Math.floor((secs % 86400) / 3600);
	const mins = Math.floor((secs % 3600) / 60);
	const s = Math.floor(secs % 60);
	if (d > 0) return `${d}d ${h}h`;
	if (h > 0) return `${h}h ${mins}m`;
	if (mins > 0) return `${mins}m ${s}s`;
	return `${s}s`;
}

/** Truncate to fractional digits without rounding artifacts. */
export function fmtNumber(n: number, fractionDigits = 2): string {
	if (!Number.isFinite(n)) return '—';
	return n.toFixed(fractionDigits);
}

const rtfCache = new Map<Locale, Intl.RelativeTimeFormat>();
function rtf(locale: Locale): Intl.RelativeTimeFormat {
	let r = rtfCache.get(locale);
	if (!r) {
		r = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'short' });
		rtfCache.set(locale, r);
	}
	return r;
}

export function fmtRelative(unixSecs: number, nowMs = Date.now()): string {
	if (!Number.isFinite(unixSecs) || unixSecs <= 0) return '—';
	const diff = nowMs / 1000 - unixSecs;
	if (diff < 0) return m.format_in_future();
	if (diff < 60) return m.format_just_now();
	const fmt = rtf(currentLocale());
	if (diff < 3600) return fmt.format(-Math.floor(diff / 60), 'minute');
	if (diff < 86400) return fmt.format(-Math.floor(diff / 3600), 'hour');
	if (diff < 2592000) return fmt.format(-Math.floor(diff / 86400), 'day');
	if (diff < 31536000) return fmt.format(-Math.floor(diff / 2592000), 'month');
	return fmt.format(-Math.floor(diff / 31536000), 'year');
}

/** Take the first 12 characters of a docker container/image id. */
export function shortId(id: string): string {
	return id.replace(/^sha256:/, '').slice(0, 12);
}
