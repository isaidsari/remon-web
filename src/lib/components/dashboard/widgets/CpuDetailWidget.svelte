<script lang="ts">
	import Card from '$lib/components/ui/Card.svelte';
	import Skeleton from '$lib/components/ui/Skeleton.svelte';
	import type { Connection } from '$lib/stores/connections.svelte';
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
	let times = $derived(
		cpu
			? [
					{
						label: m.overview_cpu_user(),
						value: cpu.user_percent,
						warning: Infinity,
						danger: Infinity
					},
					{
						label: m.overview_cpu_kernel(),
						value: cpu.system_percent,
						warning: Infinity,
						danger: Infinity
					},
					{ label: m.overview_cpu_iowait(), value: cpu.iowait_percent, warning: 15, danger: 30 },
					{ label: m.overview_cpu_steal(), value: cpu.steal_percent, warning: 2, danger: 5 }
				].filter((item) => item.value != null)
			: []
	);
</script>

<Card class="flex h-full min-h-0 flex-col overflow-hidden" padding="sm">
	<div class="mb-4 flex shrink-0 items-start justify-between gap-3">
		<div class="min-w-0">
			<p class="text-xs text-[var(--color-fg-muted)]">{m.overview_per_core_cpu_title()}</p>
			{#if cpu}
				<p class="text-2xs mt-1 text-[var(--color-fg-subtle)]">
					{m.overview_metric_cores_count({ count: cpu.per_core.length })}
				</p>
			{/if}
		</div>
		<div class="shrink-0 text-right">
			{#if cpu}
				<p class="font-mono text-xl leading-none font-semibold tracking-tight tabular-nums">
					{fmtPercent(cpu.usage_percent, 1)}
				</p>
				<p class="text-2xs mt-1 text-[var(--color-fg-subtle)]">{m.overview_cpu_usage()}</p>
			{:else}
				<Skeleton class="h-7 w-20" />
			{/if}
		</div>
	</div>

	<div class="cpu-body min-h-0 flex-1 overflow-y-auto overscroll-contain">
		{#if cpu}
			{#if cpu.per_core.length > 0}
				<ul class="per-core-grid" aria-label={m.overview_per_core_cpu_title()}>
					{#each cpu.per_core as core (core.core_index)}
						{@const pct = Number.isFinite(core.usage_percent)
							? Math.min(100, Math.max(0, core.usage_percent))
							: null}
						<li class="rounded-lg bg-[var(--color-surface-2)] px-3 py-2.5">
							<div
								class="text-2xs mb-2 flex items-baseline justify-between gap-2 font-mono tabular-nums"
							>
								<span class="text-[var(--color-fg-muted)]">CPU {core.core_index}</span>
								<span class="font-medium">{pct == null ? '—' : fmtPercent(pct, 0)}</span>
							</div>
							<div class="core-track" aria-hidden="true">
								<div class="core-fill" style:width="{pct ?? 0}%"></div>
							</div>
						</li>
					{/each}
				</ul>
			{:else}
				<p class="py-6 text-center text-xs text-[var(--color-fg-muted)]">
					{m.probes_metric_no_data()}
				</p>
			{/if}

			<div class="mt-4 border-t border-[var(--color-border)] pt-3">
				<dl class="grid grid-cols-3 gap-3">
					{#each loads as item (item.label)}
						<div>
							<dt class="text-2xs text-[var(--color-fg-subtle)]">{item.label}</dt>
							<dd class="mt-1 font-mono text-xs font-medium tabular-nums">
								{fmtNumber(item.value)}
							</dd>
						</div>
					{/each}
				</dl>
				{#if times.length > 0}
					<dl class="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
						{#each times as item (item.label)}
							<div class="text-2xs flex items-baseline gap-1.5">
								<dt class="text-[var(--color-fg-subtle)]">{item.label}</dt>
								<dd
									class="font-mono tabular-nums"
									style:color="var(--color-{item.value! >= item.danger
										? 'danger'
										: item.value! >= item.warning
											? 'warning'
											: 'fg-muted'})"
								>
									{fmtPercent(item.value!, 1)}
								</dd>
							</div>
						{/each}
					</dl>
				{/if}
			</div>
		{:else}
			<div class="per-core-grid">
				{#each Array(8) as _, i (i)}
					<Skeleton class="h-14 w-full" />
				{/each}
			</div>
		{/if}
	</div>
</Card>

<style>
	.cpu-body {
		max-height: 32rem;
	}
	.per-core-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 7rem), 1fr));
		align-content: start;
		gap: 0.5rem;
	}
	.core-track {
		height: 4px;
		overflow: hidden;
		border-radius: 999px;
		background: var(--color-border);
	}
	.core-fill {
		height: 100%;
		border-radius: inherit;
		background: var(--color-info);
		transition: width 300ms ease;
	}
	@media (prefers-reduced-motion: reduce) {
		.core-fill {
			transition: none;
		}
	}
</style>
