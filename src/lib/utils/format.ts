import { m } from '$lib/paraglide/messages';
import { currentLocale, type Locale } from './lang';

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];

/**
 * `Intl.NumberFormat` construction is expensive and these run per table row and
 * per chart tick, so instances are kept per (locale, style, digits). Locale
 * changes reload the page, so an entry can never go stale.
 */
const nfCache = new Map<string, Intl.NumberFormat>();
function nf(locale: Locale, opts: Intl.NumberFormatOptions): Intl.NumberFormat {
	const key = `${locale}|${opts.style ?? 'decimal'}|${opts.minimumFractionDigits}|${opts.maximumFractionDigits}`;
	let f = nfCache.get(key);
	if (!f) {
		f = new Intl.NumberFormat(locale, opts);
		nfCache.set(key, f);
	}
	return f;
}

/** Fixed digits, formatted for the active locale (`1,2` under tr, `1.2` under en). */
function fixed(v: number, digits: number): string {
	return nf(currentLocale(), {
		minimumFractionDigits: digits,
		maximumFractionDigits: digits
	}).format(v);
}

/** Bytes → human ("1.2 GB"). Decimal SI for size, IEC scale (1024). */
export function fmtBytes(n: number, fractionDigits = 1): string {
	if (!Number.isFinite(n) || n <= 0) return '0 B';
	const i = Math.max(0, Math.min(BYTE_UNITS.length - 1, Math.floor(Math.log(n) / Math.log(1024))));
	const v = n / Math.pow(1024, i);
	return `${fixed(v, i === 0 ? 0 : fractionDigits)} ${BYTE_UNITS[i]}`;
}

/** Bytes/sec → ("1.2 MB/s"). */
export function fmtBps(n: number, fractionDigits = 1): string {
	return `${fmtBytes(n, fractionDigits)}/s`;
}

/**
 * Percent → ("12.3%" under en, "%12,3" under tr). Caller passes the percent
 * already (0–100); the sign's side of the number is the locale's business.
 */
export function fmtPercent(p: number, fractionDigits = 1): string {
	if (!Number.isFinite(p)) return '—';
	return nf(currentLocale(), {
		style: 'percent',
		minimumFractionDigits: fractionDigits,
		maximumFractionDigits: fractionDigits
	}).format(p / 100);
}

type DurationParts = Partial<Record<Intl.DurationFormatUnit, number>>;

/** The two largest units that carry information, as a duration record. */
function durationParts(secs: number): DurationParts {
	const d = Math.floor(secs / 86400);
	const h = Math.floor((secs % 86400) / 3600);
	const mins = Math.floor((secs % 3600) / 60);
	const s = Math.floor(secs % 60);
	if (d > 0) return { days: d, hours: h };
	if (h > 0) return { hours: h, minutes: mins };
	if (mins > 0) return { minutes: mins, seconds: s };
	return { seconds: s };
}

/**
 * `Intl.DurationFormat` is newer than this app's baseline — a browser from
 * before it shipped would throw here rather than render an uptime. `null`
 * records the absence once so the fallback path is not a try/catch per call.
 */
const dfCache = new Map<string, Intl.DurationFormat | null>();
function df(locale: Locale, keepZero: boolean): Intl.DurationFormat | null {
	const key = `${locale}|${keepZero}`;
	if (!dfCache.has(key)) {
		try {
			dfCache.set(
				key,
				new Intl.DurationFormat(locale, {
					style: 'narrow',
					// Per-unit, not global: hiding zeroes is what turns `9d 0h`
					// into `9d`, but a zero duration needs its one unit kept or
					// it formats to an empty string.
					secondsDisplay: keepZero ? 'always' : 'auto'
				})
			);
		} catch {
			dfCache.set(key, null);
		}
	}
	return dfCache.get(key) ?? null;
}

/**
 * Seconds → compact duration ("2d 3h" under en, "2g 3s" under tr). The narrow
 * style is what the hand-rolled version was imitating: same width in English,
 * and the abbreviations a Turkish reader expects instead of English initials.
 */
export function fmtDuration(secs: number): string {
	const isZero = !Number.isFinite(secs) || secs <= 0;
	const parts: DurationParts = isZero ? { seconds: 0 } : durationParts(secs);
	const fmt = df(currentLocale(), isZero);
	if (fmt) return fmt.format(parts);
	// Pre-DurationFormat browsers keep the English abbreviations.
	return Object.entries(parts)
		.map(([unit, v]) => `${v}${unit[0]}`)
		.join(' ');
}

/** Plain number at fixed digits, with the locale's separators and grouping. */
export function fmtNumber(n: number, fractionDigits = 2): string {
	if (!Number.isFinite(n)) return '—';
	return fixed(n, fractionDigits);
}

/**
 * A probe's own number: integers keep their exact shape, floats get two digits.
 * Both go through the locale, so a count and a rate don't disagree about what a
 * thousands separator looks like.
 */
export function fmtScalar(value: number): string {
	return Number.isInteger(value) ? fixed(value, 0) : fmtNumber(value, 2);
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
