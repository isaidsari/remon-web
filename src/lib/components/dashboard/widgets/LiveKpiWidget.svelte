<script lang="ts">
	import MetricCard from '$lib/components/overview/MetricCard.svelte';
	import type { Connection } from '$lib/stores/connections.svelte';
	import type { LiveKpiConfig } from '$lib/types/dashboard';
	import { fmtBps, fmtBytes, fmtPercent } from '$lib/utils/format';
	import { m } from '$lib/paraglide/messages';

	interface Props {
		conn: Connection | null;
		config: LiveKpiConfig;
	}

	let { conn, config }: Props = $props();

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

	// MetricCard ships no border/rounding of its own (it lived inside a shared
	// hairline grid on the old overview). On the dashboard each KPI stands alone,
	// so give it the same rounded surface + inset border as Card for consistency.
	const cardCls =
		'h-full rounded-[var(--radius-card)] shadow-[inset_0_1px_0_rgba(255,255,255,0.03),0_0_0_1px_var(--color-border)]';
</script>

{#if config.source === 'cpu'}
	<MetricCard
		class={cardCls}
		label={m.overview_metric_cpu_label()}
		value={cpu ? cpu.usage_percent : null}
		format={(v) => fmtPercent(v, 1)}
		secondary={cpu ? m.overview_metric_cores_count({ count: cpu.per_core.length }) : ''}
		series={live?.cpuHistory ?? { xs: [], ys: [] }}
		color="#4fb6c2"
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
		color="#d97706"
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
		extra={live?.diskWriteHistory ? { data: live.diskWriteHistory, color: '#c4b5fd' } : undefined}
		color="#8b7cc6"
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
		extra={live?.netTxHistory ? { data: live.netTxHistory, color: '#fbbf24' } : undefined}
		color="#3b82f6"
		min={0}
		secondary={network.length > 0 ? `↓ ${fmtBps(netRx, 0)} · ↑ ${fmtBps(netTx, 0)}` : ''}
	/>
{/if}
