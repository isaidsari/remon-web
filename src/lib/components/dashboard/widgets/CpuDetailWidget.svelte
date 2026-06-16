<script lang="ts">
	import Card from '$lib/components/ui/Card.svelte';
	import Skeleton from '$lib/components/ui/Skeleton.svelte';
	import type { Connection } from '$lib/stores/connections.svelte';
	import { fmtNumber, fmtPercent } from '$lib/utils/format';
	import { m } from '$lib/paraglide/messages';

	interface Props {
		conn: Connection | null;
		// Config-less widget; accepted for a uniform widget signature.
		config?: unknown;
	}

	let { conn }: Props = $props();

	let cpu = $derived(conn?.live?.cpu ?? null);

	// steal/iowait/user/system ride on the live CpuStats snapshot, so no history
	// fetch is needed — everything here comes straight off the SSE feed.
	function stealColor(p: number | null | undefined): string {
		if (p == null) return 'text-[var(--color-fg)]';
		if (p >= 5) return 'text-[var(--color-danger)]';
		if (p >= 2) return 'text-[var(--color-warning)]';
		return 'text-[var(--color-fg)]';
	}
	function iowaitColor(p: number | null | undefined): string {
		if (p == null) return 'text-[var(--color-fg)]';
		if (p >= 30) return 'text-[var(--color-danger)]';
		if (p >= 15) return 'text-[var(--color-warning)]';
		return 'text-[var(--color-fg)]';
	}
</script>

<Card class="flex h-full flex-col">
	<div class="mb-4 flex items-center justify-between">
		<p class="text-xs tracking-wide text-[var(--color-fg-muted)]">{m.overview_card_cpu_title()}</p>
		{#if cpu}
			<span class="font-mono text-[11px] text-[var(--color-fg-muted)]">
				{m.overview_metric_cores_count({ count: cpu.per_core.length })}
			</span>
		{/if}
	</div>

	<div class="mb-4 flex flex-wrap items-baseline gap-x-6 gap-y-2">
		{#if cpu}
			<div class="flex items-baseline gap-1.5">
				<span class="text-[11px] text-[var(--color-fg-subtle)]">{m.overview_cpu_load_1m()}</span>
				<span class="font-mono text-[13px] font-semibold tabular-nums">
					{fmtNumber(cpu.load_avg.one)}
				</span>
			</div>
			<div class="flex items-baseline gap-1.5">
				<span class="text-[11px] text-[var(--color-fg-subtle)]">{m.overview_cpu_load_5m()}</span>
				<span class="font-mono text-[13px] font-semibold tabular-nums">
					{fmtNumber(cpu.load_avg.five)}
				</span>
			</div>
			<div class="flex items-baseline gap-1.5">
				<span class="text-[11px] text-[var(--color-fg-subtle)]">{m.overview_cpu_load_15m()}</span>
				<span class="font-mono text-[13px] font-semibold tabular-nums">
					{fmtNumber(cpu.load_avg.fifteen)}
				</span>
			</div>
			{#if cpu.steal_percent != null}
				<div class="flex items-baseline gap-1.5">
					<span class="text-[11px] text-[var(--color-fg-subtle)]">{m.overview_cpu_steal()}</span>
					<span
						class="font-mono text-[13px] font-semibold tabular-nums {stealColor(cpu.steal_percent)}"
					>
						{fmtPercent(cpu.steal_percent, 1)}
					</span>
				</div>
			{/if}
			{#if cpu.iowait_percent != null}
				<div class="flex items-baseline gap-1.5">
					<span class="text-[11px] text-[var(--color-fg-subtle)]">{m.overview_cpu_iowait()}</span>
					<span
						class="font-mono text-[13px] font-semibold tabular-nums {iowaitColor(
							cpu.iowait_percent
						)}"
					>
						{fmtPercent(cpu.iowait_percent, 1)}
					</span>
				</div>
			{/if}
			{#if cpu.user_percent != null}
				<div class="flex items-baseline gap-1.5">
					<span class="text-[11px] text-[var(--color-fg-subtle)]">{m.overview_cpu_user()}</span>
					<span class="font-mono text-[13px] font-semibold tabular-nums">
						{fmtPercent(cpu.user_percent, 1)}
					</span>
				</div>
			{/if}
			{#if cpu.system_percent != null}
				<div class="flex items-baseline gap-1.5">
					<span class="text-[11px] text-[var(--color-fg-subtle)]">{m.overview_cpu_kernel()}</span>
					<span class="font-mono text-[13px] font-semibold tabular-nums">
						{fmtPercent(cpu.system_percent, 1)}
					</span>
				</div>
			{/if}
		{:else}
			{#each Array(3) as _, i (i)}
				<Skeleton class="h-5 w-16" />
			{/each}
		{/if}
	</div>

	{#if cpu && cpu.per_core.length > 0}
		<div class="per-core-grid min-h-0 flex-1">
			{#each cpu.per_core as core (core.core_index)}
				{@const pct = Math.min(100, Math.max(0, core.usage_percent))}
				{@const hotAlpha = (0.06 + (pct / 100) * 0.56).toFixed(2)}
				<div
					class="flex flex-col items-center justify-center gap-0.5 rounded-md py-2 transition-[background] duration-500"
					style="background: color-mix(in hsl, hsl(4 80% 60% / {hotAlpha}) {Math.round(
						pct
					)}%, hsl(188 42% 54% / 0.1))"
				>
					<span class="font-mono text-[9px] text-[var(--color-fg-subtle)]">{core.core_index}</span>
					<span class="text-[11px] font-semibold tabular-nums">{Math.round(pct)}%</span>
				</div>
			{/each}
		</div>
	{:else}
		<div class="per-core-grid">
			{#each Array(8) as _, i (i)}
				<Skeleton class="h-[58px] w-full" />
			{/each}
		</div>
	{/if}
</Card>

<style>
	.per-core-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(48px, 1fr));
		gap: 0.375rem;
	}
</style>
