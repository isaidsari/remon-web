<script lang="ts">
	import type { Snippet } from 'svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import { cn } from '$lib/utils/cn';

	interface Props {
		title: string;
		subtitle?: string;
		children: Snippet;
		class?: string;
		/** 'none' moves the header into its own bordered strip, for cards whose
		 *  body is a full-bleed table. */
		padding?: 'none' | 'sm' | 'md';
	}

	let { title, subtitle, children, class: klass = '', padding = 'md' }: Props = $props();
</script>

<Card class={cn('flex flex-col', klass)} {padding}>
	<div class={padding === 'none' ? 'border-b border-[var(--color-border)] px-4 py-3' : 'mb-3'}>
		<h3 class="text-sm font-medium text-[var(--color-fg)]">{title}</h3>
		{#if subtitle}
			<p class="mt-0.5 text-xs text-[var(--color-fg-muted)]">{subtitle}</p>
		{/if}
	</div>
	{@render children()}
</Card>
