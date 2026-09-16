<script lang="ts">
	import type { Component, Snippet } from 'svelte';
	import Card from './Card.svelte';
	import { cn } from '$lib/utils/cn';

	type Tone = 'neutral' | 'success' | 'accent';

	interface Props {
		title?: string;
		description?: string;
		icon?: Component;
		tone?: Tone;
		class?: string;
		/** Call to action, centred under the text. */
		children?: Snippet;
	}

	let {
		title,
		description,
		icon: Icon,
		tone = 'neutral',
		class: klass = '',
		children
	}: Props = $props();

	const bg: Record<Tone, string> = {
		neutral: 'bg-[var(--color-surface-2)]',
		success: 'bg-[var(--color-success-bg)]',
		accent: 'bg-[var(--color-accent-bg)]'
	};
	const fg: Record<Tone, string> = {
		neutral: 'text-[var(--color-fg-muted)]',
		success: 'text-[var(--color-success)]',
		accent: 'text-[var(--color-accent)]'
	};
</script>

<Card padding="lg" class={cn('text-center', klass)}>
	{#if Icon}
		<div class={cn('mx-auto mb-3 grid size-10 place-items-center rounded-full', bg[tone])}>
			<Icon class={cn('size-5', fg[tone])} stroke-width="2" />
		</div>
	{/if}
	{#if title}
		<p class="font-medium">{title}</p>
	{/if}
	{#if description}
		<p class={cn('text-sm text-[var(--color-fg-muted)]', title && 'mt-1')}>{description}</p>
	{/if}
	{#if children}
		<div class="mt-4 flex justify-center gap-2">{@render children()}</div>
	{/if}
</Card>
