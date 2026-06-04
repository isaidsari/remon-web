<script lang="ts" generics="T extends string">
	import { cn } from '$lib/utils/cn';

	export type SegmentOption<T extends string = string> = {
		value: T;
		label: string;
	};

	interface Props<T extends string> {
		value: T;
		options: SegmentOption<T>[];
		onSelect: (value: T) => void;
		ariaLabel: string;
		class?: string;
		buttonClass?: string;
	}

	let {
		value,
		options,
		onSelect,
		ariaLabel,
		class: klass = '',
		buttonClass = ''
	}: Props<T> = $props();

	let tablistEl: HTMLElement | null = $state(null);

	// Arrow/Home/End navigation per the ARIA tabs pattern (activation follows focus).
	function onKeydown(e: KeyboardEvent) {
		if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
		e.preventDefault();
		const idx = options.findIndex((o) => o.value === value);
		if (idx < 0) return;
		const last = options.length - 1;
		const next =
			e.key === 'Home'
				? 0
				: e.key === 'End'
					? last
					: e.key === 'ArrowLeft'
						? (idx - 1 + options.length) % options.length
						: (idx + 1) % options.length;
		onSelect(options[next].value);
		tablistEl?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
	}
</script>

<div
	bind:this={tablistEl}
	class={cn(
		'inline-flex items-center rounded-[var(--radius-input)] border border-[var(--color-border)] bg-[var(--color-surface)] p-0.5',
		klass
	)}
	role="tablist"
	aria-label={ariaLabel}
>
	{#each options as option (option.value)}
		<button
			type="button"
			role="tab"
			aria-selected={value === option.value}
			tabindex={value === option.value ? 0 : -1}
			onclick={() => onSelect(option.value)}
			onkeydown={onKeydown}
			class={cn(
				'rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap transition',
				value === option.value
					? 'bg-[var(--color-surface-3)] text-[var(--color-fg)]'
					: 'text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]',
				buttonClass
			)}
		>
			{option.label}
		</button>
	{/each}
</div>
