<script lang="ts">
	import type { Connection } from '$lib/stores/connections.svelte';
	import type { DashboardLayout, Widget } from '$lib/types/dashboard';
	import { DASHBOARD_COLUMNS } from '$lib/types/dashboard';
	import { moveWidget, resizeWidget } from '$lib/dashboard/layout';
	import { WIDGET_META } from '$lib/dashboard/registry';
	import WidgetHost from './WidgetHost.svelte';
	import { m } from '$lib/paraglide/messages';
	import IconMove from '~icons/lucide/move';
	import IconSettings from '~icons/lucide/settings-2';
	import IconX from '~icons/lucide/x';

	interface Props {
		layout: DashboardLayout;
		conn: Connection | null;
		editing?: boolean;
		onConfigure?: (id: string) => void;
		onRemove?: (id: string) => void;
		/** Called once per gesture, on drop. */
		onLayoutChange?: (widgets: Widget[]) => void;
		/** Fixed grid row height in px; widget pixel height = h × this + gaps. */
		rowHeight?: number;
	}

	let {
		layout,
		conn,
		editing = false,
		onConfigure,
		onRemove,
		onLayoutChange,
		rowHeight = 76
	}: Props = $props();

	/** Must match the `gap` the grid renders with, or drag steps drift from the cells. */
	const GAP = 12;

	let gridEl = $state<HTMLElement | null>(null);

	interface Drag {
		id: string;
		mode: 'move' | 'resize';
		pointerId: number;
		startX: number;
		startY: number;
		origin: { x: number; y: number; w: number; h: number };
		colStride: number;
		rowStride: number;
		dx: number;
		dy: number;
	}

	let drag = $state<Drag | null>(null);
	/** Live arrangement while a gesture is in flight; null when idle. */
	let preview = $state<Widget[] | null>(null);

	// Below md the grid is a single column, where dragging cells has no meaning.
	let narrow = $state(false);
	$effect(() => {
		const mq = window.matchMedia('(max-width: 767px)');
		narrow = mq.matches;
		const sync = () => (narrow = mq.matches);
		mq.addEventListener('change', sync);
		return () => mq.removeEventListener('change', sync);
	});

	let widgets = $derived(preview ?? layout.widgets);
	// Source order drives the single-column mobile stacking, so sort by (y, x).
	let ordered = $derived([...widgets].sort((a, b) => a.y - b.y || a.x - b.x));

	let draggedNow = $derived.by(() => {
		const active = drag;
		if (!active) return null;
		return widgets.find((w) => w.id === active.id) ?? null;
	});

	let arrangeable = $derived(editing && !narrow);

	/** `fromHandle` marks the dedicated grips. Dragging the card body has to
	 *  ignore presses that land on the chrome buttons, but the grips are buttons
	 *  themselves, so the same test would swallow the gesture they exist for. */
	function startDrag(e: PointerEvent, widget: Widget, mode: 'move' | 'resize', fromHandle = false) {
		if (!editing || narrow || drag) return;
		if (e.pointerType === 'mouse' && e.button !== 0) return;
		if (!fromHandle && (e.target as HTMLElement).closest('button')) return;

		const width = gridEl?.clientWidth ?? 0;
		if (width <= 0) return;

		drag = {
			id: widget.id,
			mode,
			pointerId: e.pointerId,
			startX: e.clientX,
			startY: e.clientY,
			origin: { x: widget.x, y: widget.y, w: widget.w, h: widget.h },
			// cols·colW + (cols-1)·gap = width, so one column plus its gap is (width + gap)/cols.
			colStride: (width + GAP) / DASHBOARD_COLUMNS,
			rowStride: rowHeight + GAP,
			dx: 0,
			dy: 0
		};
		preview = layout.widgets.map((w) => ({ ...w }));
		e.preventDefault();
	}

	function onPointerMove(e: PointerEvent) {
		if (!drag || e.pointerId !== drag.pointerId) return;
		drag.dx = e.clientX - drag.startX;
		drag.dy = e.clientY - drag.startY;
		const stepX = Math.round(drag.dx / drag.colStride);
		const stepY = Math.round(drag.dy / drag.rowStride);
		// Always recomputed from the committed layout, so dragging back to the
		// start restores the original arrangement exactly.
		preview =
			drag.mode === 'move'
				? moveWidget(layout.widgets, drag.id, drag.origin.x + stepX, drag.origin.y + stepY)
				: resizeWidget(layout.widgets, drag.id, drag.origin.w + stepX, drag.origin.h + stepY);
	}

	function endDrag(e: PointerEvent) {
		if (!drag || e.pointerId !== drag.pointerId) return;
		if (preview) onLayoutChange?.(preview);
		drag = null;
		preview = null;
	}

	function cancelDrag() {
		drag = null;
		preview = null;
	}

	// The gesture is tracked on the window, not on the element it started from.
	// Pointer capture would do it, but the move handle is a 28px button: the
	// pointer leaves it on the first millimetre, and any re-render mid-drag drops
	// the capture with it.
	$effect(() => {
		if (!drag) return;
		window.addEventListener('pointermove', onPointerMove);
		window.addEventListener('pointerup', endDrag);
		window.addEventListener('pointercancel', cancelDrag);
		return () => {
			window.removeEventListener('pointermove', onPointerMove);
			window.removeEventListener('pointerup', endDrag);
			window.removeEventListener('pointercancel', cancelDrag);
		};
	});

	function onKeyDown(e: KeyboardEvent) {
		if (drag && e.key === 'Escape') cancelDrag();
	}

	const STEPS: Record<string, [number, number]> = {
		ArrowLeft: [-1, 0],
		ArrowRight: [1, 0],
		ArrowUp: [0, -1],
		ArrowDown: [0, 1]
	};

	/** Arrows on a focused handle do what dragging it does, one cell at a time. */
	function onArrowKey(e: KeyboardEvent, widget: Widget, mode: 'move' | 'resize') {
		if (!arrangeable) return;
		const step = STEPS[e.key];
		if (!step) return;
		e.preventDefault();
		const [sx, sy] = step;
		onLayoutChange?.(
			mode === 'resize'
				? resizeWidget(layout.widgets, widget.id, widget.w + sx, widget.h + sy)
				: moveWidget(layout.widgets, widget.id, widget.x + sx, widget.y + sy)
		);
	}

	/** Pixels the dragged card is offset from the cell it would land in. */
	function follow(widget: Widget): string {
		if (!drag || drag.mode !== 'move' || widget.id !== drag.id) return '';
		const x = drag.dx - (widget.x - drag.origin.x) * drag.colStride;
		const y = drag.dy - (widget.y - drag.origin.y) * drag.rowStride;
		return `transform: translate(${x}px, ${y}px);`;
	}
</script>

<svelte:window onkeydown={onKeyDown} />

<div
	class="dash-grid"
	bind:this={gridEl}
	style="--cols: {DASHBOARD_COLUMNS}; --row-h: {rowHeight}px; --gap: {GAP}px;"
>
	{#if draggedNow}
		<!-- The cell the card will land in, visible under it while it follows the pointer. -->
		<div
			class="dash-slot"
			style="--gx: {draggedNow.x + 1}; --gy: {draggedNow.y +
				1}; --gw: {draggedNow.w}; --gh: {draggedNow.h};"
		></div>
	{/if}

	{#each ordered as widget (widget.id)}
		<div
			class="dash-cell"
			class:editing
			class:draggable={arrangeable}
			class:dragging={drag?.id === widget.id}
			style="--gx: {widget.x + 1}; --gy: {widget.y +
				1}; --gw: {widget.w}; --gh: {widget.h}; {follow(widget)}"
			role={arrangeable ? 'application' : undefined}
			aria-label={arrangeable ? WIDGET_META[widget.config.kind]?.label() : undefined}
			onpointerdown={(e) => startDrag(e, widget, 'move')}
		>
			{#if editing}
				<div class="absolute top-1.5 right-1.5 z-10 flex items-center gap-1">
					{#if arrangeable}
						<button
							type="button"
							aria-label={m.dashboard_move_widget()}
							onpointerdown={(e) => startDrag(e, widget, 'move', true)}
							onkeydown={(e) => onArrowKey(e, widget, 'move')}
							class="grid size-7 cursor-grab place-items-center rounded-md bg-[var(--color-surface-3)] text-[var(--color-fg-muted)] shadow-[0_0_0_1px_var(--color-border)] transition-colors hover:text-[var(--color-fg)]"
						>
							<IconMove class="size-3.5" stroke-width="2" />
						</button>
					{/if}
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
				{#if arrangeable}
					<button
						type="button"
						class="dash-resize"
						aria-label={m.dashboard_resize_widget()}
						onpointerdown={(e) => startDrag(e, widget, 'resize', true)}
						onkeydown={(e) => onArrowKey(e, widget, 'resize')}
					></button>
				{/if}
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
		gap: var(--gap);
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

	.dash-cell.draggable {
		cursor: grab;
		touch-action: none;
	}

	/* Lifted out of the flow so it tracks the pointer over its neighbours. */
	.dash-cell.dragging {
		cursor: grabbing;
		z-index: 20;
		filter: drop-shadow(0 12px 24px rgb(0 0 0 / 0.45));
	}

	.dash-slot {
		grid-column: var(--gx) / span var(--gw);
		grid-row: var(--gy) / span var(--gh);
		border-radius: var(--radius-card);
		background: color-mix(in oklab, var(--color-accent) 12%, transparent);
		outline: 1px dashed color-mix(in oklab, var(--color-accent) 70%, transparent);
		outline-offset: -1px;
	}

	.dash-resize {
		position: absolute;
		right: 0;
		bottom: 0;
		width: 18px;
		height: 18px;
		cursor: nwse-resize;
		touch-action: none;
		border-bottom-right-radius: var(--radius-card);
		/* Two hairlines reading as a corner grip. */
		background:
			linear-gradient(
					to top left,
					transparent 0 42%,
					color-mix(in oklab, var(--color-accent) 75%, transparent) 42% 52%,
					transparent 52%
				)
				no-repeat,
			linear-gradient(
					to top left,
					transparent 0 62%,
					color-mix(in oklab, var(--color-accent) 75%, transparent) 62% 72%,
					transparent 72%
				)
				no-repeat;
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
		.dash-slot {
			display: none;
		}
	}
</style>
