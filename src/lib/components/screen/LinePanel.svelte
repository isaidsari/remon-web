<script lang="ts">
	import HistoryChart, { type Series } from '$lib/components/charts/HistoryChart.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import Skeleton from '$lib/components/ui/Skeleton.svelte';
	import { categoricalColors } from '$lib/charts/chart-theme';
	import { lineSeries, seriesId } from '$lib/screen/plan';
	import { formatAxis, formatValue } from '$lib/screen/format';
	import type { QueryResult, SeriesSpec } from '$lib/types/screen';
	import { m } from '$lib/paraglide/messages';
	import PanelError from './PanelError.svelte';

	interface Props {
		title: string;
		specs: SeriesSpec[];
		range: string;
		path: string;
		results: Map<string, QueryResult> | null;
	}

	let { title, specs, range, path, results }: Props = $props();

	let data = $derived(results ? lineSeries(specs, path, results) : null);
	let chart = $derived(results?.get(seriesId(path, 0))?.chart);
	let series = $derived.by((): Series[] => {
		if (!data) return [];
		const colors = categoricalColors(data.series.length);
		return data.series.map((s, i) => ({
			name: s.name,
			data: { xs: s.xs, ys: s.ys },
			color: colors[i]
		}));
	});
	let seriesKey = $derived(series.map((s) => s.name).join('|'));
	let isPercent = $derived(data?.unit === 'percent');
</script>

<Card class="flex h-full flex-col" padding="sm">
	<div class="mb-1.5 flex items-baseline justify-between gap-2">
		<h2 class="truncate text-sm font-medium text-[var(--color-fg)]">{title}</h2>
		<span class="text-3xs shrink-0 font-mono text-[var(--color-fg-subtle)]">{range}</span>
	</div>
	<div class="min-h-[200px] flex-1">
		{#if !data}
			<Skeleton class="h-[200px] w-full" rounded="lg" />
		{:else if series.length === 0}
			<p class="text-2xs py-8 text-center text-[var(--color-fg-subtle)]">
				{m.screen_no_data()}
			</p>
		{:else}
			{#key seriesKey}
				<HistoryChart
					compact
					height={200}
					{series}
					timeWindow={chart
						? { start: chart.aligned.start, end: Math.min(chart.aligned.end, chart.as_of) }
						: undefined}
					valueFormatter={(v) => formatValue(v, data?.unit)}
					axisFormatter={(v) => formatAxis(v, data?.unit)}
					yMin={isPercent ? 0 : undefined}
				/>
			{/key}
		{/if}
	</div>
	{#each data?.errors ?? [] as error (error)}
		<PanelError {error} />
	{/each}
</Card>
