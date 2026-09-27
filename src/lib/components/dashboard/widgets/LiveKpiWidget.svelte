<script lang="ts">
	import MetricCard from '$lib/components/overview/MetricCard.svelte';
	import LiveMetricModal from './LiveMetricModal.svelte';
	import type { Connection } from '$lib/stores/connections.svelte';
	import type { LiveKpiConfig } from '$lib/types/dashboard';
	import { kpiCurrent, kpiView } from '$lib/dashboard/live-kpi';
	import { m } from '$lib/paraglide/messages';

	interface Props {
		conn: Connection | null;
		config: LiveKpiConfig;
		editing?: boolean;
	}

	let { conn, config, editing = false }: Props = $props();
	let expanded = $state(false);
	let view = $derived(kpiView(conn?.live ?? null, config.source));
	// MetricCard has no border of its own; on the dashboard each KPI stands alone.
	let cardCls = $derived(
		'h-full rounded-[var(--radius-card)] shadow-[var(--shadow-flat)]' +
			(editing
				? ''
				: ' group-hover:bg-[var(--color-surface-2)] group-focus-within:bg-[var(--color-surface-2)]')
	);
</script>

<div
	class={`group relative h-full transition-transform duration-150 ${editing ? '' : 'motion-safe:focus-within:-translate-y-0.5 motion-safe:hover:-translate-y-0.5'}`}
>
	<MetricCard
		class={cardCls}
		label={view.label}
		value={view.value}
		format={view.format}
		secondary={view.secondary}
		series={view.series}
		extra={view.extra}
		color={view.color}
		min={view.min}
		max={view.max}
	/>
	{#if !editing}
		<button
			type="button"
			onclick={() => (expanded = true)}
			aria-label={m.overview_metric_inspect({ metric: view.label })}
			aria-haspopup="dialog"
			title={m.overview_metric_inspect({ metric: view.label })}
			class="absolute inset-0 cursor-pointer rounded-[var(--radius-card)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]"
		>
		</button>
	{/if}
</div>
{#if expanded && !editing}
	<LiveMetricModal
		{conn}
		source={config.source}
		title={view.label}
		current={kpiCurrent(view)}
		onClose={() => (expanded = false)}
	/>
{/if}
