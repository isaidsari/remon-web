<script lang="ts">
	import Modal from '$lib/components/ui/Modal.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Skeleton from '$lib/components/ui/Skeleton.svelte';
	import SegmentedControl from '$lib/components/ui/SegmentedControl.svelte';
	import HistoryChart, { type Series } from '$lib/components/charts/HistoryChart.svelte';
	import ChartResolution from '$lib/components/charts/ChartResolution.svelte';
	import { chartPointBudget } from '$lib/charts/point-budget';
	import CpuDetailWidget from './CpuDetailWidget.svelte';
	import MemoryDetailWidget from './MemoryDetailWidget.svelte';
	import NetworkDetailWidget from './NetworkDetailWidget.svelte';
	import DiskDetailWidget from './DiskDetailWidget.svelte';
	import type { Connection } from '$lib/stores/connections.svelte';
	import type { LiveKpiSource } from '$lib/types/dashboard';
	import type { BatchSeries } from '$lib/types/api';
	import { observedHistory, groupHistory } from '$lib/charts/observed-history';
	import { metricColor, metricRamp } from '$lib/charts/chart-theme';
	import { isContainerMount } from '$lib/utils/netClassify';
	import { fmtPercent, fmtBps } from '$lib/utils/format';
	import { m } from '$lib/paraglide/messages';

	let {
		conn,
		source,
		title,
		current,
		onClose
	}: {
		conn: Connection | null;
		source: LiveKpiSource;
		title: string;
		current: string;
		onClose: () => void;
	} = $props();
	let range = $state('900');
	let loadedRange = $state('900');
	let data = $state<BatchSeries | null>(null);
	let loading = $state(true);
	let failed = $state(false);
	let retry = $state(0);
	let chartWidth = $state(0);
	let maxPoints = $derived(chartPointBudget(chartWidth));
	let chart = $derived(data && 'chart' in data ? data.chart : undefined);
	let percent = $derived(source === 'cpu' || source === 'memory');
	let format = $derived(
		percent
			? (v: number | null) => (v == null ? '—' : fmtPercent(v, 1))
			: (v: number | null) => (v == null ? '—' : fmtBps(v, 1))
	);

	$effect(() => {
		const client = conn?.isAuthenticated ? conn.client : null;
		const resource = source === 'disk-io' ? 'disk' : source;
		const seconds = Number(range);
		const budget = maxPoints;
		void retry;
		const controller = new AbortController();
		loading = true;
		failed = false;
		let pending = false;
		async function fetchData() {
			if (pending) return;
			if (!client) {
				loading = false;
				failed = true;
				return;
			}
			pending = true;
			try {
				const end = Math.floor(Date.now() / 1000);
				const batch = await client.metricsBatch(
					{ resources: resource, start: end - seconds, end, limit: 5000, max_points: budget },
					{ signal: controller.signal }
				);
				if (controller.signal.aborted) return;
				data = batch.series.find((s) => s.resource === resource) ?? null;
				loadedRange = String(seconds);
				failed = false;
			} catch {
				if (!controller.signal.aborted) failed = true;
			} finally {
				pending = false;
				if (!controller.signal.aborted) loading = false;
			}
		}
		void fetchData();
		const timer = setInterval(() => {
			if (!document.hidden) void fetchData();
		}, 30_000);
		return () => {
			controller.abort();
			clearInterval(timer);
		};
	});

	let series = $derived.by((): Series[] => {
		if (!data) return [];
		if (data.resource === 'cpu')
			return [
				{
					name: title,
					color: metricColor('cpu'),
					...observedHistory(data.points, 'usage_percent', (p) => p.usage_percent)
				}
			];
		if (data.resource === 'memory')
			return [
				{
					name: title,
					color: metricColor('memory'),
					...observedHistory(data.points, 'used_percent', (p) => p.used_percent)
				}
			];
		if (data.resource === 'network') {
			const colors = metricRamp('network', 2);
			return [
				{
					name: m.overview_iface_receive(),
					color: colors[0],
					...observedHistory(data.totals, 'rx_bytes_per_sec', (p) => p.rx_bytes_per_sec)
				},
				{
					name: m.overview_iface_transmit(),
					color: colors[1],
					...observedHistory(data.totals, 'tx_bytes_per_sec', (p) => p.tx_bytes_per_sec)
				}
			];
		}
		if (data.resource === 'disk') {
			const groups = [
				...groupHistory(
					data.points.filter((p) => !isContainerMount(p.mount_point)),
					(p) => p.mount_point
				)
			];
			const colors = metricRamp('disk', groups.length * 2);
			return groups.flatMap(([mount, points], index) => [
				{
					name: `${mount} · ${m.history_disk_read()}`,
					color: colors[index * 2],
					...observedHistory(points, 'read_bytes_per_sec', (p) => p.read_bytes_per_sec)
				},
				{
					name: `${mount} · ${m.history_disk_write()}`,
					color: colors[index * 2 + 1],
					...observedHistory(points, 'write_bytes_per_sec', (p) => p.write_bytes_per_sec)
				}
			]);
		}
		return [];
	});
	let hasData = $derived(series.some((s) => s.data.ys.some(Number.isFinite)));
</script>

<Modal open {title} {onClose} width="lg">
	<div class="mb-5 flex flex-wrap items-end justify-between gap-4">
		<div>
			<p class="text-xs text-[var(--color-fg-muted)]">{m.chart_range_now()}</p>
			<p class="mt-1 font-mono text-2xl font-semibold tabular-nums">{current}</p>
		</div>
		<SegmentedControl
			value={range}
			options={[
				{ value: '900', label: m.overview_metric_15m() },
				{ value: '3600', label: m.overview_metric_1h() },
				{ value: '21600', label: m.overview_metric_6h() }
			]}
			onSelect={(value) => (range = value)}
			ariaLabel={m.chart_range_aria_time()}
		/>
	</div>
	{#if failed}
		<div
			role="status"
			class="mb-3 flex items-center justify-between gap-3 text-xs text-[var(--color-fg-muted)]"
		>
			{m.overview_metric_history_failed()}
			<Button variant="secondary" size="sm" onclick={() => retry++}>{m.probes_retry()}</Button>
		</div>
	{/if}
	<ChartResolution {chart} />
	<div class="relative" aria-busy={loading} bind:clientWidth={chartWidth}>
		{#if loading}
			<Skeleton class="h-[260px] w-full" rounded="lg" />
		{:else}
			{#key loadedRange}
				<HistoryChart
					{series}
					timeWindow={chart
						? { start: chart.aligned.start, end: Math.min(chart.aligned.end, chart.as_of) }
						: undefined}
					height={260}
					valueFormatter={format}
					yMin={0}
					yMax={percent ? 100 : undefined}
					compact
					showAllRanges
					rangeOpacity={0.14}
				/>
			{/key}
			{#if !hasData && !failed}
				<p
					class="pointer-events-none absolute inset-0 flex h-[260px] items-center justify-center text-sm text-[var(--color-fg-muted)]"
				>
					{m.probes_metric_no_data()}
				</p>
			{/if}
		{/if}
	</div>
	<div class="mt-5 border-t border-[var(--color-border)] pt-4">
		{#if source === 'cpu'}<CpuDetailWidget {conn} />
		{:else if source === 'memory'}<MemoryDetailWidget {conn} />
		{:else if source === 'disk-io'}<DiskDetailWidget {conn} />
		{:else}<NetworkDetailWidget {conn} />{/if}
	</div>
	{#snippet footer()}<Button variant="secondary" onclick={onClose}>{m.common_dismiss()}</Button
		>{/snippet}
</Modal>
