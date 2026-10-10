import { describe, expect, it } from 'bun:test';
import { decodeScreen, encodeScreen, parseScreen } from './spec';

describe('parseScreen', () => {
	it('rejects what is not a screen at all', () => {
		expect(parseScreen(null)).toBeNull();
		expect(parseScreen({ title: 'x' })).toBeNull();
		expect(parseScreen([])).toBeNull();
	});

	it('fills defaults and keeps a valid tree', () => {
		const s = parseScreen({
			title: 'web',
			root: {
				type: 'grid',
				children: [
					{
						type: 'line',
						title: 'cpu',
						series: [{ query: { namespace: 'cpu', field: 'usage_percent' } }]
					},
					{
						type: 'table',
						title: 't',
						columns: [
							{ label: 'a', agg: 'avg', query: { namespace: 'process', field: 'cpu_percent' } }
						]
					}
				]
			}
		});
		expect(s?.range).toBe('1h');
		expect(s?.root).toMatchObject({ type: 'grid', columns: 1 });
		const grid = s?.root as Extract<NonNullable<typeof s>['root'], { type: 'grid' }>;
		expect(grid.children[1]).toMatchObject({ type: 'table', columns: [{ agg: 'avg' }] });
	});

	it('keeps an unknown node in place instead of dropping the screen', () => {
		const s = parseScreen({
			title: 'x',
			root: {
				type: 'grid',
				children: [
					{ type: 'heatmap' },
					{ type: 'stat', title: 's', query: { namespace: 'cpu', field: 'usage_percent' } }
				]
			}
		});
		const grid = s?.root as { type: 'grid'; children: unknown[] };
		expect(grid.children[0]).toEqual({ type: 'unsupported', kind: 'heatmap' });
		expect(grid.children[1]).toMatchObject({ type: 'stat' });
	});

	it('turns a panel with no usable query into an unsupported one', () => {
		const s = parseScreen({ title: 'x', root: { type: 'line', title: 'l', series: [{}] } });
		expect(s?.root).toEqual({ type: 'unsupported', kind: 'line' });
	});

	it('drops a bad range and non-string labels', () => {
		const s = parseScreen({
			title: 'x',
			range: '2h',
			root: {
				type: 'stat',
				title: 's',
				query: { namespace: 'process', field: 'cpu_percent', labels: { name: 'nginx', pid: 1 } }
			}
		});
		expect(s?.range).toBe('1h');
		expect(s?.root).toMatchObject({ query: { labels: { name: 'nginx' } } });
	});
});

describe('encodeScreen', () => {
	it('round-trips through a URL-safe string, unicode included', () => {
		const screen = parseScreen({
			title: 'Son 24 saat — çöp',
			range: '24h',
			root: { type: 'widget', config: { kind: 'cpu-detail' } }
		})!;
		const encoded = encodeScreen(screen);
		expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
		expect(decodeScreen(encoded)).toEqual(screen);
	});

	it('returns null for garbage', () => {
		expect(decodeScreen('!!!')).toBeNull();
		expect(decodeScreen(btoa('{"nope":1}'))).toBeNull();
	});
});
