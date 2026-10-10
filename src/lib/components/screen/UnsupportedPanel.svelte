<script lang="ts">
	import Card from '$lib/components/ui/Card.svelte';
	import { m } from '$lib/paraglide/messages';
	import IconTriangleAlert from '~icons/lucide/triangle-alert';

	// A node or widget this build cannot draw: shown in place, never dropped,
	// so a newer server's screen still draws everything else.
	let { kind }: { kind: string } = $props();
</script>

<Card padding="sm" class="flex items-center gap-2">
	<IconTriangleAlert class="size-3.5 shrink-0 text-[var(--color-warning)]" />
	<p class="text-2xs text-[var(--color-fg-muted)]">{m.screen_unsupported({ kind })}</p>
</Card>
