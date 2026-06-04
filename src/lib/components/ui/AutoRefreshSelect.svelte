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

	let triggerEl = $state<HTMLButtonElement | null>(null);
	let listEl = $state<HTMLDivElement | null>(null);

	function optionButtons(): HTMLButtonElement[] {
		return listEl ? Array.from(listEl.querySelectorAll<HTMLButtonElement>('[role="option"]')) : [];
	}

	function focusSelectedOption() {
		const btns = optionButtons();
		const i = options.findIndex((o) => o.value === value);
		btns[i >= 0 ? i : 0]?.focus();
	}

	function onTriggerKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			open = false;
		} else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
			e.preventDefault();
			open = true;
			queueMicrotask(focusSelectedOption);
		}
	}

	function onListKeydown(e: KeyboardEvent) {
		const btns = optionButtons();
		if (btns.length === 0) return;
		const cur = btns.indexOf(document.activeElement as HTMLButtonElement);
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			btns[cur < 0 ? 0 : (cur + 1) % btns.length].focus();
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			btns[cur <= 0 ? btns.length - 1 : cur - 1].focus();
		} else if (e.key === 'Home') {
			e.preventDefault();
			btns[0].focus();
		} else if (e.key === 'End') {
			e.preventDefault();
			btns[btns.length - 1].focus();
		} else if (e.key === 'Escape') {
			e.preventDefault();
			open = false;
			triggerEl?.focus();
		}
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
		bind:this={triggerEl}
		type="button"
		class="inline-flex h-full min-w-0 flex-1 items-center gap-2 rounded-[calc(var(--radius-input)-1px)] px-2 text-left transition hover:bg-[var(--color-surface-2)] focus-visible:outline-none"
		aria-label={m.chart_autorefresh_aria()}
		aria-haspopup="listbox"
		aria-expanded={open}
		title={m.chart_autorefresh_title()}
		onclick={() => (open = !open)}
		onkeydown={onTriggerKeydown}
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
			bind:this={listEl}
			class="absolute right-0 top-[calc(100%+4px)] z-50 min-w-full overflow-hidden rounded-[var(--radius-input)] border border-[var(--color-border)] bg-[var(--color-surface)] p-0.5 shadow-[0_12px_32px_rgba(0,0,0,0.35)]"
			role="listbox"
			aria-label={m.chart_autorefresh_aria()}
		>
			{#each options as option (option.value)}
				<button
					type="button"
					role="option"
					aria-selected={option.value === value}
					onkeydown={onListKeydown}
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
