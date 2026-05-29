<script lang="ts">
	import HistoryChart, { type Series } from '$lib/components/charts/HistoryChart.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import Skeleton from '$lib/components/ui/Skeleton.svelte';
	import { RANGE_SECONDS } from '$lib/components/charts/range';
	import type { Connection } from '$lib/stores/connections.svelte';
	import type { HistoryChartConfig } from '$lib/types/dashboard';
	import { fmtBps, fmtPercent } from '$lib/utils/format';
	import { isPhysicalInterface, isContainerMount } from '$lib/utils/netClassify';
	import { m } from '$lib/paraglide/messages';
	import type { BatchSeries } from '$lib/types/api';

	interface Props {
		conn: Connection | null;
		config: HistoryChartConfig;
	}

	let { conn, config }: Props = $props();

	let points = $state<BatchSeries | null>(null);
	let loading = $state(true);

	const DISK_PALETTE = [
		'rgb(251,191,36)',
		'rgb(244,114,182)',
		'rgb(16,185,129)',
		'rgb(56,189,248)',
		'rgb(217,70,239)'
	];

	async function fetchData() {
		if (!conn?.isAuthenticated) return;
		const end = Math.floor(Date.now() / 1000);
		const start = end - RANGE_SECONDS[config.range];
		try {
			const batch = await conn.client.metricsBatch({ resources: config.resource, start, end });
			points = batch.series.find((s) => s.resource === config.resource) ?? null;
		} catch {
			// Leave previous data in place; transient fetch failures shouldn't blank the widget.
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		void config.resource;
		void config.range;
		if (!conn?.isAuthenticated) return;
		loading = true;
		void fetchData();
		const t = setInterval(fetchData, 60_000);
		return () => clearInterval(t);
	});

	let title = $derived(
		config.resource === 'cpu'
			? m.metrics_card_cpu_title()
			: config.resource === 'memory'
				? m.metrics_card_memory_title()
				: config.resource === 'disk'
					? m.metrics_card_disk_title()
					: m.metrics_card_network_title()
	);

	let isPercent = $derived(
		config.resource === 'cpu' || config.resource === 'memory' || config.resource === 'disk'
	);
	let fmt = $derived(
		isPercent
			? (v: number | null) => (v == null ? '—' : fmtPercent(v, 1))
			: (v: number | null) => (v == null ? '—' : fmtBps(v, 1))
	);

	let series = $derived.by((): Series[] => {
		const p = points;
		if (!p) return [];
		if (p.resource === 'cpu') {
			return [
				{
					name: m.metrics_series_usage(),
					data: { xs: p.points.map((x) => x.timestamp), ys: p.points.map((x) => x.usage_percent) },
					color: 'rgb(96,165,250)'
				}
			];
		}
		if (p.resource === 'memory') {
			const xs = p.points.map((x) => x.timestamp);
			const ys = p.points.map((x) => {
				const total = x.used_bytes + x.available_bytes;
				return total > 0 ? (x.used_bytes / total) * 100 : 0;
			});
			return [
				{ name: m.overview_card_memory_title(), data: { xs, ys }, color: 'rgb(167,139,250)' }
			];
		}
		if (p.resource === 'disk') {
			const byMount: Record<string, { xs: number[]; ys: number[] }> = {};
			const mountOrder: string[] = [];
			for (const pt of p.points) {
				if (isContainerMount(pt.mount_point)) continue;
				let s = byMount[pt.mount_point];
				if (!s) {
					s = { xs: [], ys: [] };
					byMount[pt.mount_point] = s;
					mountOrder.push(pt.mount_point);
				}
				s.xs.push(pt.timestamp);
				const total = pt.used_bytes + pt.available_bytes;
				s.ys.push(total > 0 ? (pt.used_bytes / total) * 100 : 0);
			}
			return mountOrder.map((name, i) => ({
				name,
				data: byMount[name],
				color: DISK_PALETTE[i % DISK_PALETTE.length]
			}));
		}
		if (p.resource !== 'network') return [];
		const sums: Record<number, { rx: number; tx: number }> = {};
		const timestamps: number[] = [];
		for (const pt of p.points) {
			if (!isPhysicalInterface(pt.interface_name)) continue;
			let s = sums[pt.timestamp];
			if (!s) {
				s = { rx: 0, tx: 0 };
				sums[pt.timestamp] = s;
				timestamps.push(pt.timestamp);
			}
			s.rx += pt.rx_bytes_per_sec;
			s.tx += pt.tx_bytes_per_sec;
		}
		const xs = timestamps.sort((a, b) => a - b);
		return [
			{
				name: 'RX',
				data: { xs, ys: xs.map((x) => sums[x].rx) },
				color: 'rgb(96,165,250)',
				fill: true
			},
			{
				name: 'TX',
				data: { xs, ys: xs.map((x) => sums[x].tx) },
				color: 'rgb(52,211,153)',
				fill: true
			}
		];
	});

	let seriesKey = $derived(series.map((s) => s.name).join('|'));
</script>

<Card class="flex h-full flex-col">
	<div class="mb-2 flex items-baseline justify-between gap-2">
		<h2 class="text-sm font-medium text-[var(--color-fg)]">{title}</h2>
		<span class="font-mono text-[10px] text-[var(--color-fg-subtle)]">{config.range}</span>
	</div>
	<div class="min-h-0 flex-1">
		{#if loading && !points}
			<Skeleton class="h-full min-h-[160px] w-full" rounded="lg" />
		{:else}
			{#key seriesKey}
				<HistoryChart
					{series}
					valueFormatter={fmt}
					yMin={isPercent ? 0 : undefined}
					yMax={isPercent ? 100 : undefined}
					height={0}
					class="h-full"
				/>
			{/key}
		{/if}
	</div>
</Card>
