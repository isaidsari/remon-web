<script lang="ts">
	import Card from '$lib/components/ui/Card.svelte';
	import type { Connection } from '$lib/stores/connections.svelte';
	import type { PressureStats } from '$lib/types/api';
	import { fmtPercent, fmtNumber } from '$lib/utils/format';
	import { m } from '$lib/paraglide/messages';

	interface Props {
		conn: Connection | null;
		// Config-less widget; accepted for a uniform widget signature.
		config?: unknown;
	}

	let { conn }: Props = $props();

	let pressure = $derived(conn?.live?.pressure ?? null);

	// PSI: `some` = any task stalled on the resource; we headline some_avg10
	// (the most reactive window). CPU never emits `full`, so we skip it.
	type Slot = { key: string; label: string; data: PressureStats | null };
	let slots = $derived<Slot[]>([
		{ key: 'cpu', label: 'CPU', data: pressure?.cpu ?? null },
		{ key: 'memory', label: m.statspanel_label_memory(), data: pressure?.memory ?? null },
		{ key: 'io', label: 'I/O', data: pressure?.io ?? null }
	]);

	// Linux ≥ 4.20 only; null snapshot means the kernel doesn't expose PSI.
	let available = $derived(slots.some((s) => s.data != null));

	function pressureColor(v: number | null | undefined): string {
		if (v == null) return 'text-[var(--color-fg)]';
		if (v >= 30) return 'text-[var(--color-danger)]';
		if (v >= 10) return 'text-[var(--color-warning)]';
		return 'text-[var(--color-fg)]';
	}
</script>

<Card class="flex h-full flex-col">
	<div class="mb-3">
		<h2 class="text-sm font-medium text-[var(--color-fg)]">{m.pressurecard_title()}</h2>
		<p class="mt-0.5 text-xs text-[var(--color-fg-muted)]">{m.pressurecard_description()}</p>
	</div>

	{#if !available}
		<p class="text-sm text-[var(--color-fg-subtle)]">{m.pressurecard_unavailable()}</p>
	{:else}
		<div class="grid min-h-0 flex-1 grid-cols-1 gap-3 sm:grid-cols-3">
			{#each slots as s (s.key)}
				<div
					class="rounded-[var(--radius-input)] border border-[var(--color-border)] bg-[var(--color-bg-soft)] p-3"
				>
					<span class="text-xs tracking-wide text-[var(--color-fg-muted)]">{s.label}</span>
					{#if s.data}
						<p class="mt-2 text-xl font-semibold tabular-nums {pressureColor(s.data.some_avg10)}">
							{fmtPercent(s.data.some_avg10, 1)}
						</p>
						<div
							class="mt-1 flex items-center gap-3 text-[11px] tabular-nums text-[var(--color-fg-subtle)]"
						>
							<span>10s {fmtNumber(s.data.some_avg10, 1)}</span>
							<span>60s {fmtNumber(s.data.some_avg60, 1)}</span>
							<span>300s {fmtNumber(s.data.some_avg300, 1)}</span>
						</div>
					{:else}
						<p class="mt-2 text-xs text-[var(--color-fg-subtle)]">{m.pressurecard_no_data()}</p>
					{/if}
				</div>
			{/each}
		</div>
	{/if}
</Card>
