<script lang="ts">
	import Card from '$lib/components/ui/Card.svelte';
	import Sparkline from '$lib/components/charts/Sparkline.svelte';
	import { fmtPercent, fmtNumber } from '$lib/utils/format';
	import { cn } from '$lib/utils/cn';
	import type { PressureHistoryResponse, PressureResource } from '$lib/types/api';
	import { m } from '$lib/paraglide/messages';

	interface Props {
		cpu: PressureHistoryResponse | null;
		memory: PressureHistoryResponse | null;
		io: PressureHistoryResponse | null;
		class?: string;
	}

	let { cpu, memory, io, class: klass = '' }: Props = $props();

	// PSI explainer values: each resource exposes a `some` (any task stalled)
	// and `full` (every task stalled, except CPU which the kernel doesn't
	// emit). We focus on `some_avg10` — that's the most reactive signal.

	type Slot = {
		key: PressureResource;
		label: string;
		color: string;
		data: PressureHistoryResponse | null;
	};

	let slots = $derived<Slot[]>([
		{ key: 'cpu', label: 'CPU', color: 'rgb(96, 165, 250)', data: cpu },
		{
			key: 'memory',
			label: m.statspanel_label_memory(),
			color: 'rgb(167, 139, 250)',
			data: memory
		},
		{ key: 'io', label: 'I/O', color: 'rgb(251, 191, 36)', data: io }
	]);

	let hasAnyData = $derived(slots.some((s) => (s.data?.points.length ?? 0) > 0));

	function latest(p: PressureHistoryResponse | null) {
		if (!p || p.points.length === 0) return null;
		return p.points[p.points.length - 1];
	}

	function someSeries(p: PressureHistoryResponse | null): { xs: number[]; ys: number[] } {
		if (!p) return { xs: [], ys: [] };
		return {
			xs: p.points.map((x) => x.timestamp),
			ys: p.points.map((x) => x.some_avg10)
		};
	}

	function pressureColor(v: number | null | undefined): string {
		if (v == null) return 'text-[var(--color-fg)]';
		if (v >= 30) return 'text-[var(--color-danger)]';
		if (v >= 10) return 'text-[var(--color-warning)]';
		return 'text-[var(--color-fg)]';
	}
</script>

<Card class={cn('xl:col-span-2', klass)}>
	<div class="mb-3 flex items-baseline justify-between">
		<div>
			<h2 class="text-sm font-medium text-[var(--color-fg)]">{m.pressurecard_title()}</h2>
			<p class="mt-0.5 text-xs text-[var(--color-fg-muted)]">
				{m.pressurecard_description()}
			</p>
		</div>
	</div>

	{#if !hasAnyData}
		<p class="text-sm text-[var(--color-fg-subtle)]">
			{m.pressurecard_unavailable()}
		</p>
	{:else}
		<div class="grid grid-cols-1 gap-4 md:grid-cols-3">
			{#each slots as s (s.key)}
				{@const last = latest(s.data)}
				{@const series = someSeries(s.data)}
				{@const hasPoints = (s.data?.points.length ?? 0) > 0}
				<div
					class="rounded-[var(--radius-input)] border border-[var(--color-border)] bg-[var(--color-bg-soft)] p-4"
				>
					<div class="flex items-baseline justify-between">
						<span class="text-xs tracking-wide text-[var(--color-fg-muted)]">
							{s.label}
						</span>
						<span class="text-[11px] text-[var(--color-fg-subtle)]">
							{hasPoints
								? m.pressurecard_points_count({ count: s.data!.points.length })
								: m.pressurecard_no_data()}
						</span>
					</div>

					{#if hasPoints && last}
						<p
							class={cn('mt-2 text-xl font-semibold tabular-nums', pressureColor(last.some_avg10))}
						>
							{fmtPercent(last.some_avg10, 1)}
						</p>
						<div
							class="mt-1 flex items-center gap-3 text-[11px] text-[var(--color-fg-subtle)] tabular-nums"
						>
							<span>10s {fmtNumber(last.some_avg10, 1)}</span>
							<span>60s {fmtNumber(last.some_avg60, 1)}</span>
							<span>300s {fmtNumber(last.some_avg300, 1)}</span>
						</div>
						<div class="mt-3 -mx-1">
							<Sparkline data={series} color={s.color} height={48} min={0} window={60} />
						</div>
					{:else}
						<p class="mt-3 text-xs text-[var(--color-fg-subtle)]">{m.pressurecard_empty_range()}</p>
					{/if}
				</div>
			{/each}
		</div>
	{/if}
</Card>
