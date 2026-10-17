import { describe, expect, it } from 'bun:test';
import {
	columnId,
	lineSeries,
	planQueries,
	seriesId,
	spanLabel,
	spanOf,
	spanQuery,
	statValue,
	tableRows
} from './plan';
import type { Column, QueryResult, Screen } from '$lib/types/screen';

const cpu = { namespace: 'process', field: 'cpu_percent' };

describe('planQueries', () => {
	it('groups queries by window and picks a mode per panel', () => {
		const screen: Screen = {
			title: 'x',
			range: '1h',
			root: {
				type: 'grid',
				columns: 2,
				children: [
					{ type: 'line', title: 'l', series: [{ query: cpu }], range: '24h' },
					{ type: 'stat', title: 's', query: { namespace: 'memory', field: 'used_percent' } },
					{
						type: 'table',
						title: 't',
						limit: 5,
						columns: [
							{ label: 'avg', agg: 'avg', query: cpu },
							{ label: 'max', agg: 'max', query: cpu },
							{ label: 'now', query: { ...cpu, limit: 3 } }
						]
					}
				]
			}
		};
		const plan = planQueries(screen);
		const day = plan.find((p) => 'range' in p && p.range === '24h')!;
		const hour = plan.find((p) => 'range' in p && p.range === '1h')!;
		expect(day.queries).toEqual([{ ...cpu, id: 'root.children[0]/s0', mode: 'series' }]);
		expect(hour.queries.map((q) => [q.id, q.mode, q.limit])).toEqual([
			['root.children[1]', 'latest', undefined],
			['root.children[2]/c0', 'summary', 5],
			['root.children[2]/c1', 'summary', 50],
			// A query's own limit means nothing in a table; the table ranks.
			['root.children[2]/c2', 'latest', undefined]
		]);
	});

	it('splits a window at the per-request cap', () => {
		const screen: Screen = {
			title: 'x',
			range: '1h',
			root: {
				type: 'line',
				title: 'l',
				series: Array.from({ length: 20 }, () => ({ query: cpu }))
			}
		};
		expect(planQueries(screen).map((p) => p.queries.length)).toEqual([16, 4]);
	});
});

const result = (id: string, r: Partial<QueryResult>): [string, QueryResult] => [
	id,
	{ id, series: [], ...r }
];

describe('lineSeries', () => {
	it('names fanned-out keys and turns empty buckets into gaps', () => {
		const results = new Map([
			result(seriesId('p', 0), {
				unit: 'percent',
				series: [
					{
						labels: { name: 'a' },
						points: [
							[1, 2],
							[2, null]
						]
					},
					{ labels: { name: 'b' }, points: [[1, 3]] }
				]
			}),
			result(seriesId('p', 1), { error: 'no process with name=x' })
		]);
		const out = lineSeries([{ label: 'cpu', query: cpu }, { query: cpu }], 'p', results);
		expect(out.unit).toBe('percent');
		expect(out.series.map((s) => s.name)).toEqual(['cpu · a', 'cpu · b']);
		expect(out.series[0].ys[1]).toBeNaN();
		expect(out.errors).toEqual(['no process with name=x']);
	});
});

describe('statValue', () => {
	it('reads the latest point', () => {
		const results = new Map([
			result('root', { unit: 'percent', series: [{ labels: {}, points: [[5, 41.7]] }] })
		]);
		expect(statValue('root', results)).toEqual({ value: 41.7, unit: 'percent' });
	});
});

describe('tableRows', () => {
	it('ranks by the first column and joins the rest by label set', () => {
		const columns: Column[] = [
			{ label: 'avg', agg: 'avg', query: cpu },
			{ label: 'now', agg: 'current', query: { namespace: 'process', field: 'memory_bytes' } }
		];
		const stats = (avg: number) => ({ avg, min: 0, max: avg * 2 });
		const results = new Map([
			result(columnId('t', 0), {
				unit: 'percent',
				series: [
					{ labels: { name: 'quiet' }, points: [], stats: stats(1) },
					{ labels: { name: 'busy' }, points: [], stats: stats(50) },
					{ labels: { name: 'mid' }, points: [], stats: stats(20) }
				]
			}),
			result(columnId('t', 1), {
				unit: 'bytes',
				series: [
					{ labels: { name: 'busy' }, points: [[1, 2048]] },
					{ labels: { name: 'mid' }, points: [[1, 1024]] }
				]
			})
		]);
		const out = tableRows(columns, 't', results, 2);
		expect(out.rows.map((r) => [r.label, ...r.cells])).toEqual([
			['busy', 50, 2048],
			['mid', 20, 1024]
		]);
		expect(out.units).toEqual(['percent', 'bytes']);
	});
});

describe('spans', () => {
	it('reads a fixed window unless a panel names its own range', () => {
		const window = { start: 1_000_000, end: 1_003_600 };
		const screen: Screen = {
			title: 'x',
			range: '1h',
			window,
			root: {
				type: 'grid',
				columns: 1,
				children: [
					{ type: 'line', title: 'then', series: [{ query: cpu }] },
					{ type: 'line', title: 'now', series: [{ query: cpu }], range: '6h' }
				]
			}
		};
		const plan = planQueries(screen);
		expect(plan.map((p) => spanQuery(p))).toEqual([
			{ start: 1_000_000, end: 1_003_600 },
			{ range: '6h' }
		]);
		expect(spanOf(screen)).toEqual({ window });
		expect(spanLabel({ range: '6h' })).toBe('6h');
	});
});
