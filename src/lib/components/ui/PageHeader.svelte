<script lang="ts">
	import type { Snippet } from 'svelte';
	import { cn } from '$lib/utils/cn';

	interface Props {
		title: string;
		subtitle?: string;
		/** Shown as a badge beside the title. */
		count?: number;
		/** Rich subtitle; ignored when `subtitle` is set. */
		meta?: Snippet;
		/** Actions, right-aligned from `sm` up. */
		children?: Snippet;
		class?: string;
	}

	let { title, subtitle, count, meta, children, class: klass = '' }: Props = $props();
</script>

<header class={cn('mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between', klass)}>
	<div class="min-w-0">
		<h1 class="flex items-baseline gap-2.5 text-2xl font-semibold tracking-tight">
			{title}
			{#if count !== undefined}
				<span
					class="rounded-md bg-[var(--color-surface-2)] px-2 py-0.5 font-mono text-xs font-medium text-[var(--color-fg-subtle)] tabular-nums shadow-[inset_0_0_0_1px_var(--color-border)]"
				>
					{count}
				</span>
			{/if}
		</h1>
		{#if subtitle}
			<p class="mt-1.5 max-w-xl text-sm leading-relaxed text-[var(--color-fg-muted)]">
				{subtitle}
			</p>
		{:else if meta}
			<div class="mt-1.5 text-sm text-[var(--color-fg-muted)]">{@render meta()}</div>
		{/if}
	</div>
	{#if children}
		<div class="flex flex-wrap items-center gap-2 sm:shrink-0">{@render children()}</div>
	{/if}
</header>
