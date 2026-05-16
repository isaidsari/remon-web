<script lang="ts">
	import type { Snippet } from 'svelte';
	import { cn } from '$lib/utils/cn';

	interface Props {
		class?: string;
		padding?: 'none' | 'sm' | 'md' | 'lg';
		hoverable?: boolean;
		children: Snippet;
	}

	let { class: klass = '', padding = 'md', hoverable = false, children }: Props = $props();

	const paddings = {
		none: '',
		sm: 'p-4',
		md: 'p-5',
		lg: 'p-7'
	} as const;
</script>

<div
	class={cn(
		'rounded-[var(--radius-card)] bg-[var(--color-surface)] shadow-[inset_0_1px_0_rgba(255,255,255,0.03),0_0_0_1px_var(--color-border)] transition-shadow duration-[var(--dur-mid)] ease-[var(--ease-snap)]',
		paddings[padding],
		hoverable &&
			'cursor-pointer hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_0_0_1px_var(--color-border-strong)]',
		klass
	)}
>
	{@render children()}
</div>
