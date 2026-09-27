import type { LiveStats, TimeSeries } from '$lib/stores/livestats.svelte';
import type { LiveKpiSource } from '$lib/types/dashboard';
import { metricColor, metricRamp } from '$lib/charts/chart-theme';
import { fmtBps, fmtBytes, fmtPercent } from '$lib/utils/format';
import { m } from '$lib/paraglide/messages';

export const LIVE_KPI_SOURCES: readonly LiveKpiSource[] = ['cpu', 'memory', 'disk-io', 'network'];

/** Everything a card needs to draw one live metric. */
export interface KpiView {
	label: string;
	/** null while the first sample is still on its way. */
	value: number | null;
	format: (v: number) => string;
	secondary: string;
	series: TimeSeries;
	extra?: { data: TimeSeries; color: string };
	color: string;
	min?: number;
	max?: number;
}

const EMPTY: TimeSeries = { xs: [], ys: [] };
const pct = (v: number) => fmtPercent(v, 1);
const bps = (v: number) => fmtBps(v, 1);

export function kpiLabel(source: LiveKpiSource): string {
	switch (source) {
		case 'cpu':
			return m.overview_metric_cpu_label();
		case 'memory':
			return m.overview_metric_memory_label();
		case 'disk-io':
			return m.overview_metric_disk_io_label();
		case 'network':
			return m.overview_metric_network_label();
	}
}

export function kpiView(live: LiveStats | null, source: LiveKpiSource): KpiView {
	const label = kpiLabel(source);
	if (source === 'cpu') {
		const cpu = live?.cpu ?? null;
		return {
			label,
			value: cpu ? cpu.usage_percent : null,
			format: pct,
			secondary: cpu ? m.overview_metric_cores_count({ count: cpu.per_core.length }) : '',
			series: live?.cpuHistory ?? EMPTY,
			color: metricColor('cpu'),
			min: 0,
			max: 100
		};
	}
	if (source === 'memory') {
		const memory = live?.memory ?? null;
		// htop-style active = total - available.
		const total = memory?.total_bytes ?? 0;
		const active = Math.max(0, total - (memory?.available_bytes ?? 0));
		return {
			label,
			value: memory ? (total > 0 ? (active / total) * 100 : 0) : null,
			format: pct,
			secondary: total > 0 ? `${fmtBytes(active)} / ${fmtBytes(total)}` : '',
			series: live?.memoryActivePercentHistory ?? EMPTY,
			color: metricColor('memory'),
			min: 0,
			max: 100
		};
	}
	if (source === 'disk-io') {
		// Read/write are two steps of the metric's own hue.
		const [readColor, writeColor] = metricRamp('disk', 2);
		// Server already strips container overlay mounts from the live feed.
		const disks = live?.disks ?? [];
		const read = disks.reduce((s, d) => s + (d.read_bytes_per_sec ?? 0), 0);
		const write = disks.reduce((s, d) => s + (d.write_bytes_per_sec ?? 0), 0);
		return {
			label,
			value: disks.length > 0 ? read + write : null,
			format: bps,
			secondary: disks.length > 0 ? `R ${fmtBps(read, 0)} · W ${fmtBps(write, 0)}` : '',
			series: live?.diskReadHistory ?? EMPTY,
			extra: live?.diskWriteHistory
				? { data: live.diskWriteHistory, color: writeColor }
				: undefined,
			color: readColor,
			min: 0
		};
	}
	const [rxColor, txColor] = metricRamp('network', 2);
	const network = live?.network ?? [];
	const rx = network.reduce((s, n) => s + n.rx_bytes_per_sec, 0);
	const tx = network.reduce((s, n) => s + n.tx_bytes_per_sec, 0);
	return {
		label,
		value: network.length > 0 ? rx + tx : null,
		format: bps,
		secondary: network.length > 0 ? `↓ ${fmtBps(rx, 0)} · ↑ ${fmtBps(tx, 0)}` : '',
		series: live?.netRxHistory ?? EMPTY,
		extra: live?.netTxHistory ? { data: live.netTxHistory, color: txColor } : undefined,
		color: rxColor,
		min: 0
	};
}

/** The value as the inspect dialog's heading shows it. */
export function kpiCurrent(view: KpiView): string {
	return view.value === null ? '—' : view.format(view.value);
}
