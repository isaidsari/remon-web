import type { Screen, ScreenNode } from '$lib/types/screen';
import { parseScreen } from './spec';

// The overview page is a screen like any other: stored per server in the
// vault, edited by asking the assistant, drawn by the renderer.

const widget = (config: Record<string, unknown>): ScreenNode => ({ type: 'widget', config });

/** What a server shows before anyone changes it. */
export function defaultHome(): Screen {
	return {
		title: 'overview',
		range: '1h',
		root: {
			type: 'grid',
			columns: 1,
			children: [
				widget({ kind: 'live-vitals' }),
				{
					type: 'grid',
					columns: 2,
					children: [
						widget({ kind: 'history-chart', resource: 'cpu', range: '1h' }),
						widget({ kind: 'alert-timeline' })
					]
				},
				{
					type: 'grid',
					columns: 2,
					children: [
						widget({ kind: 'history-chart', resource: 'memory', range: '1h' }),
						widget({ kind: 'history-chart', resource: 'network', range: '1h' })
					]
				},
				widget({ kind: 'history-chart', resource: 'disk', range: '1h' })
			]
		}
	};
}

/** The saved home screen, or the default when none is saved or it no longer parses. */
export function homeScreen(saved: unknown): Screen {
	return (saved ? parseScreen(saved) : null) ?? defaultHome();
}
