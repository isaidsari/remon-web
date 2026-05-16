<script lang="ts">
	import type { Snippet } from 'svelte';
	import { fade, scale } from 'svelte/transition';
	import { cn } from '$lib/utils/cn';

	interface Props {
		open: boolean;
		onClose?: () => void;
		title?: string;
		description?: string;
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
		closeOnBackdrop = true,
		closeOnEscape = true,
		width = 'md',
		children,
		footer,
		class: klass = ''
	}: Props = $props();

	const widthCls: Record<NonNullable<Props['width']>, string> = {
		sm: 'max-w-sm',
		md: 'max-w-md',
		lg: 'max-w-2xl'
	};

	$effect(() => {
		if (!open) return;
		const onKey = (e: KeyboardEvent) => {
			if (closeOnEscape && e.key === 'Escape') {
				e.preventDefault();
				onClose?.();
			}
		};
		window.addEventListener('keydown', onKey);
		const prev = document.body.style.overflow;
		document.body.style.overflow = 'hidden';
		return () => {
			window.removeEventListener('keydown', onKey);
			document.body.style.overflow = prev;
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
			role="dialog"
			aria-modal="true"
			aria-labelledby={title ? 'modal-title' : undefined}
			aria-describedby={description ? 'modal-desc' : undefined}
			class={cn(
				'relative w-full rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-2xl',
				widthCls[width],
				klass
			)}
			transition:scale={{ duration: 130, start: 0.96 }}
		>
			{#if title || description}
				<header class="border-b border-[var(--color-border)] px-6 py-4">
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
				<div class="px-6 py-5 text-sm text-[var(--color-fg)]">
					{@render children()}
				</div>
			{/if}

			{#if footer}
				<footer
					class="flex items-center justify-end gap-2 border-t border-[var(--color-border)] bg-[var(--color-bg-soft)]/40 px-6 py-3"
				>
					{@render footer()}
				</footer>
			{/if}
		</div>
	</div>
{/if}
