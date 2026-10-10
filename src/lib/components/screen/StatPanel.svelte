<script lang="ts">
	import Card from '$lib/components/ui/Card.svelte';
	import Skeleton from '$lib/components/ui/Skeleton.svelte';
	import { statValue } from '$lib/screen/plan';
	import { formatValue } from '$lib/screen/format';
	import type { QueryResult } from '$lib/types/screen';
	import PanelError from './PanelError.svelte';

	interface Props {
		title: string;
		path: string;
		results: Map<string, QueryResult> | null;
	}

	let { title, path, results }: Props = $props();

	let stat = $derived(results ? statValue(path, results) : null);
</script>

<Card class="flex h-full flex-col justify-between" padding="sm">
	<h2 class="truncate text-sm font-medium text-[var(--color-fg)]">{title}</h2>
	{#if !stat}
		<Skeleton class="mt-3 h-8 w-24" rounded="md" />
	{:else}
		<p class="mt-3 font-mono text-2xl text-[var(--color-fg)] tabular-nums">
			{formatValue(stat.value, stat.unit)}
		</p>
		{#if stat.error}
			<PanelError error={stat.error} />
		{/if}
	{/if}
</Card>
