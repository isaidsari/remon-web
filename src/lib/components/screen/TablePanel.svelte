<script lang="ts">
	import Card from '$lib/components/ui/Card.svelte';
	import Skeleton from '$lib/components/ui/Skeleton.svelte';
	import { tableRows } from '$lib/screen/plan';
	import { formatValue } from '$lib/screen/format';
	import type { Column, QueryResult } from '$lib/types/screen';
	import { m } from '$lib/paraglide/messages';
	import PanelError from './PanelError.svelte';

	interface Props {
		title: string;
		columns: Column[];
		limit?: number;
		range: string;
		path: string;
		results: Map<string, QueryResult> | null;
	}

	let { title, columns, limit, range, path, results }: Props = $props();

	let table = $derived(results ? tableRows(columns, path, results, limit) : null);
	let windowed = $derived(columns.some((c) => (c.agg ?? 'current') !== 'current'));
</script>

<Card class="flex h-full flex-col" padding="sm">
	<div class="mb-2 flex items-baseline justify-between gap-2">
		<h2 class="truncate text-sm font-medium text-[var(--color-fg)]">{title}</h2>
		{#if windowed}
			<span class="text-3xs shrink-0 font-mono text-[var(--color-fg-subtle)]">{range}</span>
		{/if}
	</div>
	{#if !table}
		<Skeleton class="h-32 w-full" rounded="lg" />
	{:else if table.rows.length === 0}
		<p class="text-2xs py-6 text-center text-[var(--color-fg-subtle)]">{m.screen_no_data()}</p>
	{:else}
		<div class="min-w-0 overflow-x-auto">
			<table class="w-full text-xs">
				<thead>
					<tr class="text-3xs text-left text-[var(--color-fg-subtle)]">
						<th class="pb-1.5 font-medium">{m.screen_table_key()}</th>
						{#each columns as column, i (i)}
							<th class="pb-1.5 pl-3 text-right font-medium">{column.label}</th>
						{/each}
					</tr>
				</thead>
				<tbody>
					{#each table.rows as row (row.key)}
						<tr class="border-t border-[var(--color-border)]">
							<td class="max-w-[14rem] truncate py-1.5 font-mono text-[var(--color-fg)]">
								{row.label}
							</td>
							{#each row.cells as cell, i (i)}
								<td
									class="py-1.5 pl-3 text-right font-mono text-[var(--color-fg-muted)] tabular-nums"
								>
									{formatValue(cell, table.units[i])}
								</td>
							{/each}
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
	{#each table?.errors ?? [] as error (error)}
		<PanelError {error} />
	{/each}
</Card>
