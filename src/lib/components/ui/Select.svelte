<script lang="ts" generics="T">
	import type { Snippet } from 'svelte';
	import type { HTMLSelectAttributes } from 'svelte/elements';
	import { cn } from '$lib/utils/cn';
	import IconChevronDown from '~icons/lucide/chevron-down';

	interface Props extends Omit<HTMLSelectAttributes, 'value' | 'class'> {
		value?: T;
		/** Applied to the wrapper, so width utilities size the whole control. */
		class?: string;
		children: Snippet;
	}

	let { value = $bindable(), class: klass = '', children, ...rest }: Props = $props();
</script>

<div class={cn('relative', klass)}>
	<select
		bind:value
		class="text-md h-9 w-full appearance-none rounded-[var(--radius-input)] bg-[var(--color-surface-2)] pr-8 pl-3 text-[var(--color-fg)] shadow-[inset_0_0_0_1px_var(--color-border)] transition-all duration-[var(--dur-fast)] hover:shadow-[inset_0_0_0_1px_var(--color-border-strong)] focus:bg-[var(--color-surface-3)] focus:shadow-[inset_0_0_0_1px_var(--color-accent)] focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
		{...rest}
	>
		{@render children()}
	</select>
	<IconChevronDown
		class="pointer-events-none absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2 text-[var(--color-fg-subtle)]"
		aria-hidden="true"
	/>
</div>
