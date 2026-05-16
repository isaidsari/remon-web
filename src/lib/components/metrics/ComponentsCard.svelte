<script lang="ts">
	import Card from '$lib/components/ui/Card.svelte';
	import HistoryChart, { type Series } from '$lib/components/charts/HistoryChart.svelte';
	import { fmtNumber } from '$lib/utils/format';
	import { cn } from '$lib/utils/cn';
	import type { ComponentsHistoryResponse, ComponentPoint } from '$lib/types/api';
	import { m } from '$lib/paraglide/messages';

	interface Props {
		data: ComponentsHistoryResponse | null;
		class?: string;
	}

	let { data, class: klass = '' }: Props = $props();

	const PALETTE = [
		'rgb(96, 165, 250)',
		'rgb(167, 139, 250)',
		'rgb(52, 211, 153)',
		'rgb(251, 191, 36)',
		'rgb(244, 114, 182)',
		'rgb(56, 189, 248)',
		'rgb(248, 113, 113)',
		'rgb(217, 70, 239)'
	];

	type SensorState = {
		label: string;
		series: Series;
		latest: ComponentPoint | null;
	};

	let sensors = $derived.by((): SensorState[] => {
		if (!data) return [];
		const grouped = new Map<string, ComponentPoint[]>();
		for (const p of data.points) {
			let arr = grouped.get(p.label);
			if (!arr) {
				arr = [];
				grouped.set(p.label, arr);
			}
			arr.push(p);
		}
		const out: SensorState[] = [];
		let i = 0;
		for (const [label, pts] of grouped) {
			pts.sort((a, b) => a.timestamp - b.timestamp);
			out.push({
				label,
				series: {
					name: label,
					color: PALETTE[i % PALETTE.length],
					data: {
						xs: pts.map((p) => p.timestamp),
						ys: pts.map((p) => p.temperature_c ?? NaN)
					}
				},
				latest: pts[pts.length - 1] ?? null
			});
			i++;
		}
		return out.sort((a, b) => a.label.localeCompare(b.label));
	});

	let allSeries = $derived(sensors.map((s) => s.series));
	let chartKey = $derived(sensors.map((s) => s.label).join('|'));

	function tempColor(t: number | null | undefined, critical: number | null | undefined): string {
		if (t == null) return 'text-[var(--color-fg)]';
		if (critical != null && t >= critical * 0.95) return 'text-[var(--color-danger)]';
		if (critical != null && t >= critical * 0.85) return 'text-[var(--color-warning)]';
		if (t >= 80) return 'text-[var(--color-warning)]';
		return 'text-[var(--color-fg)]';
	}

	function fmtTemp(v: number | null): string {
		if (v == null || Number.isNaN(v)) return '—';
		return `${fmtNumber(v, 1)} °C`;
	}
</script>

<Card class={cn('xl:col-span-2', klass)}>
	<div class="mb-3 flex items-baseline justify-between">
		<div>
			<h2 class="text-sm font-medium text-[var(--color-fg)]">{m.sensors_card_title()}</h2>
			<p class="mt-0.5 text-xs text-[var(--color-fg-muted)]">
				{m.sensors_card_subtitle()}
			</p>
		</div>
		{#if sensors.length > 0}
			<span class="text-xs text-[var(--color-fg-subtle)]">
				{m.sensors_count({ count: sensors.length })}
			</span>
		{/if}
	</div>

	{#if sensors.length === 0}
		<p class="text-sm text-[var(--color-fg-subtle)]">
			{m.sensors_empty()}
		</p>
	{:else}
		{#key chartKey}
			<HistoryChart series={allSeries} valueFormatter={fmtTemp} group="metrics" />
		{/key}

		<div
			class="mt-4 grid grid-cols-1 gap-2 border-t border-[var(--color-border)] pt-4 sm:grid-cols-2 lg:grid-cols-3"
		>
			{#each sensors as s (s.label)}
				<div
					class="flex items-center justify-between rounded-md bg-[var(--color-bg-soft)] px-3 py-2 text-sm"
				>
					<div class="min-w-0 flex-1">
						<p class="truncate font-mono text-xs text-[var(--color-fg-muted)]" title={s.label}>
							{s.label}
						</p>
						{#if s.latest && (s.latest.max_c != null || s.latest.critical_c != null)}
							<p class="mt-0.5 text-[11px] text-[var(--color-fg-subtle)] tabular-nums">
								{#if s.latest.max_c != null}{m.sensors_label_max()} {fmtTemp(s.latest.max_c)}{/if}
								{#if s.latest.max_c != null && s.latest.critical_c != null} · {/if}
								{#if s.latest.critical_c != null}
									{m.sensors_label_crit()}
									<span class="text-[var(--color-danger)]/80">{fmtTemp(s.latest.critical_c)}</span>
								{/if}
							</p>
						{/if}
					</div>
					<p
						class={cn(
							'shrink-0 font-semibold tabular-nums',
							tempColor(s.latest?.temperature_c ?? null, s.latest?.critical_c ?? null)
						)}
					>
						{fmtTemp(s.latest?.temperature_c ?? null)}
					</p>
				</div>
			{/each}
		</div>
	{/if}
</Card>
