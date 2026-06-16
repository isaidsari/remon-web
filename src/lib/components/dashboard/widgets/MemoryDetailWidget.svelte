<script lang="ts">
	import Card from '$lib/components/ui/Card.svelte';
	import Skeleton from '$lib/components/ui/Skeleton.svelte';
	import type { Connection } from '$lib/stores/connections.svelte';
	import { fmtBytes, fmtPercent } from '$lib/utils/format';
	import { m } from '$lib/paraglide/messages';

	interface Props {
		conn: Connection | null;
		// Config-less widget; accepted for a uniform widget signature.
		config?: unknown;
	}

	let { conn }: Props = $props();

	let memory = $derived(conn?.live?.memory ?? null);

	// htop "used": total - MemAvailable (sysinfo used_bytes counts buffers/cache
	// against you). available already includes reclaimable cache, so truly-free
	// is available - cached.
	let memTotal = $derived(memory?.total_bytes ?? 0);
	let memActive = $derived(Math.max(0, memTotal - (memory?.available_bytes ?? 0)));
	let memCached = $derived(memory?.cached_bytes ?? 0);
	let memFreeRest = $derived(Math.max(0, (memory?.available_bytes ?? 0) - memCached));

	let activePct = $derived(memTotal > 0 ? (memActive / memTotal) * 100 : 0);
	let cachePct = $derived(memTotal > 0 ? (memCached / memTotal) * 100 : 0);
	let freePct = $derived(Math.max(0, 100 - activePct - cachePct));

	let swapTotal = $derived(memory?.swap_total_bytes ?? 0);
	let swapUsed = $derived(memory?.swap_used_bytes ?? 0);
	let swapPct = $derived(swapTotal > 0 ? (swapUsed / swapTotal) * 100 : 0);
</script>

<Card class="flex h-full flex-col">
	<p class="mb-3 text-xs tracking-wide text-[var(--color-fg-muted)]">
		{m.overview_card_memory_title()}
	</p>

	{#if memory && memTotal > 0}
		<div class="flex h-2.5 w-full overflow-hidden rounded-full bg-[var(--color-surface-3)]">
			<div
				class="h-full bg-[var(--color-info)]"
				style="width: {activePct}%"
				title={m.overview_mem_active_tooltip({ value: fmtBytes(memActive) })}
			></div>
			<div
				class="h-full bg-[color-mix(in_oklab,var(--color-info)_40%,var(--color-surface-3))]"
				style="width: {cachePct}%"
				title={m.overview_mem_cache_tooltip({ value: fmtBytes(memCached) })}
			></div>
			<div
				class="h-full bg-[var(--color-surface-3)]"
				style="width: {freePct}%"
				title={m.overview_mem_free_tooltip({ value: fmtBytes(memFreeRest) })}
			></div>
		</div>

		<dl class="mt-3 grid grid-cols-2 gap-2 font-mono text-[12px] tabular-nums sm:grid-cols-4">
			<div>
				<dt class="text-[11px] text-[var(--color-fg-muted)]">{m.overview_mem_active()}</dt>
				<dd class="text-[var(--color-fg)]">{fmtBytes(memActive)}</dd>
			</div>
			<div>
				<dt class="text-[11px] text-[var(--color-fg-muted)]">{m.overview_mem_cache()}</dt>
				<dd class="text-[var(--color-fg-muted)]">{fmtBytes(memCached)}</dd>
			</div>
			<div>
				<dt class="text-[11px] text-[var(--color-fg-muted)]">{m.overview_mem_free()}</dt>
				<dd class="text-[var(--color-fg-muted)]">{fmtBytes(memFreeRest)}</dd>
			</div>
			<div>
				<dt class="text-[11px] text-[var(--color-fg-subtle)]">{m.overview_mem_total()}</dt>
				<dd class="text-[var(--color-fg-muted)]">{fmtBytes(memTotal)}</dd>
			</div>
		</dl>

		{#if swapTotal > 0}
			<div class="mt-auto border-t border-[var(--color-border)] pt-4">
				<div class="mb-1.5 flex items-baseline justify-between text-xs">
					<span class="text-[var(--color-fg-subtle)]">{m.overview_mem_swap()}</span>
					<span class="font-mono tabular-nums text-[var(--color-fg-muted)]">
						{fmtBytes(swapUsed)} / {fmtBytes(swapTotal)}
						<span class="ml-2">{fmtPercent(swapPct, 0)}</span>
					</span>
				</div>
				<div class="h-1.5 overflow-hidden rounded-full bg-[var(--color-surface-3)]">
					<div
						class="h-full rounded-full bg-[var(--color-warning)]"
						style="width: {Math.min(100, swapPct)}%"
					></div>
				</div>
			</div>
		{/if}
	{:else}
		<Skeleton class="h-2.5 w-full" rounded="full" />
		<div class="mt-3 grid grid-cols-3 gap-2">
			<Skeleton class="h-7 w-full" />
			<Skeleton class="h-7 w-full" />
			<Skeleton class="h-7 w-full" />
		</div>
	{/if}
</Card>
