<script lang="ts">
	import type { Snippet } from 'svelte';
	import { scale } from 'svelte/transition';
	import { cn } from '$lib/utils/cn';

	interface Props {
		open: boolean;
		onClose?: () => void;
		title?: string;
		description?: string;
		/** Accessible name when no visible `title` is rendered. */
		ariaLabel?: string;
		closeOnBackdrop?: boolean;
		closeOnEscape?: boolean;
		width?: 'sm' | 'md' | 'lg';
		children?: Snippet;
		footer?: Snippet;
		class?: string;
	}

	let {
		open,
		onClose,
		title,
		description,
		ariaLabel,
		closeOnBackdrop = true,
		closeOnEscape = true,
		width = 'md',
		children,
		footer,
		class: klass = ''
	}: Props = $props();

	let dialogEl = $state<HTMLDialogElement | null>(null);

	const widthCls: Record<NonNullable<Props['width']>, string> = {
		sm: 'max-w-sm',
		md: 'max-w-md',
		lg: 'max-w-2xl'
	};

	$effect(() => {
		const el = dialogEl;
		if (!open || !el) return;

		// Focus containment, inertness and Escape come from the top layer.
		el.showModal();

		// showModal focuses the first control, which arms a confirm dialog's button.
		el.focus({ preventScroll: true });

		// The page behind a modal dialog is inert but still scrollable.
		const prev = document.body.style.overflow;
		document.body.style.overflow = 'hidden';

		return () => {
			document.body.style.overflow = prev;
			// Runs after the outro; closing (not removing) is what restores focus.
			if (el.open) el.close();
		};
	});

	/** Report intent only: closing here would drop the dialog out of the top
	 *  layer mid-outro and the card would flash in-page. */
	function onCancel(e: Event) {
		e.preventDefault();
		if (closeOnEscape) onClose?.();
	}

	// A ::backdrop click reports the dialog itself as the target.
	function onClick(e: MouseEvent) {
		if (closeOnBackdrop && e.target === dialogEl) onClose?.();
	}
</script>

{#if open}
	<dialog
		bind:this={dialogEl}
		tabindex="-1"
		aria-labelledby={title ? 'modal-title' : undefined}
		aria-label={title ? undefined : (ariaLabel ?? 'Dialog')}
		aria-describedby={description ? 'modal-desc' : undefined}
		oncancel={onCancel}
		onclick={onClick}
		class={cn(
			'm-auto flex max-h-[min(90vh,calc(100dvh-2rem))] w-[calc(100%-2rem)] flex-col overflow-hidden rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-0 text-[var(--color-fg)] shadow-2xl',
			'backdrop:bg-black/60 backdrop:backdrop-blur-sm',
			widthCls[width],
			klass
		)}
		transition:scale={{ duration: 130, start: 0.96 }}
	>
		{#if title || description}
			<header class="shrink-0 border-b border-[var(--color-border)] px-6 py-4">
				{#if title}
					<h2 id="modal-title" class="text-base font-semibold text-[var(--color-fg)]">
						{title}
					</h2>
				{/if}
				{#if description}
					<p id="modal-desc" class="mt-1 text-sm text-[var(--color-fg-muted)]">
						{description}
					</p>
				{/if}
			</header>
		{/if}

		{#if children}
			<div class="min-h-0 flex-1 overflow-y-auto px-6 py-5 text-sm text-[var(--color-fg)]">
				{@render children()}
			</div>
		{/if}

		{#if footer}
			<footer
				class="flex shrink-0 items-center justify-end gap-2 border-t border-[var(--color-border)] bg-[var(--color-bg-soft)]/40 px-6 py-3"
			>
				{@render footer()}
			</footer>
		{/if}
	</dialog>
{/if}
