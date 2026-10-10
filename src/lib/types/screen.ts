// A screen described as data: composed by the assistant (and later the
// command bar and the dashboard), drawn by the renderer, fed by POST /query.
// Mirrors remon-server's `screen` module; contract: docs/screens.md.

export type RangeName = '30m' | '1h' | '6h' | '24h' | '7d' | '30d';

export interface Query {
	namespace: string;
	field: string;
	labels?: Record<string, string>;
	/** Keyed line series without a label: how many keys, busiest first. */
	limit?: number;
}

export interface SeriesSpec {
	label?: string;
	query: Query;
}

export type Agg = 'current' | 'avg' | 'min' | 'max';

export interface Column {
	label: string;
	query: Query;
	agg?: Agg;
}

export interface Tab {
	title: string;
	child: ScreenNode;
}

export type ScreenNode =
	| { type: 'grid'; columns: number; children: ScreenNode[] }
	| { type: 'tabs'; tabs: Tab[] }
	| { type: 'line'; title: string; series: SeriesSpec[]; range?: RangeName }
	| { type: 'stat'; title: string; query: Query }
	| { type: 'table'; title: string; columns: Column[]; limit?: number; range?: RangeName }
	| { type: 'widget'; title?: string; config: unknown }
	/** A node this build cannot draw; kept so the rest of the screen still can. */
	| { type: 'unsupported'; kind: string };

export interface Screen {
	title: string;
	range: RangeName;
	root: ScreenNode;
}

// ===== POST /query =====

export type QueryMode = 'series' | 'latest' | 'summary';

export interface QueryItem extends Query {
	id: string;
	mode?: QueryMode;
}

export interface QueryRequest {
	range?: RangeName;
	start?: number;
	end?: number;
	max_points?: number;
	queries: QueryItem[];
}

export interface QueryStats {
	avg: number;
	min: number;
	max: number;
}

export interface QuerySeries {
	labels: Record<string, string>;
	/** `[timestamp, value]`, oldest first; null for an empty bucket. */
	points: [number, number | null][];
	stats?: QueryStats;
}

export type QueryUnit = 'percent' | 'bytes' | 'bytes/s' | '/s' | 'celsius';

export interface QueryResult {
	id: string;
	unit?: QueryUnit;
	series: QuerySeries[];
	chart?: {
		aligned: { start: number; end: number };
		as_of: number;
		bucket_seconds: number;
		degraded: boolean;
	};
	error?: string;
}

export interface QueryResponse {
	start: number;
	end: number;
	results: QueryResult[];
}
