import { describe, expect, it } from 'bun:test';
import {
	clampW,
	clampX,
	compact,
	findSlot,
	MIN_H,
	MIN_W,
	moveWidget,
	place,
	resizeWidget,
	type Rect
} from './layout';
import type { Widget, WidgetConfig } from '$lib/types/dashboard';

const CPU: WidgetConfig = { kind: 'cpu-detail' };

function w(id: string, x: number, y: number, width: number, h: number): Widget {
	return { id, x, y, w: width, h, config: CPU };
}

function rect(id: string, x: number, y: number, width: number, h: number): Rect {
	return { id, x, y, w: width, h };
}

/** Every cell a rect claims, as "x,y" strings. */
function cells(r: Rect): string[] {
	const out: string[] = [];
	for (let x = r.x; x < r.x + r.w; x++) for (let y = r.y; y < r.y + r.h; y++) out.push(`${x},${y}`);
	return out;
}

function hasOverlap(rects: Rect[]): boolean {
	const seen = new Set<string>();
	for (const r of rects) {
		for (const cell of cells(r)) {
			if (seen.has(cell)) return true;
			seen.add(cell);
		}
	}
	return false;
}

function byId(rects: Rect[], id: string): Rect {
	const found = rects.find((r) => r.id === id);
	if (!found) throw new Error(`no rect ${id}`);
	return found;
}

describe('compact', () => {
	it('pulls a lone widget to the top', () => {
		expect(compact([rect('a', 0, 7, 4, 2)])[0].y).toBe(0);
	});

	it('closes the hole a removed widget left behind', () => {
		// b sat at y=2; it is gone, so c should rise into its place.
		const out = compact([rect('a', 0, 0, 12, 2), rect('c', 0, 4, 12, 2)]);
		expect(byId(out, 'a').y).toBe(0);
		expect(byId(out, 'c').y).toBe(2);
	});

	it('keeps widgets side by side rather than stacking them', () => {
		const out = compact([rect('a', 0, 3, 6, 2), rect('b', 6, 5, 6, 2)]);
		expect(byId(out, 'a')).toMatchObject({ x: 0, y: 0 });
		expect(byId(out, 'b')).toMatchObject({ x: 6, y: 0 });
	});

	it('lets a widget rise only as far as the one above allows', () => {
		const out = compact([rect('a', 0, 0, 6, 2), rect('b', 3, 9, 6, 2)]);
		expect(byId(out, 'b').y).toBe(2);
	});

	it('never leaves an overlap', () => {
		const out = compact([
			rect('a', 0, 0, 6, 4),
			rect('b', 4, 1, 6, 2),
			rect('c', 0, 2, 12, 2),
			rect('d', 8, 0, 4, 3)
		]);
		expect(hasOverlap(out)).toBe(false);
	});

	it('is stable: compacting an already compact layout changes nothing', () => {
		const once = compact([rect('a', 0, 4, 6, 2), rect('b', 6, 9, 6, 2), rect('c', 0, 1, 12, 3)]);
		expect(compact(once)).toEqual(once);
	});
});

describe('place with a sticky widget', () => {
	it('leaves the sticky widget exactly where it was put', () => {
		const out = place([rect('a', 0, 0, 12, 2), rect('drag', 2, 5, 4, 2)], 'drag');
		expect(byId(out, 'drag')).toMatchObject({ x: 2, y: 5 });
	});

	it('pushes a widget out of the sticky widget’s way', () => {
		const out = place([rect('sit', 0, 0, 6, 2), rect('drag', 0, 0, 6, 2)], 'drag');
		expect(byId(out, 'drag').y).toBe(0);
		expect(byId(out, 'sit').y).toBe(2);
		expect(hasOverlap(out)).toBe(false);
	});

	it('does not float the sticky widget up', () => {
		const out = place([rect('drag', 0, 6, 4, 2)], 'drag');
		expect(byId(out, 'drag').y).toBe(6);
	});
});

describe('moveWidget', () => {
	const base = [w('a', 0, 0, 6, 2), w('b', 6, 0, 6, 2), w('c', 0, 2, 12, 4)];

	it('drops the widget on the target cell', () => {
		const out = moveWidget(base, 'b', 0, 6);
		expect(byId(out, 'b')).toMatchObject({ x: 0, y: 6 });
	});

	it('keeps the layout free of overlaps after a drop', () => {
		expect(hasOverlap(moveWidget(base, 'c', 3, 0))).toBe(false);
	});

	it('clamps a drag past the right edge back inside the grid', () => {
		expect(byId(moveWidget(base, 'a', 99, 0), 'a').x).toBe(6);
	});

	it('clamps a drag above the first row', () => {
		expect(byId(moveWidget(base, 'c', 0, -5), 'c').y).toBe(0);
	});

	it('closes the gap the moved widget vacated', () => {
		// a leaves row 0; c should rise to meet b rather than stay at y=2.
		const out = moveWidget(base, 'a', 0, 20);
		expect(byId(out, 'c').y).toBe(2);
		expect(byId(out, 'a').y).toBe(20);
	});
});

describe('resizeWidget', () => {
	const base = [w('a', 0, 0, 6, 2), w('b', 0, 2, 6, 2)];

	it('grows from the bottom-right and pushes the neighbour down', () => {
		const out = resizeWidget(base, 'a', 6, 4);
		expect(byId(out, 'a')).toMatchObject({ x: 0, y: 0, w: 6, h: 4 });
		expect(byId(out, 'b').y).toBe(4);
	});

	it('pulls the neighbour back up when the widget shrinks', () => {
		const grown = resizeWidget(base, 'a', 6, 6);
		expect(byId(resizeWidget(grown, 'a', 6, 2), 'b').y).toBe(2);
	});

	it('refuses to go below the minimum size', () => {
		const out = resizeWidget(base, 'a', 0, 0);
		expect(byId(out, 'a')).toMatchObject({ w: MIN_W, h: MIN_H });
	});

	it('will not let a widget grow past the right edge', () => {
		const out = resizeWidget([w('a', 8, 0, 4, 2)], 'a', 99, 2);
		expect(byId(out, 'a').w).toBe(4);
	});
});

describe('clamping', () => {
	it('keeps x inside the grid for the widget’s width', () => {
		expect(clampX(11, 6)).toBe(6);
		expect(clampX(-3, 6)).toBe(0);
	});

	it('caps width by the space left to the right of x', () => {
		expect(clampW(9, 12)).toBe(3);
		expect(clampW(0, 1)).toBe(MIN_W);
	});
});

describe('findSlot', () => {
	it('uses the empty half of a row before starting a new one', () => {
		expect(findSlot([rect('a', 0, 0, 6, 2)], 6, 2)).toEqual({ x: 6, y: 0 });
	});

	it('goes below when the widget cannot fit beside anything', () => {
		expect(findSlot([rect('a', 0, 0, 12, 2)], 6, 2)).toEqual({ x: 0, y: 2 });
	});

	it('starts at the origin on an empty dashboard', () => {
		expect(findSlot([], 4, 2)).toEqual({ x: 0, y: 0 });
	});
});
