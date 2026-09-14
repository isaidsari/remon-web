<script lang="ts">
	import Card from '$lib/components/ui/Card.svelte';
	import Skeleton from '$lib/components/ui/Skeleton.svelte';
	import type { Connection } from '$lib/stores/connections.svelte';
	import { cn } from '$lib/utils/cn';
	import { fmtNumber, fmtPercent } from '$lib/utils/format';
	import { m } from '$lib/paraglide/messages';

	interface Props {
		conn: Connection | null;
	}
	let { conn }: Props = $props();
	let cpu = $derived(conn?.live?.cpu ?? null);

	let loads = $derived(
		cpu
			? [
					{ label: m.overview_cpu_load_1m(), value: cpu.load_avg.one },
					{ label: m.overview_cpu_load_5m(), value: cpu.load_avg.five },
					{ label: m.overview_cpu_load_15m(), value: cpu.load_avg.fifteen }
				]
			: []
	);

	// Only the two times with a known bad direction carry thresholds; user and
	// kernel time are a split, not a symptom, so they never change colour.
	let times = $derived(
		cpu
			? [
					{ label: m.overview_cpu_user(), value: cpu.user_percent, warn: null, bad: null },
					{ label: m.overview_cpu_kernel(), value: cpu.system_percent, warn: null, bad: null },
					{ label: m.overview_cpu_iowait(), value: cpu.iowait_percent, warn: 15, bad: 30 },
					{ label: m.overview_cpu_steal(), value: cpu.steal_percent, warn: 2, bad: 5 }
				].filter((t) => t.value != null)
			: []
	);

	/** Same bands the storage card uses, so a hot core and a full disk read alike. */
	function barTone(pct: number): string {
		if (pct > 90) return 'bg-[var(--color-danger)]';
		if (pct > 75) return 'bg-[var(--color-warning)]';
		return 'bg-[var(--color-info)]';
	}

	function timeTone(value: number, warn: number | null, bad: number | null): string {
		if (bad != null && value >= bad) return 'text-[var(--color-danger)]';
		if (warn != null && value >= warn) return 'text-[var(--color-warning)]';
		return 'text-[var(--color-fg-muted)]';
	}
</script>

<!-- Speaks the same visual language as the memory and storage cards: bars sit
     straight on the card surface, on the same track and in the same bands. An
     earlier version wrapped each core in its own filled tile, which on a many-core
     host read as a grid of small cards inside the card and needed its own scroll
     region to fit — the two things that made it look like a separate element.
     The large headline figure is deliberate and stays. -->
<Card class="flex h-full min-h-0 flex-col" padding="sm">
	<div class="mb-3 flex shrink-0 items-start justify-between gap-3">
		<p class="text-xs tracking-wide text-[var(--color-fg-muted)]">
			{m.overview_per_core_cpu_title()}
		</p>
		<div class="shrink-0 text-right">
			{#if cpu}
				<p class="font-mono text-xl leading-none font-semibold tracking-tight tabular-nums">
					{fmtPercent(cpu.usage_percent, 1)}
				</p>
				<p class="text-2xs mt-1 text-[var(--color-fg-subtle)]">
					{m.overview_cpu_usage()} · {m.overview_metric_cores_count({
						count: cpu.per_core.length
					})}
				</p>
			{:else}
				<Skeleton class="h-7 w-20" />
			{/if}
		</div>
	</div>

	<!-- One line per core, so a sixteen-core host fits the default cell without
	     scrolling. The scroll stays as a quiet safety net for very wide hosts. -->
	<div class="min-h-0 flex-1 overflow-y-auto overscroll-contain">
		{#if cpu}
			{#if cpu.per_core.length > 0}
				<ul
					class="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-x-4 gap-y-1.5"
					aria-label={m.overview_per_core_cpu_title()}
				>
					{#each cpu.per_core as core (core.core_index)}
						{@const pct = Number.isFinite(core.usage_percent)
							? Math.min(100, Math.max(0, core.usage_percent))
							: null}
						<li class="flex items-center gap-2 font-mono text-xs tabular-nums">
							<span class="text-2xs w-5 shrink-0 text-right text-[var(--color-fg-subtle)]">
								{core.core_index}
							</span>
							<span
								class="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--color-surface-3)]"
								aria-hidden="true"
							>
								<span
									class={cn(
										'block h-full rounded-full transition-[width] duration-300 motion-reduce:transition-none',
										pct == null ? 'bg-transparent' : barTone(pct)
									)}
									style:width="{pct ?? 0}%"
								></span>
							</span>
							<span class="w-8 shrink-0 text-right text-[var(--color-fg)]">
								{pct == null ? '—' : fmtPercent(pct, 0)}
							</span>
						</li>
					{/each}
				</ul>
			{:else}
				<p class="py-6 text-center text-xs text-[var(--color-fg-muted)]">
					{m.probes_metric_no_data()}
				</p>
			{/if}
		{:else}
			<div class="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-x-4 gap-y-2">
				{#each Array(8) as _, i (i)}
					<Skeleton class="h-3 w-full" />
				{/each}
			</div>
		{/if}
	</div>

	<!-- Outside the scroll region on purpose: load average is the figure an
	     operator glances for, and it must not scroll away behind many cores. -->
	{#if cpu}
		<div class="mt-3 shrink-0 border-t border-[var(--color-border)] pt-3">
			<dl class="grid grid-cols-3 gap-2 font-mono text-xs tabular-nums">
				{#each loads as item (item.label)}
					<div>
						<dt class="text-2xs text-[var(--color-fg-muted)]">{item.label}</dt>
						<dd class="text-[var(--color-fg)]">{fmtNumber(item.value)}</dd>
					</div>
				{/each}
			</dl>
			{#if times.length > 0}
				<dl class="text-2xs mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono tabular-nums">
					{#each times as t (t.label)}
						<div class="flex items-baseline gap-1.5">
							<dt class="text-[var(--color-fg-subtle)]">{t.label}</dt>
							<dd class={timeTone(t.value!, t.warn, t.bad)}>{fmtPercent(t.value!, 1)}</dd>
						</div>
					{/each}
				</dl>
			{/if}
		</div>
	{/if}
</Card>
