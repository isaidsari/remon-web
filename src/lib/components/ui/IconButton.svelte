<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLButtonAttributes } from 'svelte/elements';
	import { cn } from '$lib/utils/cn';
	import Spinner from './Spinner.svelte';

	type Size = 'sm' | 'md' | 'lg';
	type Tone = 'default' | 'danger';

	interface Props extends HTMLButtonAttributes {
		/** Tooltip and accessible name; an icon-only control needs one. */
		label: string;
		size?: Size;
		tone?: Tone;
		loading?: boolean;
		children: Snippet;
	}

	let {
		label,
		size = 'md',
		tone = 'default',
		loading = false,
		disabled = false,
		class: klass = '',
		children,
		type = 'button',
		...rest
	}: Props = $props();

	const sizes: Record<Size, string> = { sm: 'size-7', md: 'size-8', lg: 'size-9' };
	const tones: Record<Tone, string> = {
		default: 'hover:border-[var(--color-border-strong)] hover:text-[var(--color-fg)]',
		danger: 'hover:border-[var(--color-danger)]/50 hover:text-[var(--color-danger)]'
	};
</script>

<button
	{type}
	disabled={disabled || loading}
	title={label}
	aria-label={label}
	class={cn(
		'grid shrink-0 place-items-center rounded-[var(--radius-input)] border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-fg-muted)] transition duration-[var(--dur-fast)] disabled:cursor-not-allowed disabled:opacity-40',
		sizes[size],
		tones[tone],
		klass
	)}
	{...rest}
>
	{#if loading}
		<Spinner class="size-3" />
	{:else}
		{@render children()}
	{/if}
</button>
