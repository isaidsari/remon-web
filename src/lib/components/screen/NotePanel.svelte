<script lang="ts">
	import Card from '$lib/components/ui/Card.svelte';
	import Markdown from '$lib/components/assistant/Markdown.svelte';
	import IconLightbulb from '~icons/lucide/lightbulb';

	// A finding in words. The panels around it carry the numbers it rests on.
	let { text }: { text: string } = $props();
</script>

<Card padding="sm" class="flex h-full gap-3 ring-1 ring-[var(--color-border)]">
	<IconLightbulb class="mt-0.5 size-4 shrink-0 text-[var(--color-accent)]" />
	<div class="text-md min-w-0 leading-relaxed">
		<Markdown {text} />
	</div>
</Card>
