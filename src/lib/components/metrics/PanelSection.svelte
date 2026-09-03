<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		label?: string;
		children: Snippet;
	}

	let { label, children }: Props = $props();
</script>

<!-- A secondary block inside a panel, hairline-separated from what came before. -->
<div class="mt-4 border-t border-[var(--color-border)] pt-4">
	{#if label}
		<p class="text-3xs mb-2 tracking-wide text-[var(--color-fg-muted)]">{label}</p>
	{/if}
	{@render children()}
</div>
