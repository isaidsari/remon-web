<script lang="ts">
	import type { Snippet } from 'svelte';
	import { fade, scale } from 'svelte/transition';
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

	let dialogEl = $state<HTMLElement | null>(null);

	function focusable(container: HTMLElement): HTMLElement[] {
		const sel =
			'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
		return Array.from(container.querySelectorAll<HTMLElement>(sel)).filter(
			(el) => el.offsetParent !== null
		);
	}

	const widthCls: Record<NonNullable<Props['width']>, string> = {
		sm: 'max-w-sm',
		md: 'max-w-md',
		lg: 'max-w-2xl'
	};

	$effect(() => {
		if (!open) return;
		// Remember what had focus so we can hand it back on close.
		const restoreTo = document.activeElement as HTMLElement | null;

		const onKey = (e: KeyboardEvent) => {
			if (closeOnEscape && e.key === 'Escape') {
				e.preventDefault();
				onClose?.();
				return;
			}
			// Trap Tab within the dialog so keyboard focus can't escape behind it.
			if (e.key === 'Tab' && dialogEl) {
				const items = focusable(dialogEl);
				if (items.length === 0) {
					e.preventDefault();
					dialogEl.focus();
					return;
				}
				const first = items[0];
				const last = items[items.length - 1];
				const active = document.activeElement;
				if (e.shiftKey && (active === first || !dialogEl.contains(active))) {
					e.preventDefault();
					last.focus();
				} else if (!e.shiftKey && (active === last || !dialogEl.contains(active))) {
					e.preventDefault();
					first.focus();
				}
			}
		};
		window.addEventListener('keydown', onKey);
		const prev = document.body.style.overflow;
		document.body.style.overflow = 'hidden';

		// Focus the dialog itself, not the first control, so we don't auto-arm a button.
		queueMicrotask(() => dialogEl?.focus({ preventScroll: true }));

		return () => {
			window.removeEventListener('keydown', onKey);
			document.body.style.overflow = prev;
			restoreTo?.focus?.({ preventScroll: true });
		};
	});
</script>

{#if open}
	<div
		role="presentation"
		class="fixed inset-0 z-50 flex items-center justify-center px-4"
		transition:fade={{ duration: 120 }}
	>
		<div
			class="absolute inset-0 bg-black/60 backdrop-blur-sm"
			onclick={() => closeOnBackdrop && onClose?.()}
			role="presentation"
		></div>

		<div
			bind:this={dialogEl}
			role="dialog"
			tabindex="-1"
			aria-modal="true"
			aria-labelledby={title ? 'modal-title' : undefined}
			aria-label={title ? undefined : (ariaLabel ?? 'Dialog')}
			aria-describedby={description ? 'modal-desc' : undefined}
			class={cn(
				'relative flex max-h-[min(90vh,calc(100dvh-2rem))] w-full flex-col overflow-hidden rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-2xl',
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
		</div>
	</div>
{/if}
