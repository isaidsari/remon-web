<script lang="ts">
	import HistoryChart, { type Series } from '$lib/components/charts/HistoryChart.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import Skeleton from '$lib/components/ui/Skeleton.svelte';
	import type { Connection } from '$lib/stores/connections.svelte';
	import type { ProbeMetricConfig } from '$lib/types/dashboard';
	import type { ProbeMetricHistoryResponse, ProbeMetricPoint } from '$lib/types/api';
	import { groupPointsByLabel, formatMetricValue, formatLabelKey } from '$lib/utils/probeMetrics';
	import { m } from '$lib/paraglide/messages';

	interface Props {
		conn: Connection | null;
		config: ProbeMetricConfig;
	}

	let { conn, config }: Props = $props();

	let data = $state<ProbeMetricHistoryResponse | null>(null);
	let loading = $state(true);
	let failed = $state(false);

	async function fetchData() {
		if (!conn?.isAuthenticated) return;
		try {
			data = await conn.client.getProbeMetricHistory(config.probe, config.metric, { limit: 500 });
			failed = false;
		} catch {
			failed = true;
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		void config.probe;
		void config.metric;
		if (!conn?.isAuthenticated) return;
		loading = true;
		void fetchData();
		const t = setInterval(fetchData, 30_000);
		return () => clearInterval(t);
	});

	let unit = $derived(config.unit ?? null);
	let groups = $derived(data ? groupPointsByLabel(data.points) : []);
	let activeGroup = $derived(
		(config.labelKey ? groups.find((g) => g.key === config.labelKey) : undefined) ?? groups[0]
	);
	let latest = $derived<ProbeMetricPoint | undefined>(
		activeGroup && activeGroup.points.length > 0
			? activeGroup.points[activeGroup.points.length - 1]
			: undefined
	);

	function fmt(v: number): string {
		return formatMetricValue(v, unit);
	}

	let series = $derived.by((): Series[] => {
		if (!activeGroup) return [];
		return [
			{
				name: config.metric,
				data: {
					xs: activeGroup.points.map((p) => p.timestamp),
					ys: activeGroup.points.map((p) => p.value)
				},
				color: '#818cf8',
				fill: true
			}
		];
	});
	let seriesKey = $derived(activeGroup?.key ?? '');
	let isPercent = $derived((unit ?? '').trim().toLowerCase() === 'percent');
	let activeLabel = $derived(activeGroup ? formatLabelKey(activeGroup.key) : '');
</script>

<Card class="flex h-full flex-col">
	<div class="mb-2 flex items-baseline justify-between gap-2">
		<div class="flex min-w-0 items-baseline gap-2">
			<h2
				class="truncate font-mono text-[12px] font-medium text-[var(--color-fg)]"
				title={config.probe}
			>
				{config.metric}
			</h2>
			{#if unit}<span class="font-mono text-[10px] text-[var(--color-fg-subtle)]">{unit}</span>{/if}
		</div>
		<div class="flex min-w-0 flex-col items-end">
			<span
				class="truncate font-mono text-[10px] text-[var(--color-fg-subtle)]"
				title={config.probe}
			>
				{config.probe}
			</span>
			{#if activeLabel}
				<span
					class="truncate font-mono text-[10px] text-[var(--color-fg-faint)]"
					title={activeLabel}
				>
					{activeLabel}
				</span>
			{/if}
		</div>
	</div>

	{#if loading && !data}
		<Skeleton class="h-full min-h-[80px] w-full" rounded="lg" />
	{:else if failed}
		<p class="py-2 text-[11px] text-[var(--color-fg-subtle)]">{m.probes_metric_unavailable()}</p>
	{:else if !activeGroup || activeGroup.points.length === 0}
		<p class="py-2 text-[11px] text-[var(--color-fg-subtle)]">{m.probes_metric_no_data()}</p>
	{:else if config.viz === 'scalar'}
		<div class="flex flex-1 flex-col items-start justify-center">
			<span class="font-mono text-[28px] font-semibold tabular-nums text-[var(--color-fg)]">
				{latest ? fmt(latest.value) : '—'}
			</span>
		</div>
	{:else}
		<div class="min-h-0 flex-1">
			{#key seriesKey}
				<HistoryChart
					{series}
					valueFormatter={(v) => (v == null ? '' : fmt(v))}
					yMin={isPercent ? 0 : undefined}
					yMax={isPercent ? 100 : undefined}
					relativeScale={!isPercent}
					height={0}
					class="h-full"
				/>
			{/key}
		</div>
	{/if}
</Card>
