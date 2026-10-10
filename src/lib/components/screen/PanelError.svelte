<script lang="ts">
	import IconTriangleAlert from '~icons/lucide/triangle-alert';

	// A failed query is the panel's to show; the rest of the screen still draws.
	let { error }: { error: string } = $props();
</script>

<p class="text-3xs mt-1.5 flex items-start gap-1.5 text-[var(--color-fg-muted)]">
	<IconTriangleAlert class="mt-px size-3 shrink-0 text-[var(--color-warning)]" />
	<span class="break-words">{error}</span>
</p>
