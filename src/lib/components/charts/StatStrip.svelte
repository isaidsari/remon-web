<script lang="ts">
	import { cn } from '$lib/utils/cn';
	import type { TimeSeries } from '$lib/stores/livestats.svelte';

	interface Props {
		data: TimeSeries;
		format?: (v: number | null) => string;
		accent?: string;
		class?: string;
	}

	let {
		data,
		format = (v) => (v == null ? '—' : v.toFixed(1)),
		accent,
		class: klass = ''
	}: Props = $props();

	function quickStats(ys: number[]) {
		if (ys.length === 0) return null;
		let sum = 0;
		let min = Infinity;
		let max = -Infinity;
		for (const v of ys) {
			if (!Number.isFinite(v)) continue;
			sum += v;
			if (v < min) min = v;
			if (v > max) max = v;
		}
		const finite = ys.filter((v) => Number.isFinite(v));
		if (finite.length === 0) return null;
		const avg = sum / finite.length;
		const sorted = [...finite].sort((a, b) => a - b);
		const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));
		const p95 = sorted[idx];
		const current = ys[ys.length - 1];
		return { current: Number.isFinite(current) ? current : null, avg, min, max, p95 };
	}

	let stats = $derived(quickStats(data.ys));
</script>

<dl
	class={cn(
		'flex flex-wrap items-baseline gap-x-5 gap-y-1 font-mono text-[11px] tabular-nums',
		klass
	)}
>
	{@render cell('current', stats?.current ?? null)}
	{@render cell('avg', stats?.avg ?? null)}
	{@render cell('min', stats?.min ?? null)}
	{@render cell('max', stats?.max ?? null)}
	{@render cell('p95', stats?.p95 ?? null)}
</dl>

{#snippet cell(label: string, v: number | null)}
	<div class="flex items-baseline gap-1.5">
		<dt class="text-[11px] tracking-[0.06em] text-[var(--color-fg-muted)]">{label}</dt>
		<dd class="font-medium text-[var(--color-fg)]" style={accent ? `color: ${accent}` : ''}>
			{format(v)}
		</dd>
	</div>
{/snippet}
