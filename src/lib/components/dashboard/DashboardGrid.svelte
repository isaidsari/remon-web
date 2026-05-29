<script lang="ts">
	import type { Connection } from '$lib/stores/connections.svelte';
	import type { DashboardLayout } from '$lib/types/dashboard';
	import { DASHBOARD_COLUMNS } from '$lib/types/dashboard';
	import WidgetHost from './WidgetHost.svelte';
	import { m } from '$lib/paraglide/messages';
	import IconSettings from '~icons/lucide/settings-2';
	import IconX from '~icons/lucide/x';

	interface Props {
		layout: DashboardLayout;
		conn: Connection | null;
		editing?: boolean;
		onConfigure?: (id: string) => void;
		onRemove?: (id: string) => void;
		/** Fixed grid row height in px; widget pixel height = h × this + gaps. */
		rowHeight?: number;
	}

	let { layout, conn, editing = false, onConfigure, onRemove, rowHeight = 76 }: Props = $props();

	// Source order drives the single-column mobile stacking, so sort by (y, x).
	let ordered = $derived([...layout.widgets].sort((a, b) => a.y - b.y || a.x - b.x));
</script>

<div class="dash-grid" style="--cols: {DASHBOARD_COLUMNS}; --row-h: {rowHeight}px;">
	{#each ordered as widget (widget.id)}
		<div
			class="dash-cell"
			class:editing
			style="--gx: {widget.x + 1}; --gy: {widget.y + 1}; --gw: {widget.w}; --gh: {widget.h};"
		>
			{#if editing}
				<div class="absolute right-1.5 top-1.5 z-10 flex items-center gap-1">
					<button
						type="button"
						onclick={() => onConfigure?.(widget.id)}
						aria-label={m.dashboard_configure_widget()}
						class="grid size-7 place-items-center rounded-md bg-[var(--color-surface-3)] text-[var(--color-fg-muted)] shadow-[0_0_0_1px_var(--color-border)] transition-colors hover:text-[var(--color-fg)]"
					>
						<IconSettings class="size-3.5" stroke-width="2" />
					</button>
					<button
						type="button"
						onclick={() => onRemove?.(widget.id)}
						aria-label={m.dashboard_remove_widget()}
						class="grid size-7 place-items-center rounded-md bg-[var(--color-surface-3)] text-[var(--color-fg-muted)] shadow-[0_0_0_1px_var(--color-border)] transition-colors hover:text-[var(--color-danger)]"
					>
						<IconX class="size-3.5" stroke-width="2" />
					</button>
				</div>
				<!-- Block interaction with the widget body while editing so clicks land on the chrome. -->
				<div class="pointer-events-none h-full">
					<WidgetHost {widget} {conn} />
				</div>
			{:else}
				<WidgetHost {widget} {conn} />
			{/if}
		</div>
	{/each}
</div>

<style>
	.dash-grid {
		display: grid;
		grid-template-columns: repeat(var(--cols), minmax(0, 1fr));
		grid-auto-rows: var(--row-h);
		gap: 0.75rem;
	}

	.dash-cell {
		position: relative;
		grid-column: var(--gx) / span var(--gw);
		grid-row: var(--gy) / span var(--gh);
		min-width: 0;
		min-height: 0;
	}

	/* Single dashed ring sitting on the card edge (offset -1px overlaps the
	   card's own 1px border) so edit mode reads as one intentional outline,
	   not a doubled border. */
	.dash-cell.editing {
		outline: 1px dashed color-mix(in oklab, var(--color-accent) 60%, transparent);
		outline-offset: -1px;
		border-radius: var(--radius-card);
	}

	/* Below md: collapse to one column, stack in source order, let height grow. */
	@media (max-width: 767px) {
		.dash-grid {
			grid-template-columns: 1fr;
			grid-auto-rows: min-content;
		}
		.dash-cell {
			grid-column: 1 / -1;
			grid-row: auto;
			min-height: calc(var(--gh) * var(--row-h));
		}
	}
</style>
