<script lang="ts">
	import type { Component, Snippet } from 'svelte';
	import { cn } from '$lib/utils/cn';
	import IconInfo from '~icons/lucide/info';
	import IconCircleCheck from '~icons/lucide/circle-check';
	import IconTriangleAlert from '~icons/lucide/triangle-alert';
	import IconCircleX from '~icons/lucide/circle-x';

	type Variant = 'info' | 'success' | 'warning' | 'danger';

	interface Props {
		variant?: Variant;
		title?: string;
		class?: string;
		children?: Snippet;
		actions?: Snippet;
	}

	let {
		variant = 'info',
		title,
		class: klass = '',
		children,
		actions
	}: Props = $props();

	const wrapper: Record<Variant, string> = {
		info: 'shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--color-info)_30%,transparent)] bg-[var(--color-cyan-bg)]',
		success: 'shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--color-success)_30%,transparent)] bg-[var(--color-success-bg)]',
		warning: 'shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--color-warning)_30%,transparent)] bg-[var(--color-warning-bg)]',
		danger: 'shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--color-danger)_30%,transparent)] bg-[var(--color-danger-bg)]'
	};

	const accent: Record<Variant, string> = {
		info: 'text-[var(--color-info)]',
		success: 'text-[var(--color-success)]',
		warning: 'text-[var(--color-warning)]',
		danger: 'text-[var(--color-danger)]'
	};

	const Icon: Record<Variant, Component> = {
		info: IconInfo,
		success: IconCircleCheck,
		warning: IconTriangleAlert,
		danger: IconCircleX
	};

	let CurrentIcon = $derived(Icon[variant]);
</script>

<div
	role="status"
	class={cn(
		'flex items-start gap-3 rounded-[var(--radius-input)] px-4 py-3 text-sm',
		wrapper[variant],
		klass
	)}
>
	<CurrentIcon
		class={cn('mt-0.5 size-[18px] shrink-0', accent[variant])}
		stroke-width="2"
		aria-hidden="true"
	/>
	<div class="min-w-0 flex-1">
		{#if title}
			<p class="font-medium text-[var(--color-fg)]">{title}</p>
		{/if}
		{#if children}
			<div class={cn(title && 'mt-1', 'text-[var(--color-fg-muted)]')}>
				{@render children()}
			</div>
		{/if}
	</div>
	{#if actions}
		<div class="shrink-0 self-center">
			{@render actions()}
		</div>
	{/if}
</div>
