import type { RangeKey } from '$lib/components/charts/range';

// Widgets on a 12-column grid, stored in the vault so they travel with the
// profile and need no backend support.

export type WidgetKind =
	| 'live-kpi'
	| 'history-chart'
	| 'probe-metric'
	| 'status-summary'
	| 'memory-detail'
	| 'cpu-detail'
	| 'pressure'
	| 'network-detail'
	| 'disk-detail'
	| 'alert-timeline';

/** Built-in live SSE KPI sources — map straight onto LiveStats aggregates. */
export type LiveKpiSource = 'cpu' | 'memory' | 'disk-io' | 'network';

export interface LiveKpiConfig {
	kind: 'live-kpi';
	source: LiveKpiSource;
}

/** History-API backed range chart. */
export type HistoryResource = 'cpu' | 'memory' | 'disk' | 'network';

export interface HistoryChartConfig {
	kind: 'history-chart';
	resource: HistoryResource;
	range: RangeKey;
}

export type ProbeMetricViz = 'scalar' | 'chart';

export interface ProbeMetricConfig {
	kind: 'probe-metric';
	probe: string;
	metric: string;
	/** Free-form unit captured at pick time (history API doesn't echo it back). */
	unit?: string;
	/** Canonical JSON label-set key; undefined = first/most-populated group. */
	labelKey?: string;
	viz: ProbeMetricViz;
}

export type StatusSummaryKind = 'host' | 'services' | 'containers' | 'alerts';

export interface StatusSummaryConfig {
	kind: 'status-summary';
	summary: StatusSummaryKind;
}

/** Active/cache/free bar + swap. Config-less; reads the live SSE snapshot. */
export interface MemoryDetailConfig {
	kind: 'memory-detail';
}

/** Live CPU detail card: load avg + steal/iowait/user/kernel + per-core
 *  heatmap. Config-less — reads the live SSE CpuStats snapshot. */
export interface CpuDetailConfig {
	kind: 'cpu-detail';
}

/** Live PSI card: CPU / memory / I/O some-pressure (avg10/60/300). Config-less,
 *  reads the live SSE pressure snapshot. Empty on non-Linux / pre-4.20 kernels. */
export interface PressureConfig {
	kind: 'pressure';
}

/** Per-interface rates and totals, physical NICs first. Config-less. */
export interface NetworkDetailConfig {
	kind: 'network-detail';
}

/** Per-mount usage and R/W rates, host mounts first. Config-less. */
export interface DiskDetailConfig {
	kind: 'disk-detail';
}

/** Recent alert fire/resolve feed ("what happened lately"). Config-less —
 *  reads /alerts/events joined with rule names. */
export interface AlertTimelineConfig {
	kind: 'alert-timeline';
}

export type WidgetConfig =
	| LiveKpiConfig
	| HistoryChartConfig
	| ProbeMetricConfig
	| StatusSummaryConfig
	| MemoryDetailConfig
	| CpuDetailConfig
	| PressureConfig
	| NetworkDetailConfig
	| DiskDetailConfig
	| AlertTimelineConfig;

export interface Widget {
	id: string;
	/** Grid placement on a 12-column grid; units are grid cells. */
	x: number;
	y: number;
	w: number;
	h: number;
	config: WidgetConfig;
}

export interface DashboardLayout {
	version: 1;
	widgets: Widget[];
}

export const DASHBOARD_COLUMNS = 12;
