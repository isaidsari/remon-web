<script lang="ts">
	import type { Snippet } from 'svelte';
	import Card from './Card.svelte';
	import Skeleton from './Skeleton.svelte';
	import { cn } from '$lib/utils/cn';

	interface Props {
		/** Header cells, rendered inside the one `<thead>` row. */
		head: Snippet;
		/** Body rows. Below `md` each row stacks into a card: give a cell
		 *  `data-label` to keep its heading, `class="actions"` for the button row. */
		children: Snippet;
		/** Replaces the rows with skeletons; use it only for the first load. */
		loading?: boolean;
		/** Full-width message when there is nothing to list. */
		empty?: string;
		footer?: Snippet;
		/** Cap the height so the card scrolls instead of the page. */
		scroll?: boolean;
		class?: string;
	}

	let {
		head,
		children,
		loading = false,
		empty,
		footer,
		scroll = true,
		class: klass = ''
	}: Props = $props();

	let headRow = $state<HTMLTableRowElement | null>(null);
	let cols = $derived(headRow?.children.length ?? 1);
</script>

<Card padding="none" class={cn('overflow-hidden', klass)}>
	<div class={cn('overflow-auto', scroll && 'max-h-[max(18rem,calc(100dvh-22rem))]')}>
		<table class="data-table w-full text-sm">
			<thead>
				<tr bind:this={headRow}>{@render head()}</tr>
			</thead>
			<tbody>
				{#if loading}
					{#each { length: 6 } as _, i (i)}
						<tr>
							{#each { length: cols } as _, j (j)}
								<td><Skeleton class="h-3 w-24 max-w-full" /></td>
							{/each}
						</tr>
					{/each}
				{:else}
					{@render children()}
					{#if empty}
						<tr class="detail">
							<td colspan={cols} class="data-table-empty">{empty}</td>
						</tr>
					{/if}
				{/if}
			</tbody>
		</table>
	</div>
	{#if footer}
		<div class="border-t border-[var(--color-border)] px-4 py-3 text-center">
			{@render footer()}
		</div>
	{/if}
</Card>
