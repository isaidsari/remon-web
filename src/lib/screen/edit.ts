import type { Screen, ScreenNode } from '$lib/types/screen';

// Hand edits on a screen, by the same paths the renderer uses
// (`root.children[1].tabs[0].child`). Bigger changes go through the
// assistant; these are the ones a click should do: drop a panel, move one.
// Every function returns a new screen and leaves its input alone.

type Step = { kind: 'children' | 'tabs'; index: number };

function parsePath(path: string): Step[] | null {
	if (!path.startsWith('root')) return null;
	const steps: Step[] = [];
	const re = /\.children\[(\d+)\]|\.tabs\[(\d+)\]\.child/gy;
	re.lastIndex = 'root'.length;
	while (re.lastIndex < path.length) {
		const m = re.exec(path);
		if (!m) return null;
		steps.push(
			m[1] !== undefined ? { kind: 'children', index: +m[1] } : { kind: 'tabs', index: +m[2] }
		);
	}
	return steps;
}

function childAt(node: ScreenNode, step: Step): ScreenNode | undefined {
	if (step.kind === 'children' && node.type === 'grid') return node.children[step.index];
	if (step.kind === 'tabs' && node.type === 'tabs') return node.tabs[step.index]?.child;
	return undefined;
}

/** The grid holding `path`, and the index in it; null when the parent is not a grid. */
function parentGrid(
	root: ScreenNode,
	path: string
): { grid: Extract<ScreenNode, { type: 'grid' }>; index: number; trail: ScreenNode[] } | null {
	const steps = parsePath(path);
	if (!steps?.length) return null;
	const trail: ScreenNode[] = [root];
	let node: ScreenNode | undefined = root;
	for (const step of steps.slice(0, -1)) {
		node = childAt(node, step);
		if (!node) return null;
		trail.push(node);
	}
	const last = steps[steps.length - 1];
	if (node.type !== 'grid' || last.kind !== 'children' || !node.children[last.index]) return null;
	return { grid: node, index: last.index, trail };
}

/** Remove a panel. A grid emptied by it goes too, unless it is the root. */
export function removeAt(screen: Screen, path: string): Screen {
	const next = structuredClone(screen);
	const found = parentGrid(next.root, path);
	if (!found) return screen;
	found.grid.children.splice(found.index, 1);
	// Collapse grids that this left empty, innermost first.
	let current = path.slice(0, path.lastIndexOf('.children['));
	while (current !== 'root') {
		const parent = parentGrid(next.root, current);
		if (!parent) break;
		const node = parent.grid.children[parent.index];
		if (node.type !== 'grid' || node.children.length > 0) break;
		parent.grid.children.splice(parent.index, 1);
		current = current.slice(0, current.lastIndexOf('.children['));
	}
	return next;
}

/** Swap a panel with its neighbour in the same grid; out of range is a no-op. */
export function moveAt(screen: Screen, path: string, delta: -1 | 1): Screen {
	const next = structuredClone(screen);
	const found = parentGrid(next.root, path);
	if (!found) return screen;
	const to = found.index + delta;
	const children = found.grid.children;
	if (to < 0 || to >= children.length) return screen;
	[children[found.index], children[to]] = [children[to], children[found.index]];
	return next;
}

/** Hand edits wired into the renderer; present only while editing. */
export interface ScreenEdit {
	remove: (path: string) => void;
	move: (path: string, delta: -1 | 1) => void;
}
