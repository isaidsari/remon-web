<script lang="ts">
	import type { Snippet } from 'svelte';
	import Sparkline from '$lib/components/charts/Sparkline.svelte';
	import Skeleton from '$lib/components/ui/Skeleton.svelte';
	import TweenedNumber from '$lib/components/ui/TweenedNumber.svelte';
	import type { TimeSeries } from '$lib/stores/livestats.svelte';
	import { cn } from '$lib/utils/cn';

	interface Props {
		label: string;
		value: number | null;
		format: (v: number) => string;
		/** String or snippet — snippet for inline color coding (e.g. rx/tx legend). */
		secondary?: string | Snippet;
		series: TimeSeries;
		extra?: { data: TimeSeries; color: string };
		color: string;
		min?: number;
		max?: number;
		duration?: number;
		class?: string;
	}

	let {
		label,
		value,
		format,
		secondary,
		series,
		extra,
		color,
		min,
		max,
		duration,
		class: klass = ''
	}: Props = $props();
</script>

<div
	class={cn(
		'flex flex-col gap-3 overflow-hidden bg-[var(--color-surface)] px-5 pt-4 transition-colors duration-[var(--dur-fast)] hover:bg-[var(--color-surface-2)]',
		klass
	)}
>
	<div class="flex items-baseline justify-between gap-2">
		<span class="font-mono text-[11px] font-medium tracking-[0.08em] text-[var(--color-fg-muted)]">
			{label}
		</span>
		{#if secondary}
			{#if typeof secondary === 'string'}
				<span class="font-mono text-[11px] text-[var(--color-fg-subtle)]">{secondary}</span>
			{:else}
				{@render secondary()}
			{/if}
		{:else if value === null}
			<Skeleton class="h-3 w-16" />
		{/if}
	</div>
	{#if value === null}
		<Skeleton class="h-[26px] w-24" />
	{:else}
		<TweenedNumber
			{value}
			{format}
			{duration}
			class="font-mono text-[22px] font-semibold leading-[1.1] tracking-[-0.02em] tabular-nums"
			style="color: {color}"
		/>
	{/if}
	<div class="-mx-5 mt-auto">
		{#if value === null}
			<Skeleton class="h-[64px] w-full" />
		{:else}
			<Sparkline data={series} {extra} {color} {min} {max} height={64} window={30} tight />
		{/if}
	</div>
</div>
