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

	let tablistEl: HTMLElement | null = $state(null);

	// Arrow/Home/End navigation per the ARIA tabs pattern (activation follows focus).
	function onKeydown(e: KeyboardEvent) {
		if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
		e.preventDefault();
		const idx = tabs.findIndex((t) => t.key === value);
		if (idx < 0) return;
		const last = tabs.length - 1;
		const next =
			e.key === 'Home'
				? 0
				: e.key === 'End'
					? last
					: e.key === 'ArrowLeft'
						? (idx - 1 + tabs.length) % tabs.length
						: (idx + 1) % tabs.length;
		onSelect(tabs[next].key);
		tablistEl?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
	}
</script>

<div
	bind:this={tablistEl}
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
			tabindex={value === t.key ? 0 : -1}
			onclick={() => onSelect(t.key)}
			onkeydown={onKeydown}
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
