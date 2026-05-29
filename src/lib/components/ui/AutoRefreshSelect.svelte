<script lang="ts">
	import { cn } from '$lib/utils/cn';
	import { m } from '$lib/paraglide/messages';
	import IconChevronDown from '~icons/lucide/chevron-down';

	export type AutoRefreshOption = {
		value: string;
		label: string;
	};

	interface Props {
		value: string;
		options: AutoRefreshOption[];
		onChange: (value: string) => void;
		label?: string;
		class?: string;
	}

	let { value, options, onChange, label = 'auto', class: klass = '' }: Props = $props();
	let open = $state(false);
	let root = $state<HTMLDivElement | null>(null);
	let selected = $derived(options.find((option) => option.value === value) ?? options[0]);

	function choose(next: string) {
		onChange(next);
		open = false;
	}

	function onFocusOut(e: FocusEvent) {
		const next = e.relatedTarget;
		if (next instanceof Node && root?.contains(next)) return;
		open = false;
	}
</script>

<div
	bind:this={root}
	role="group"
	class={cn(
		'relative inline-flex h-8 min-w-0 items-center rounded-[var(--radius-input)] border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-fg)]',
		klass
	)}
	onfocusout={onFocusOut}
>
	<button
		type="button"
		class="inline-flex h-full min-w-0 flex-1 items-center gap-2 rounded-[calc(var(--radius-input)-1px)] px-2 text-left transition hover:bg-[var(--color-surface-2)] focus-visible:outline-none"
		aria-label={m.chart_autorefresh_aria()}
		aria-haspopup="listbox"
		aria-expanded={open}
		title={m.chart_autorefresh_title()}
		onclick={() => (open = !open)}
		onkeydown={(e) => {
			if (e.key === 'Escape') open = false;
		}}
	>
		<span class="shrink-0 text-[11px] tracking-[0.06em] text-[var(--color-fg-muted)]">
			{label}
		</span>
		<span class="min-w-0 flex-1 truncate font-mono text-xs tabular-nums text-[var(--color-fg)]">
			{selected?.label}
		</span>
		<IconChevronDown
			class={cn('size-3.5 shrink-0 text-[var(--color-fg-subtle)] transition', open && 'rotate-180')}
			stroke-width="2"
		/>
	</button>

	{#if open}
		<div
			class="absolute right-0 top-[calc(100%+4px)] z-50 min-w-full overflow-hidden rounded-[var(--radius-input)] border border-[var(--color-border)] bg-[var(--color-surface)] p-0.5 shadow-[0_12px_32px_rgba(0,0,0,0.35)]"
			role="listbox"
			aria-label={m.chart_autorefresh_aria()}
		>
			{#each options as option (option.value)}
				<button
					type="button"
					role="option"
					aria-selected={option.value === value}
					class={cn(
						'flex h-7 w-full items-center rounded-md px-2 font-mono text-xs tabular-nums whitespace-nowrap transition',
						option.value === value
							? 'bg-[var(--color-surface-3)] text-[var(--color-fg)]'
							: 'text-[var(--color-fg-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-fg)]'
					)}
					onclick={() => choose(option.value)}
				>
					{option.label}
				</button>
			{/each}
		</div>
	{/if}
</div>
