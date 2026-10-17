import type {
	Column,
	QueryItem,
	QueryResult,
	QueryUnit,
	RangeName,
	Screen,
	ScreenNode,
	SeriesSpec,
	TimeWindow
} from '$lib/types/screen';

// Everything between a spec and pixels that is not drawing: which requests a
// screen needs, and how results become chart series and table rows. Panels
// find their results by path ids (`root.children[1]/s0`), so the renderer and
// this module only have to agree on paths.

/** POST /query takes at most this many queries; the server caps a screen at it too. */
const MAX_PER_REQUEST = 16;
const DEFAULT_TABLE_ROWS = 10;
/** Later table columns must cover every row the first one ranks in. */
const TABLE_LOOKUP_LIMIT = 50;

/** When a panel reads: a named range ending now, or the screen's fixed window. */
export type Span = { range: RangeName } | { window: TimeWindow };

export type PlannedRequest = Span & { queries: QueryItem[] };

/** A panel's own range wins; otherwise the screen's window, then its range. */
export function spanOf(screen: Screen, own?: RangeName): Span {
	if (own) return { range: own };
	return screen.window ? { window: screen.window } : { range: screen.range };
}

/** `POST /query`'s window fields for a span. */
export function spanQuery(span: Span): { range: RangeName } | { start: number; end: number } {
	return 'window' in span
		? { start: span.window.start, end: span.window.end }
		: { range: span.range };
}

/** What a panel header shows for its time. */
export function spanLabel(span: Span): string {
	if ('range' in span) return span.range;
	const fmt = (t: number) =>
		new Date(t * 1000).toLocaleString(undefined, {
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	return `${fmt(span.window.start)} – ${fmt(span.window.end)}`;
}

export const childPath = (path: string, i: number) => `${path}.children[${i}]`;
export const tabPath = (path: string, i: number) => `${path}.tabs[${i}].child`;
export const seriesId = (path: string, i: number) => `${path}/s${i}`;
export const columnId = (path: string, i: number) => `${path}/c${i}`;
export const statId = (path: string) => path;

/** One request per window the screen uses, split at the per-request cap. */
export function planQueries(screen: Screen): PlannedRequest[] {
	const bySpan = new Map<string, { span: Span; queries: QueryItem[] }>();
	const add = (span: Span, q: QueryItem) => {
		const key = JSON.stringify(span);
		const group = bySpan.get(key) ?? { span, queries: [] };
		group.queries.push(q);
		bySpan.set(key, group);
	};

	const walk = (node: ScreenNode, path: string) => {
		switch (node.type) {
			case 'grid':
				node.children.forEach((c, i) => walk(c, childPath(path, i)));
				break;
			case 'tabs':
				node.tabs.forEach((t, i) => walk(t.child, tabPath(path, i)));
				break;
			case 'line':
				node.series.forEach((s, i) =>
					add(spanOf(screen, node.range), { ...s.query, id: seriesId(path, i), mode: 'series' })
				);
				break;
			case 'stat':
				// Current by definition; grouped with the screen only to share a request.
				add(spanOf(screen), { ...node.query, id: statId(path), mode: 'latest' });
				break;
			case 'table':
				node.columns.forEach((c, i) => {
					const current = (c.agg ?? 'current') === 'current';
					const { limit: _ignored, ...query } = c.query;
					add(spanOf(screen, node.range), {
						...query,
						id: columnId(path, i),
						mode: current ? 'latest' : 'summary',
						...(!current && {
							limit: i === 0 ? (node.limit ?? DEFAULT_TABLE_ROWS) : TABLE_LOOKUP_LIMIT
						})
					});
				});
				break;
		}
	};
	walk(screen.root, 'root');

	const out: PlannedRequest[] = [];
	for (const { span, queries } of bySpan.values()) {
		for (let i = 0; i < queries.length; i += MAX_PER_REQUEST) {
			out.push({ ...span, queries: queries.slice(i, i + MAX_PER_REQUEST) });
		}
	}
	return out;
}

/** Canonical label key: sorted keys, so two orders of one set compare equal. */
export function labelKey(labels: Record<string, string>): string {
	return JSON.stringify(
		Object.fromEntries(Object.entries(labels).sort(([a], [b]) => a.localeCompare(b)))
	);
}

function labelText(labels: Record<string, string>): string {
	return Object.values(labels).join(' · ');
}

export interface LineSeries {
	name: string;
	xs: number[];
	/** NaN where a bucket was empty, which the chart draws as a gap. */
	ys: number[];
}

/** Chart lines for a `line` panel: a query can fan out into several keys. */
export function lineSeries(
	specs: SeriesSpec[],
	path: string,
	results: Map<string, QueryResult>
): { series: LineSeries[]; unit?: QueryUnit; errors: string[] } {
	const series: LineSeries[] = [];
	const errors: string[] = [];
	let unit: QueryUnit | undefined;
	specs.forEach((spec, i) => {
		const r = results.get(seriesId(path, i));
		if (!r) return;
		if (r.error) {
			errors.push(r.error);
			return;
		}
		unit ??= r.unit;
		for (const s of r.series) {
			const key = labelText(s.labels);
			const name =
				spec.label && r.series.length > 1
					? `${spec.label} · ${key}`
					: (spec.label ?? (key || spec.query.field));
			series.push({
				name,
				xs: s.points.map((p) => p[0]),
				ys: s.points.map((p) => p[1] ?? Number.NaN)
			});
		}
	});
	return { series, unit, errors };
}

/** A `stat`'s value: the single series' latest point. */
export function statValue(
	path: string,
	results: Map<string, QueryResult>
): { value: number | null; unit?: QueryUnit; error?: string } {
	const r = results.get(statId(path));
	if (!r) return { value: null };
	if (r.error) return { value: null, error: r.error };
	const point = r.series[0]?.points.at(-1);
	return { value: point?.[1] ?? null, unit: r.unit };
}

export interface TableRow {
	key: string;
	label: string;
	cells: (number | null)[];
}

function columnValue(column: Column, s: QueryResult['series'][number]): number | null {
	const agg = column.agg ?? 'current';
	if (agg === 'current') return s.points.at(-1)?.[1] ?? null;
	return s.stats?.[agg] ?? null;
}

/** Rows ranked by the first column, highest first; other columns joined by label set. */
export function tableRows(
	columns: Column[],
	path: string,
	results: Map<string, QueryResult>,
	limit = DEFAULT_TABLE_ROWS
): { rows: TableRow[]; units: (QueryUnit | undefined)[]; errors: string[] } {
	const errors: string[] = [];
	const byColumn = columns.map((c, i) => {
		const r = results.get(columnId(path, i));
		if (r?.error) errors.push(r.error);
		const values = new Map<string, number | null>();
		for (const s of r?.series ?? []) values.set(labelKey(s.labels), columnValue(c, s));
		return { result: r, values };
	});
	const first = byColumn[0]?.result;
	const rows: TableRow[] = (first?.series ?? []).map((s) => {
		const key = labelKey(s.labels);
		return {
			key,
			label: labelText(s.labels) || '—',
			cells: byColumn.map((col) => col.values.get(key) ?? null)
		};
	});
	rows.sort((a, b) => (b.cells[0] ?? -Infinity) - (a.cells[0] ?? -Infinity));
	return {
		rows: rows.slice(0, limit),
		units: byColumn.map((c) => c.result?.unit),
		errors
	};
}
