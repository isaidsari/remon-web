<script lang="ts" generics="T extends string">
	import { cn } from '$lib/utils/cn';

	export interface Tab<K extends string> {
		key: K;
		label: string;
		count?: number;
	}

	interface Props<K extends string> {
		tabs: Tab<K>[];
		value: K;
		onSelect: (key: K) => void;
		class?: string;
	}

	let { tabs, value, onSelect, class: klass = '' }: Props<T> = $props();
</script>

<div
	role="tablist"
	class={cn(
		'inline-flex items-center rounded-[var(--radius-input)] border border-[var(--color-border)] bg-[var(--color-surface)] p-0.5',
		klass
	)}
>
	{#each tabs as t (t.key)}
		<button
			type="button"
			role="tab"
			aria-selected={value === t.key}
			onclick={() => onSelect(t.key)}
			class={cn(
				'inline-flex items-center gap-2 rounded-md px-3.5 py-1.5 text-sm font-medium transition',
				value === t.key
					? 'bg-[var(--color-surface-3)] text-[var(--color-fg)]'
					: 'text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]'
			)}
		>
			{t.label}
			{#if t.count !== undefined}
				<span
					class={cn(
						'rounded-full px-1.5 py-0.5 text-[10px] tabular-nums',
						value === t.key
							? 'bg-[var(--color-bg)] text-[var(--color-fg-muted)]'
							: 'bg-[var(--color-surface-2)] text-[var(--color-fg-subtle)]'
					)}
				>
					{t.count}
				</span>
			{/if}
		</button>
	{/each}
</div>
