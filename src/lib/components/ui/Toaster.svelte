<script lang="ts">
	import { toast, type ToastVariant } from '$lib/stores/toast.svelte';
	import { m } from '$lib/paraglide/messages';
	import IconX from '~icons/lucide/x';

	const variantStyles: Record<ToastVariant, string> = {
		info: 'border-[var(--color-info)]/40 bg-[var(--color-info)]/10',
		success: 'border-[var(--color-success)]/40 bg-[var(--color-success)]/10',
		warning: 'border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10',
		error: 'border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10'
	};

	const variantDots: Record<ToastVariant, string> = {
		info: 'bg-[var(--color-info)]',
		success: 'bg-[var(--color-success)]',
		warning: 'bg-[var(--color-warning)]',
		error: 'bg-[var(--color-danger)]'
	};
</script>

<div class="pointer-events-none fixed top-4 right-4 z-50 flex w-96 max-w-[90vw] flex-col gap-2">
	{#each toast.items as t (t.id)}
		<div
			class={`pointer-events-auto rounded-[var(--radius-card)] border bg-[var(--color-surface)] px-4 py-3 shadow-lg backdrop-blur ${variantStyles[t.variant]}`}
			role="status"
			aria-live="polite"
		>
			<div class="flex items-start gap-3">
				<span class={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${variantDots[t.variant]}`}></span>
				<div class="min-w-0 flex-1">
					<p class="text-sm font-medium text-[var(--color-fg)]">{t.title}</p>
					{#if t.description}
						<p class="mt-1 text-xs text-[var(--color-fg-muted)]">{t.description}</p>
					{/if}
				</div>
				<button
					type="button"
					onclick={() => toast.dismiss(t.id)}
					class="text-[var(--color-fg-subtle)] hover:text-[var(--color-fg)]"
					aria-label={m.common_dismiss()}
				>
					<IconX class="size-4" stroke-width="2" />
				</button>
			</div>
		</div>
	{/each}
</div>
