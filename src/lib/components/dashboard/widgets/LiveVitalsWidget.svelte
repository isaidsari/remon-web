<script lang="ts">
	import Sparkline from '$lib/components/charts/Sparkline.svelte';
	import Skeleton from '$lib/components/ui/Skeleton.svelte';
	import TweenedNumber from '$lib/components/ui/TweenedNumber.svelte';
	import LiveMetricModal from './LiveMetricModal.svelte';
	import type { Connection } from '$lib/stores/connections.svelte';
	import type { LiveKpiSource } from '$lib/types/dashboard';
	import { LIVE_KPI_SOURCES, kpiView } from '$lib/dashboard/live-kpi';
	import { m } from '$lib/paraglide/messages';

	interface Props {
		conn: Connection | null;
		editing?: boolean;
	}

	let { conn, editing = false }: Props = $props();
	let inspecting = $state<LiveKpiSource | null>(null);
	let views = $derived(LIVE_KPI_SOURCES.map((source) => kpiView(conn?.live ?? null, source)));
	let inspected = $derived(inspecting ? kpiView(conn?.live ?? null, inspecting) : null);
</script>

<!-- The four live vitals as one card: 2×2 when narrow, a single row when wide. -->
<div
	class="@container h-full overflow-hidden rounded-[var(--radius-card)] shadow-[var(--shadow-flat)]"
>
	<div class="hairline-grid h-full grid-cols-2 @2xl:grid-cols-4">
		{#each views as view, i (LIVE_KPI_SOURCES[i])}
			<div
				class="group relative flex min-w-0 flex-col bg-[var(--color-surface)] pt-3.5 transition-colors duration-[var(--dur-fast)] {editing
					? ''
					: 'focus-within:bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-2)]'}"
			>
				<span
					class="text-2xs px-4 font-mono font-medium tracking-[0.08em] text-[var(--color-fg-muted)]"
				>
					{view.label}
				</span>
				<div class="mt-1.5 px-4">
					{#if view.value === null}
						<Skeleton class="h-[24px] w-20" />
					{:else}
						<TweenedNumber
							value={view.value}
							format={view.format}
							class="text-figure font-mono leading-[1.1] font-semibold tracking-[-0.02em] text-[var(--color-fg)] tabular-nums"
						/>
					{/if}
				</div>
				<p class="text-2xs mt-1 truncate px-4 font-mono text-[var(--color-fg-subtle)]">
					{view.secondary || ' '}
				</p>
				<div class="mt-auto pt-2">
					{#if view.value === null}
						<Skeleton class="h-[40px] w-full" />
					{:else}
						<Sparkline
							data={view.series}
							extra={view.extra}
							color={view.color}
							min={view.min}
							max={view.max}
							height={40}
							window={30}
							tight
						/>
					{/if}
				</div>
				{#if !editing}
					<button
						type="button"
						onclick={() => (inspecting = LIVE_KPI_SOURCES[i])}
						aria-label={m.overview_metric_inspect({ metric: view.label })}
						aria-haspopup="dialog"
						title={m.overview_metric_inspect({ metric: view.label })}
						class="absolute inset-0 cursor-pointer focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--color-ring)]"
					></button>
				{/if}
			</div>
		{/each}
	</div>
</div>
{#if inspecting && inspected && !editing}
	<LiveMetricModal
		{conn}
		source={inspecting}
		view={inspected}
		onClose={() => (inspecting = null)}
	/>
{/if}
