<script lang="ts">
	import StatStrip from '$lib/components/charts/StatStrip.svelte';
	import type { Series } from '$lib/components/charts/HistoryChart.svelte';

	import { cn } from '$lib/utils/cn';

	interface Props {
		series: Series[];
		format: (v: number | null) => string;
		class?: string;
	}

	let { series, format, class: klass = '' }: Props = $props();
</script>

<!-- Identity rides a swatch, not the label's colour: a light series hue (yellow,
     aqua) is legible as a dot on the surface and barely legible as text. -->
<div class={cn('grid grid-cols-1 gap-y-2 sm:grid-cols-2', klass)}>
	{#each series as s (s.name)}
		<div class="min-w-0">
			<p
				class="text-3xs mb-0.5 flex items-center gap-1.5 tracking-[0.08em] text-[var(--color-fg-muted)]"
			>
				<span class="size-1.5 shrink-0 rounded-full" style="background: {s.color}"></span>
				<span class="truncate" title={s.name}>{s.name}</span>
			</p>
			<StatStrip data={s.data} {format} />
		</div>
	{/each}
</div>
