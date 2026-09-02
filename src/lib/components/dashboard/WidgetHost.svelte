<script lang="ts">
	import type { Connection } from '$lib/stores/connections.svelte';
	import type { Widget } from '$lib/types/dashboard';
	import LiveKpiWidget from './widgets/LiveKpiWidget.svelte';
	import HistoryChartWidget from './widgets/HistoryChartWidget.svelte';
	import ProbeMetricWidget from './widgets/ProbeMetricWidget.svelte';
	import StatusSummaryWidget from './widgets/StatusSummaryWidget.svelte';
	import MemoryDetailWidget from './widgets/MemoryDetailWidget.svelte';
	import CpuDetailWidget from './widgets/CpuDetailWidget.svelte';
	import PressureDetailWidget from './widgets/PressureDetailWidget.svelte';
	import NetworkDetailWidget from './widgets/NetworkDetailWidget.svelte';
	import DiskDetailWidget from './widgets/DiskDetailWidget.svelte';
	import AlertTimelineWidget from './widgets/AlertTimelineWidget.svelte';
	import IconTriangleAlert from '~icons/lucide/triangle-alert';
	import { m } from '$lib/paraglide/messages';

	interface Props {
		widget: Widget;
		conn: Connection | null;
	}

	let { widget, conn }: Props = $props();
	let config = $derived(widget.config);
</script>

<!-- Here, not in the grid, so every widget kind inherits it. -->
<svelte:boundary onerror={(e) => console.error('widget failed', widget.config.kind, e)}>
	{#if config.kind === 'live-kpi'}
		<LiveKpiWidget {conn} {config} />
	{:else if config.kind === 'history-chart'}
		<HistoryChartWidget {conn} {config} />
	{:else if config.kind === 'probe-metric'}
		<ProbeMetricWidget {conn} {config} />
	{:else if config.kind === 'status-summary'}
		<StatusSummaryWidget {conn} {config} />
	{:else if config.kind === 'memory-detail'}
		<MemoryDetailWidget {conn} />
	{:else if config.kind === 'cpu-detail'}
		<CpuDetailWidget {conn} />
	{:else if config.kind === 'pressure'}
		<PressureDetailWidget {conn} />
	{:else if config.kind === 'network-detail'}
		<NetworkDetailWidget {conn} />
	{:else if config.kind === 'disk-detail'}
		<DiskDetailWidget {conn} />
	{:else if config.kind === 'alert-timeline'}
		<AlertTimelineWidget {conn} />
	{/if}

	{#snippet failed(_error, reset)}
		<div
			class="flex h-full flex-col items-center justify-center gap-2 rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-4 text-center"
		>
			<IconTriangleAlert class="size-4 text-[var(--color-warning)]" stroke-width="2" />
			<p class="text-2xs leading-snug text-[var(--color-fg-muted)]">
				{m.dashboard_widget_failed()}
			</p>
			<button
				type="button"
				onclick={reset}
				class="text-2xs text-[var(--color-accent)] transition hover:underline"
			>
				{m.probes_retry()}
			</button>
		</div>
	{/snippet}
</svelte:boundary>
