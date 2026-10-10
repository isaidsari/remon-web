import type {
	Agg,
	Column,
	Query,
	RangeName,
	Screen,
	ScreenNode,
	SeriesSpec,
	Tab
} from '$lib/types/screen';

// Specs reach the client from the daemon (validated there) but also from a
// URL or saved history, so each one is parsed again here. Lenient where the
// server is strict: a node this build does not know becomes `unsupported` in
// place, and the rest of the screen still draws.

export const RANGES: readonly RangeName[] = ['30m', '1h', '6h', '24h', '7d', '30d'];
const AGGS: readonly Agg[] = ['current', 'avg', 'min', 'max'];

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function str(v: unknown): string {
	return typeof v === 'string' ? v : '';
}

function range(v: unknown): RangeName | undefined {
	return RANGES.includes(v as RangeName) ? (v as RangeName) : undefined;
}

function count(v: unknown, min: number, max: number): number | undefined {
	return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : undefined;
}

function query(v: unknown): Query | null {
	if (!isRecord(v) || !str(v.namespace) || !str(v.field)) return null;
	const q: Query = { namespace: str(v.namespace), field: str(v.field) };
	if (isRecord(v.labels)) {
		const labels = Object.entries(v.labels).filter(
			(e): e is [string, string] => typeof e[1] === 'string'
		);
		if (labels.length) q.labels = Object.fromEntries(labels);
	}
	const limit = count(v.limit, 1, 50);
	if (limit) q.limit = limit;
	return q;
}

function node(v: unknown, depth: number): ScreenNode {
	const kind = isRecord(v) ? str(v.type) : '';
	if (!isRecord(v) || depth > 6) return { type: 'unsupported', kind: kind || '?' };
	switch (kind) {
		case 'grid':
			return {
				type: 'grid',
				columns: count(v.columns, 1, 4) ?? 1,
				children: Array.isArray(v.children) ? v.children.map((c) => node(c, depth + 1)) : []
			};
		case 'tabs':
			return {
				type: 'tabs',
				tabs: (Array.isArray(v.tabs) ? v.tabs : [])
					.filter(isRecord)
					.map((t): Tab => ({ title: str(t.title), child: node(t.child, depth + 1) }))
			};
		case 'line': {
			const series = (Array.isArray(v.series) ? v.series : [])
				.filter(isRecord)
				.map((s): SeriesSpec | null => {
					const q = query(s.query);
					return q ? { query: q, ...(str(s.label) && { label: str(s.label) }) } : null;
				})
				.filter((s): s is SeriesSpec => s !== null);
			if (!series.length) break;
			return { type: 'line', title: str(v.title), series, ...rangeOf(v) };
		}
		case 'stat': {
			const q = query(v.query);
			if (!q) break;
			return { type: 'stat', title: str(v.title), query: q };
		}
		case 'table': {
			const columns = (Array.isArray(v.columns) ? v.columns : [])
				.filter(isRecord)
				.map((c): Column | null => {
					const q = query(c.query);
					if (!q) return null;
					const agg = AGGS.includes(c.agg as Agg) ? (c.agg as Agg) : 'current';
					return { label: str(c.label), query: q, agg };
				})
				.filter((c): c is Column => c !== null);
			if (!columns.length) break;
			const limit = count(v.limit, 1, 50);
			return {
				type: 'table',
				title: str(v.title),
				columns,
				...(limit && { limit }),
				...rangeOf(v)
			};
		}
		case 'widget':
			return { type: 'widget', config: v.config, ...(str(v.title) && { title: str(v.title) }) };
	}
	return { type: 'unsupported', kind: kind || '?' };
}

function rangeOf(v: Record<string, unknown>): { range?: RangeName } {
	const r = range(v.range);
	return r ? { range: r } : {};
}

/** Untrusted JSON → a drawable screen, or null when it is not one at all. */
export function parseScreen(input: unknown): Screen | null {
	if (!isRecord(input) || !isRecord(input.root)) return null;
	return {
		title: str(input.title),
		range: range(input.range) ?? '1h',
		root: node(input.root, 1)
	};
}

// A screen travels in a URL as base64url JSON: shareable, bookmarkable, and
// nothing to store server-side.

export function encodeScreen(screen: Screen): string {
	const bytes = new TextEncoder().encode(JSON.stringify(screen));
	let bin = '';
	for (const b of bytes) bin += String.fromCharCode(b);
	return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeScreen(encoded: string): Screen | null {
	try {
		const bin = atob(encoded.replace(/-/g, '+').replace(/_/g, '/'));
		const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
		return parseScreen(JSON.parse(new TextDecoder().decode(bytes)));
	} catch {
		return null;
	}
}
