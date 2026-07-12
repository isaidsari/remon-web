<script lang="ts">
	import Card from '$lib/components/ui/Card.svelte';
	import Banner from '$lib/components/ui/Banner.svelte';
	import HistoryChart, { type Series } from '$lib/components/charts/HistoryChart.svelte';
	import { fmtBytes, fmtPercent } from '$lib/utils/format';
	import { ApiError } from '$lib/api/error';
	import type { Connection } from '$lib/stores/connections.svelte';
	import type { DockerPoint } from '$lib/types/api';
	import { m } from '$lib/paraglide/messages';

	interface Props {
		conn: Connection;
		/** Container name — the metrics key. A leading `/` is tolerated. */
		name: string;
		paused?: boolean;
		refreshMs?: number;
	}

	let { conn, name, paused = false, refreshMs = 15000 }: Props = $props();

	// The collector keys rows by the bare container name; inspect/list report
	// it with a leading slash.
	let key = $derived(name.replace(/^\//, ''));

	let points = $state<DockerPoint[]>([]);
	let error = $state<string | null>(null);
	let loaded = $state(false);

	$effect(() => {
		if (paused || !conn.isAuthenticated || !key) return;
		void key; // re-run when the container changes
		let cancelled = false;

		async function load() {
			if (cancelled) return;
			try {
				const res = await conn.client.dockerHistory(key, { limit: 500 });
				if (cancelled) return;
				points = res.points;
				error = null;
			} catch (e) {
				if (cancelled) return;
				error = e instanceof ApiError ? e.userMessage : String(e);
			} finally {
				if (!cancelled) loaded = true;
			}
		}

		void load();
		const timer = setInterval(load, refreshMs);
		return () => {
			cancelled = true;
			clearInterval(timer);
		};
	});

	const CPU_COLOR = 'rgb(96, 165, 250)';
	const MEM_COLOR = 'rgb(167, 139, 250)';

	let cpuSeries = $derived<Series[]>([
		{
			name: m.overview_metric_cpu_label(),
			data: { xs: points.map((p) => p.timestamp), ys: points.map((p) => p.cpu_percent) },
			color: CPU_COLOR,
			fill: true
		}
	]);
	let memSeries = $derived<Series[]>([
		{
			name: m.overview_metric_memory_label(),
			data: { xs: points.map((p) => p.timestamp), ys: points.map((p) => p.memory_used_bytes) },
			color: MEM_COLOR,
			fill: true
		}
	]);

	let hasData = $derived(points.length > 0);
</script>

<Card>
	<h2 class="mb-3 text-sm font-medium text-[var(--color-fg)]">
		{m.docker_container_history_title()}
	</h2>

	{#if error}
		<Banner variant="danger">{error}</Banner>
	{:else if loaded && !hasData}
		<p class="py-2 text-[11px] text-[var(--color-fg-subtle)]">
			{m.docker_container_history_empty()}
		</p>
	{:else}
		<div class="flex flex-col gap-5">
			<div>
				<p class="mb-1 text-xs text-[var(--color-fg-subtle)]">{m.overview_metric_cpu_label()}</p>
				<HistoryChart
					series={cpuSeries}
					height={160}
					yMin={0}
					valueFormatter={(v) => (v == null ? '—' : fmtPercent(v))}
				/>
			</div>
			<div>
				<p class="mb-1 text-xs text-[var(--color-fg-subtle)]">{m.overview_metric_memory_label()}</p>
				<HistoryChart
					series={memSeries}
					height={160}
					yMin={0}
					valueFormatter={(v) => (v == null ? '—' : fmtBytes(v))}
				/>
			</div>
		</div>
	{/if}
</Card>
