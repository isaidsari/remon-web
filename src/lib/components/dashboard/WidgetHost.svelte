<script lang="ts">
	import type { Connection } from '$lib/stores/connections.svelte';
	import type { Widget } from '$lib/types/dashboard';
	import LiveKpiWidget from './widgets/LiveKpiWidget.svelte';
	import HistoryChartWidget from './widgets/HistoryChartWidget.svelte';
	import ProbeMetricWidget from './widgets/ProbeMetricWidget.svelte';
	import StatusSummaryWidget from './widgets/StatusSummaryWidget.svelte';
	import MemoryDetailWidget from './widgets/MemoryDetailWidget.svelte';
	import CpuDetailWidget from './widgets/CpuDetailWidget.svelte';

	interface Props {
		widget: Widget;
		conn: Connection | null;
	}

	let { widget, conn }: Props = $props();
	let config = $derived(widget.config);
</script>

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
{/if}
