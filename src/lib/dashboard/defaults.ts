import { RANGE_SECONDS } from '$lib/components/charts/range';
import type { DashboardLayout, Widget, WidgetConfig } from '$lib/types/dashboard';
import { DASHBOARD_COLUMNS } from '$lib/types/dashboard';

const LIVE_KPI_SOURCES = ['cpu', 'memory', 'disk-io', 'network'] as const;
const HISTORY_RESOURCES = ['cpu', 'memory', 'disk', 'network'] as const;
const HISTORY_RANGES = Object.keys(RANGE_SECONDS) as Array<keyof typeof RANGE_SECONDS>;
const STATUS_SUMMARIES = ['host', 'services', 'containers', 'alerts'] as const;

export function widgetId(): string {
	if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
	return 'w-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function widget(x: number, y: number, w: number, h: number, config: WidgetConfig): Widget {
	return { id: widgetId(), x, y, w, h, config };
}

/**
 * The layout a fresh / migrated profile starts with — a close stand-in for the
 * old fixed overview: four live KPIs across the top, a host summary band, then
 * CPU / memory / disk / network history charts two-up.
 */
export function defaultDashboard(): DashboardLayout {
	return {
		version: 1,
		widgets: [
			widget(0, 0, 3, 2, { kind: 'live-kpi', source: 'cpu' }),
			widget(3, 0, 3, 2, { kind: 'live-kpi', source: 'memory' }),
			widget(6, 0, 3, 2, { kind: 'live-kpi', source: 'disk-io' }),
			widget(9, 0, 3, 2, { kind: 'live-kpi', source: 'network' }),
			widget(0, 2, 12, 2, { kind: 'status-summary', summary: 'host' }),
			widget(0, 4, 6, 4, { kind: 'history-chart', resource: 'cpu', range: '1h' }),
			widget(6, 4, 6, 4, { kind: 'history-chart', resource: 'memory', range: '1h' }),
			widget(0, 8, 6, 4, { kind: 'history-chart', resource: 'disk', range: '1h' }),
			widget(6, 8, 6, 4, { kind: 'history-chart', resource: 'network', range: '1h' })
		]
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function isStringIn<T extends string>(value: unknown, allowed: readonly T[]): value is T {
	return typeof value === 'string' && allowed.includes(value as T);
}

function cleanInt(value: unknown, fallback: number, min: number, max = Number.MAX_SAFE_INTEGER) {
	const n = typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : fallback;
	return Math.min(max, Math.max(min, n));
}

function normalizeConfig(input: unknown): WidgetConfig | null {
	if (!isRecord(input)) return null;
	if (input.kind === 'live-kpi' && isStringIn(input.source, LIVE_KPI_SOURCES)) {
		return { kind: 'live-kpi', source: input.source };
	}
	if (
		input.kind === 'history-chart' &&
		isStringIn(input.resource, HISTORY_RESOURCES) &&
		isStringIn(input.range, HISTORY_RANGES)
	) {
		return { kind: 'history-chart', resource: input.resource, range: input.range };
	}
	if (input.kind === 'status-summary' && isStringIn(input.summary, STATUS_SUMMARIES)) {
		return { kind: 'status-summary', summary: input.summary };
	}
	if (input.kind === 'memory-detail') {
		return { kind: 'memory-detail' };
	}
	if (input.kind === 'cpu-detail') {
		return { kind: 'cpu-detail' };
	}
	if (input.kind === 'pressure') {
		return { kind: 'pressure' };
	}
	if (input.kind === 'network-detail') {
		return { kind: 'network-detail' };
	}
	if (input.kind === 'disk-detail') {
		return { kind: 'disk-detail' };
	}
	if (
		input.kind !== 'probe-metric' ||
		typeof input.probe !== 'string' ||
		typeof input.metric !== 'string'
	) {
		return null;
	}
	if (input.probe.trim() === '' || input.metric.trim() === '') return null;
	return {
		kind: 'probe-metric',
		probe: input.probe,
		metric: input.metric,
		unit: typeof input.unit === 'string' && input.unit.trim() !== '' ? input.unit : undefined,
		labelKey:
			typeof input.labelKey === 'string' && input.labelKey.trim() !== ''
				? input.labelKey
				: undefined,
		viz: input.viz === 'scalar' ? 'scalar' : 'chart'
	};
}

function normalizeWidget(input: unknown): Widget | null {
	if (!isRecord(input)) return null;
	const config = normalizeConfig(input.config);
	if (!config) return null;
	const x = cleanInt(input.x, 0, 0, DASHBOARD_COLUMNS - 1);
	const w = cleanInt(input.w, 1, 1, DASHBOARD_COLUMNS - x);
	return {
		id: typeof input.id === 'string' && input.id.trim() !== '' ? input.id : widgetId(),
		x,
		y: cleanInt(input.y, 0, 0),
		w,
		h: cleanInt(input.h, 2, 1),
		config
	};
}

/** Sanitize persisted dashboard JSON before rendering or saving it again. */
export function normalizeDashboard(input: unknown): DashboardLayout {
	if (!isRecord(input) || !Array.isArray(input.widgets)) return defaultDashboard();
	return {
		version: 1,
		widgets: input.widgets.map(normalizeWidget).filter((w): w is Widget => w !== null)
	};
}
