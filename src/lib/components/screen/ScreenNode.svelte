<script lang="ts">
	import type { Connection } from '$lib/stores/connections.svelte';
	import type { QueryResult, Screen, ScreenNode } from '$lib/types/screen';
	import { childPath, spanLabel, spanOf, tabPath } from '$lib/screen/plan';
	import type { ScreenEdit } from '$lib/screen/edit';
	import { cn } from '$lib/utils/cn';
	import Self from './ScreenNode.svelte';
	import LinePanel from './LinePanel.svelte';
	import StatPanel from './StatPanel.svelte';
	import TablePanel from './TablePanel.svelte';
	import WidgetPanel from './WidgetPanel.svelte';
	import UnsupportedPanel from './UnsupportedPanel.svelte';
	import EventsPanel from './EventsPanel.svelte';
	import NotePanel from './NotePanel.svelte';
	import { m } from '$lib/paraglide/messages';
	import IconArrowUp from '~icons/lucide/arrow-up';
	import IconArrowDown from '~icons/lucide/arrow-down';
	import IconX from '~icons/lucide/x';

	interface Props {
		node: ScreenNode;
		path: string;
		/** The whole screen: its time (range or window) and marks reach every panel. */
		screen: Screen;
		results: Map<string, QueryResult> | null;
		conn: Connection;
		edit?: ScreenEdit;
	}

	let { node, path, screen, results, conn, edit }: Props = $props();

	const TOOL =
		'grid size-7 place-items-center rounded-md bg-[var(--color-surface-3)] text-[var(--color-fg-muted)] shadow-[0_0_0_1px_var(--color-border)] transition-colors hover:text-[var(--color-fg)] disabled:opacity-40 disabled:hover:text-[var(--color-fg-muted)]';

	// Phones get one column whatever the spec asks; the spec's count applies
	// from `md` up, and four only where there is room for four.
	const COLUMNS: Record<number, string> = {
		1: '',
		2: 'md:grid-cols-2',
		3: 'md:grid-cols-3',
		4: 'md:grid-cols-2 xl:grid-cols-4'
	};

	let activeTab = $state(0);
</script>

<svelte:boundary onerror={(e) => console.error('screen node failed', path, e)}>
	{#if node.type === 'grid'}
		<div class={cn('grid grid-cols-1 gap-3', COLUMNS[node.columns])}>
			{#each node.children as child, i (i)}
				{@const at = childPath(path, i)}
				<div
					class={cn(
						'relative min-w-0',
						edit &&
							'rounded-[var(--radius-card)] outline-1 outline-offset-4 outline-[var(--color-border)] outline-dashed'
					)}
				>
					{#if edit}
						<div class="absolute -top-3 right-2 z-10 flex gap-1">
							<button
								type="button"
								class={TOOL}
								disabled={i === 0}
								onclick={() => edit.move(at, -1)}
								aria-label={m.screen_move_earlier()}
								title={m.screen_move_earlier()}
							>
								<IconArrowUp class="size-3.5" stroke-width="2" />
							</button>
							<button
								type="button"
								class={TOOL}
								disabled={i === node.children.length - 1}
								onclick={() => edit.move(at, 1)}
								aria-label={m.screen_move_later()}
								title={m.screen_move_later()}
							>
								<IconArrowDown class="size-3.5" stroke-width="2" />
							</button>
							<button
								type="button"
								class={cn(TOOL, 'hover:text-[var(--color-danger)]')}
								onclick={() => edit.remove(at)}
								aria-label={m.dashboard_remove_widget()}
								title={m.dashboard_remove_widget()}
							>
								<IconX class="size-3.5" stroke-width="2" />
							</button>
						</div>
					{/if}
					<Self node={child} path={at} {screen} {results} {conn} {edit} />
				</div>
			{/each}
		</div>
	{:else if node.type === 'tabs'}
		<div class="space-y-3">
			<div class="flex flex-wrap gap-1" role="tablist">
				{#each node.tabs as tab, i (i)}
					<button
						type="button"
						role="tab"
						aria-selected={activeTab === i}
						onclick={() => (activeTab = i)}
						class={cn(
							'rounded-md px-2.5 py-1 text-xs transition-colors duration-[var(--dur-fast)]',
							activeTab === i
								? 'bg-[var(--color-surface-2)] text-[var(--color-fg)]'
								: 'text-[var(--color-fg-subtle)] hover:text-[var(--color-fg)]'
						)}
					>
						{tab.title}
					</button>
				{/each}
			</div>
			{#if node.tabs[activeTab]}
				<Self
					node={node.tabs[activeTab].child}
					path={tabPath(path, activeTab)}
					{screen}
					{results}
					{conn}
					{edit}
				/>
			{/if}
		</div>
	{:else if node.type === 'line'}
		<LinePanel
			title={node.title}
			specs={node.series}
			range={spanLabel(spanOf(screen, node.range))}
			{path}
			{results}
			marks={screen.marks}
		/>
	{:else if node.type === 'stat'}
		<StatPanel title={node.title} {path} {results} />
	{:else if node.type === 'table'}
		<TablePanel
			title={node.title}
			columns={node.columns}
			limit={node.limit}
			range={spanLabel(spanOf(screen, node.range))}
			{path}
			{results}
		/>
	{:else if node.type === 'widget'}
		<WidgetPanel config={node.config} {path} {conn} />
	{:else if node.type === 'events'}
		<EventsPanel
			title={node.title}
			kinds={node.kinds}
			sources={node.sources}
			span={spanOf(screen)}
			label={spanLabel(spanOf(screen))}
			{conn}
		/>
	{:else if node.type === 'note'}
		<NotePanel text={node.text} />
	{:else}
		<UnsupportedPanel kind={node.kind} />
	{/if}

	{#snippet failed()}
		<UnsupportedPanel kind={node.type} />
	{/snippet}
</svelte:boundary>
