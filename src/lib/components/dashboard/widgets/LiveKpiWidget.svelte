<script lang="ts">
	import MetricCard from '$lib/components/overview/MetricCard.svelte';
	import LiveMetricModal from './LiveMetricModal.svelte';
	import type { Connection } from '$lib/stores/connections.svelte';
	import type { LiveKpiConfig } from '$lib/types/dashboard';
	import { fmtBps, fmtBytes, fmtPercent } from '$lib/utils/format';
	import { m } from '$lib/paraglide/messages';
	import { metricColor, metricRamp } from '$lib/charts/chart-theme';

	interface Props {
		conn: Connection | null;
		config: LiveKpiConfig;
		editing?: boolean;
	}

	let { conn, config, editing = false }: Props = $props();
	let expanded = $state(false);
	let title = $derived(
		config.source === 'cpu'
			? m.overview_metric_cpu_label()
			: config.source === 'memory'
				? m.overview_metric_memory_label()
				: config.source === 'disk-io'
					? m.overview_metric_disk_io_label()
					: m.overview_metric_network_label()
	);
	// Read/write and rx/tx are two steps of their metric's own hue.
	const [diskReadColor, diskWriteColor] = metricRamp('disk', 2);
	const [netRxColor, netTxColor] = metricRamp('network', 2);

	let live = $derived(conn?.live ?? null);

	let cpu = $derived(live?.cpu ?? null);
	let memory = $derived(live?.memory ?? null);
	let disks = $derived(live?.disks ?? []);
	let network = $derived(live?.network ?? []);

	// Memory: htop-style active = total - available.
	let memTotal = $derived(memory?.total_bytes ?? 0);
	let memActive = $derived(Math.max(0, memTotal - (memory?.available_bytes ?? 0)));
	let memPct = $derived(memTotal > 0 ? (memActive / memTotal) * 100 : 0);

	// Disk I/O — server already strips container overlay mounts from the live feed.
	let diskRead = $derived(disks.reduce((s, d) => s + (d.read_bytes_per_sec ?? 0), 0));
	let diskWrite = $derived(disks.reduce((s, d) => s + (d.write_bytes_per_sec ?? 0), 0));

	let netRx = $derived(network.reduce((s, n) => s + n.rx_bytes_per_sec, 0));
	let netTx = $derived(network.reduce((s, n) => s + n.tx_bytes_per_sec, 0));

	let current = $derived(
		config.source === 'cpu'
			? cpu
				? fmtPercent(cpu.usage_percent, 1)
				: '—'
			: config.source === 'memory'
				? memory
					? fmtPercent(memPct, 1)
					: '—'
				: config.source === 'disk-io'
					? disks.length
						? fmtBps(diskRead + diskWrite, 1)
						: '—'
					: network.length
						? fmtBps(netRx + netTx, 1)
						: '—'
	);
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
	{#if config.source === 'cpu'}
		<MetricCard
			class={cardCls}
			label={m.overview_metric_cpu_label()}
			value={cpu ? cpu.usage_percent : null}
			format={(v) => fmtPercent(v, 1)}
			secondary={cpu ? m.overview_metric_cores_count({ count: cpu.per_core.length }) : ''}
			series={live?.cpuHistory ?? { xs: [], ys: [] }}
			color={metricColor('cpu')}
			min={0}
			max={100}
		/>
	{:else if config.source === 'memory'}
		<MetricCard
			class={cardCls}
			label={m.overview_metric_memory_label()}
			value={memory ? memPct : null}
			format={(v) => fmtPercent(v, 1)}
			secondary={memTotal > 0 ? `${fmtBytes(memActive)} / ${fmtBytes(memTotal)}` : ''}
			series={live?.memoryActivePercentHistory ?? { xs: [], ys: [] }}
			color={metricColor('memory')}
			min={0}
			max={100}
		/>
	{:else if config.source === 'disk-io'}
		<MetricCard
			class={cardCls}
			label={m.overview_metric_disk_io_label()}
			value={disks.length > 0 ? diskRead + diskWrite : null}
			format={(v) => fmtBps(v, 1)}
			series={live?.diskReadHistory ?? { xs: [], ys: [] }}
			extra={live?.diskWriteHistory
				? { data: live.diskWriteHistory, color: diskWriteColor }
				: undefined}
			color={diskReadColor}
			min={0}
			secondary={disks.length > 0 ? `R ${fmtBps(diskRead, 0)} · W ${fmtBps(diskWrite, 0)}` : ''}
		/>
	{:else}
		<MetricCard
			class={cardCls}
			label={m.overview_metric_network_label()}
			value={network.length > 0 ? netRx + netTx : null}
			format={(v) => fmtBps(v, 1)}
			series={live?.netRxHistory ?? { xs: [], ys: [] }}
			extra={live?.netTxHistory ? { data: live.netTxHistory, color: netTxColor } : undefined}
			color={netRxColor}
			min={0}
			secondary={network.length > 0 ? `↓ ${fmtBps(netRx, 0)} · ↑ ${fmtBps(netTx, 0)}` : ''}
		/>
	{/if}
	{#if !editing}
		<button
			type="button"
			onclick={() => (expanded = true)}
			aria-label={m.overview_metric_inspect({ metric: title })}
			aria-haspopup="dialog"
			title={m.overview_metric_inspect({ metric: title })}
			class="absolute inset-0 cursor-pointer rounded-[var(--radius-card)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]"
		>
		</button>
	{/if}
</div>
{#if expanded && !editing}
	<LiveMetricModal
		{conn}
		source={config.source}
		{title}
		{current}
		onClose={() => (expanded = false)}
	/>
{/if}
