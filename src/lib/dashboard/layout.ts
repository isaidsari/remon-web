import { DASHBOARD_COLUMNS } from '$lib/types/dashboard';
import type { Widget } from '$lib/types/dashboard';

// Placement rules for the dashboard grid. Pure functions over widget
// rectangles: the grid component owns pointers and pixels, this owns cells.
//
// Gravity points up. Every arrangement that comes out of here is compacted,
// so a removed or shrunk widget never leaves a hole behind.

/** Smallest a widget may be dragged to; below this the cards stop being readable. */
export const MIN_W = 2;
export const MIN_H = 2;

/** The subset of a widget this module reasons about. */
export interface Rect {
	id: string;
	x: number;
	y: number;
	w: number;
	h: number;
}

function overlaps(a: Rect, b: Rect): boolean {
	return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** Float `rect` as far up as it will go without touching anything in `placed`. */
function settle<T extends Rect>(rect: T, placed: Rect[]): T {
	let y = Math.max(0, rect.y);
	while (placed.some((p) => overlaps({ ...rect, y }, p))) y++;
	while (y > 0 && !placed.some((p) => overlaps({ ...rect, y: y - 1 }, p))) y--;
	return { ...rect, y } as T;
}

/**
 * Re-flow every widget under upward gravity.
 *
 * `stickyId` keeps one widget exactly where it was put — the one under the
 * pointer — and everything else settles around it. Without it, all widgets
 * float and the result is a plain compaction.
 */
export function place<T extends Rect>(rects: T[], stickyId?: string): T[] {
	const sticky = stickyId ? rects.find((r) => r.id === stickyId) : undefined;
	const rest = rects
		.filter((r) => r !== sticky)
		.sort((a, b) => a.y - b.y || a.x - b.x)
		.map((r) => ({ ...r }));

	const placed: Rect[] = [];
	const out: T[] = [];
	if (sticky) {
		const fixed = { ...sticky, y: Math.max(0, sticky.y) } as T;
		placed.push(fixed);
		out.push(fixed);
	}
	for (const rect of rest) {
		const settled = settle(rect, placed);
		placed.push(settled);
		out.push(settled);
	}
	return out;
}

/** Close every gap, keeping the current reading order. */
export function compact<T extends Rect>(rects: T[]): T[] {
	return place(rects);
}

export function clampX(x: number, w: number): number {
	return Math.min(Math.max(0, Math.round(x)), DASHBOARD_COLUMNS - w);
}

export function clampW(x: number, w: number): number {
	return Math.min(Math.max(MIN_W, Math.round(w)), DASHBOARD_COLUMNS - x);
}

export function clampH(h: number): number {
	return Math.max(MIN_H, Math.round(h));
}

/** Drop the widget at (x, y) and let the rest settle around it. */
export function moveWidget(widgets: Widget[], id: string, x: number, y: number): Widget[] {
	const next = widgets.map((w) =>
		w.id === id ? { ...w, x: clampX(x, w.w), y: Math.max(0, Math.round(y)) } : w
	);
	return place(next, id);
}

/** Resize from the bottom-right corner; x and y stay put. */
export function resizeWidget(widgets: Widget[], id: string, w: number, h: number): Widget[] {
	const next = widgets.map((widget) =>
		widget.id === id ? { ...widget, w: clampW(widget.x, w), h: clampH(h) } : widget
	);
	return place(next, id);
}

/** Where a newly added widget of this size fits without disturbing anything. */
export function findSlot(widgets: Rect[], w: number, h: number): { x: number; y: number } {
	const width = Math.min(w, DASHBOARD_COLUMNS);
	const bottom = widgets.reduce((max, widget) => Math.max(max, widget.y + widget.h), 0);
	for (let y = 0; y <= bottom; y++) {
		for (let x = 0; x <= DASHBOARD_COLUMNS - width; x++) {
			const candidate = { id: '', x, y, w: width, h };
			if (!widgets.some((widget) => overlaps(candidate, widget))) return { x, y };
		}
	}
	return { x: 0, y: bottom };
}
