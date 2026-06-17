import type { DashboardLayout, WidgetKind } from '$lib/types/dashboard';
import { m } from '$lib/paraglide/messages';

export interface WidgetMeta {
	kind: WidgetKind;
	label: () => string;
	defaultSize: { w: number; h: number };
	/** Widget reads the live SSE feed → the dashboard must hold the stream open. */
	needsLive: boolean;
}

export const WIDGET_META: Record<WidgetKind, WidgetMeta> = {
	'live-kpi': {
		kind: 'live-kpi',
		label: () => m.dashboard_widget_live_kpi(),
		defaultSize: { w: 3, h: 2 },
		needsLive: true
	},
	'history-chart': {
		kind: 'history-chart',
		label: () => m.dashboard_widget_history_chart(),
		defaultSize: { w: 6, h: 4 },
		needsLive: false
	},
	'probe-metric': {
		kind: 'probe-metric',
		label: () => m.dashboard_widget_probe_metric(),
		defaultSize: { w: 4, h: 3 },
		needsLive: false
	},
	'status-summary': {
		kind: 'status-summary',
		label: () => m.dashboard_widget_status_summary(),
		defaultSize: { w: 4, h: 2 },
		needsLive: false
	},
	'memory-detail': {
		kind: 'memory-detail',
		label: () => m.dashboard_widget_memory_detail(),
		defaultSize: { w: 4, h: 3 },
		needsLive: true
	},
	'cpu-detail': {
		kind: 'cpu-detail',
		label: () => m.dashboard_widget_cpu_detail(),
		defaultSize: { w: 6, h: 4 },
		needsLive: true
	},
	pressure: {
		kind: 'pressure',
		label: () => m.dashboard_widget_pressure(),
		defaultSize: { w: 6, h: 2 },
		needsLive: true
	},
	'network-detail': {
		kind: 'network-detail',
		label: () => m.dashboard_widget_network_detail(),
		defaultSize: { w: 4, h: 3 },
		needsLive: true
	}
};

/** True if any widget in the layout needs the live SSE stream. */
export function layoutNeedsLive(layout: DashboardLayout): boolean {
	return layout.widgets.some((w) => WIDGET_META[w.config.kind]?.needsLive === true);
}
