<script lang="ts">
	import type { Snippet } from 'svelte';
	import { cn } from '$lib/utils/cn';

	interface Props {
		label?: string;
		hint?: string;
		error?: string | null;
		required?: boolean;
		for?: string;
		class?: string;
		children: Snippet;
	}

	let {
		label,
		hint,
		error,
		required = false,
		for: htmlFor,
		class: klass = '',
		children
	}: Props = $props();
</script>

<div class={cn('flex flex-col gap-1.5', klass)}>
	{#if label}
		<label for={htmlFor} class="text-xs font-medium text-[var(--color-fg-muted)] tracking-wide">
			{label}
			{#if required}<span class="text-[var(--color-danger)]">*</span>{/if}
		</label>
	{/if}
	{@render children()}
	{#if error}
		<p class="text-xs text-[var(--color-danger)]">{error}</p>
	{:else if hint}
		<p class="text-xs text-[var(--color-fg-subtle)]">{hint}</p>
	{/if}
</div>
