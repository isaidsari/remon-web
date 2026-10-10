import { RANGE_SECONDS } from '$lib/components/charts/range';
import { LIVE_KPI_SOURCES } from './live-kpi';
import type { WidgetConfig } from '$lib/types/dashboard';

// The built-in cards' configs, as a screen's `widget` node carries them. A
// node arrives from the daemon, a URL or the vault, so it is checked here
// before WidgetHost sees it.

const HISTORY_RESOURCES = ['cpu', 'memory', 'disk', 'network'] as const;
const HISTORY_RANGES = Object.keys(RANGE_SECONDS) as Array<keyof typeof RANGE_SECONDS>;
const STATUS_SUMMARIES = ['host', 'services', 'containers', 'alerts'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function isStringIn<T extends string>(value: unknown, allowed: readonly T[]): value is T {
	return typeof value === 'string' && allowed.includes(value as T);
}

/** One untrusted widget config, or null when this build cannot draw it. */
export function normalizeConfig(input: unknown): WidgetConfig | null {
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
	if (input.kind === 'live-vitals') {
		return { kind: 'live-vitals' };
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
	if (input.kind === 'alert-timeline') {
		return { kind: 'alert-timeline' };
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
