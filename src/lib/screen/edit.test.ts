import { describe, expect, it } from 'bun:test';
import { moveAt, removeAt } from './edit';
import { defaultHome, homeScreen } from './home';
import type { Screen } from '$lib/types/screen';

const w = (kind: string) => ({ type: 'widget' as const, config: { kind } });

const screen = (): Screen => ({
	title: 'x',
	range: '1h',
	root: {
		type: 'grid',
		columns: 1,
		children: [
			w('live-vitals'),
			{ type: 'grid', columns: 2, children: [w('cpu-detail'), w('pressure')] },
			{ type: 'grid', columns: 2, children: [w('disk-detail')] }
		]
	}
});

const kinds = (s: Screen) => JSON.stringify(s.root).match(/"kind":"[^"]+"/g);

describe('removeAt', () => {
	it('removes a nested panel and leaves the input alone', () => {
		const before = screen();
		const after = removeAt(before, 'root.children[1].children[0]');
		expect(kinds(after)).toEqual([
			'"kind":"live-vitals"',
			'"kind":"pressure"',
			'"kind":"disk-detail"'
		]);
		expect(kinds(before)).toHaveLength(4);
	});

	it('drops a grid it empties, but never the root', () => {
		const after = removeAt(screen(), 'root.children[2].children[0]');
		expect((after.root as { children: unknown[] }).children).toHaveLength(2);
		const bare: Screen = {
			title: 'x',
			range: '1h',
			root: { type: 'grid', columns: 1, children: [w('pressure')] }
		};
		expect(removeAt(bare, 'root.children[0]').root).toEqual({
			type: 'grid',
			columns: 1,
			children: []
		});
	});

	it('ignores a path that is not a grid child', () => {
		const s = screen();
		expect(removeAt(s, 'root')).toBe(s);
		expect(removeAt(s, 'root.children[9]')).toBe(s);
		expect(removeAt(s, 'nonsense')).toBe(s);
	});
});

describe('moveAt', () => {
	it('swaps with a neighbour and stops at the ends', () => {
		const s = screen();
		const down = moveAt(s, 'root.children[1].children[0]', 1);
		expect(kinds(down)?.slice(1, 3)).toEqual(['"kind":"pressure"', '"kind":"cpu-detail"']);
		expect(moveAt(s, 'root.children[0]', -1)).toBe(s);
		expect(moveAt(s, 'root.children[2]', 1)).toBe(s);
	});
});

describe('homeScreen', () => {
	it('falls back to the default for nothing or junk', () => {
		expect(homeScreen(undefined)).toEqual(defaultHome());
		expect(homeScreen({ widgets: [] })).toEqual(defaultHome());
		const saved = { title: 'mine', range: '6h', root: w('pressure') };
		expect(homeScreen(saved)).toMatchObject({ title: 'mine', range: '6h' });
	});
});
