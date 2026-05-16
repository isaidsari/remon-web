<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLButtonAttributes } from 'svelte/elements';
	import { cn } from '$lib/utils/cn';

	type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'subtle';
	type Size = 'sm' | 'md' | 'lg' | 'icon';

	interface Props extends HTMLButtonAttributes {
		variant?: Variant;
		size?: Size;
		loading?: boolean;
		fullWidth?: boolean;
		children?: Snippet;
	}

	let {
		variant = 'primary',
		size = 'md',
		loading = false,
		fullWidth = false,
		disabled = false,
		class: klass = '',
		children,
		type = 'button',
		...rest
	}: Props = $props();

	const base =
		'inline-flex items-center justify-center gap-2 font-medium select-none transition-all duration-[var(--dur-fast)] ease-[var(--ease-snap)] disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]';

	const variants: Record<Variant, string> = {
		primary:
			'bg-[var(--color-accent)] text-[var(--color-accent-fg)] hover:bg-[var(--color-accent-hover)] active:translate-y-px',
		secondary:
			'bg-[var(--color-surface-2)] text-[var(--color-fg)] shadow-[inset_0_0_0_1px_var(--color-border)] hover:bg-[var(--color-surface-3)] hover:shadow-[inset_0_0_0_1px_var(--color-border-strong)] active:translate-y-px',
		ghost:
			'text-[var(--color-fg-subtle)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-fg)]',
		subtle:
			'bg-[var(--color-surface)] text-[var(--color-fg-muted)] shadow-[inset_0_0_0_1px_transparent] hover:shadow-[inset_0_0_0_1px_var(--color-border)] hover:text-[var(--color-fg)]',
		danger:
			'bg-[var(--color-danger)] text-[var(--color-bg)] hover:brightness-110 active:translate-y-px'
	};

	const sizes: Record<Size, string> = {
		sm: 'h-7 px-3 text-[12px] rounded-[var(--radius-input)]',
		md: 'h-9 px-3.5 text-[13px] rounded-[var(--radius-input)]',
		lg: 'h-11 px-5 text-sm rounded-[var(--radius-input)]',
		icon: 'h-9 w-9 rounded-[var(--radius-input)]'
	};
</script>

<button
	{type}
	disabled={disabled || loading}
	class={cn(base, variants[variant], sizes[size], fullWidth && 'w-full', klass)}
	{...rest}
>
	{#if loading}
		<span
			class="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-r-transparent"
			aria-hidden="true"
		></span>
	{/if}
	{@render children?.()}
</button>
