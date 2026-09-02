<script lang="ts">
	import type { HTMLInputAttributes } from 'svelte/elements';
	import { cn } from '$lib/utils/cn';

	interface Props extends HTMLInputAttributes {
		invalid?: boolean;
	}

	let { invalid = false, class: klass = '', value = $bindable(''), ...rest }: Props = $props();
</script>

<input
	bind:value
	class={cn(
		'text-md h-9 w-full rounded-[var(--radius-input)] bg-[var(--color-surface-2)] px-3 text-[var(--color-fg)] transition-all duration-[var(--dur-fast)] placeholder:text-[var(--color-fg-faint)]',
		'shadow-[inset_0_0_0_1px_var(--color-border)]',
		'focus:bg-[var(--color-surface-3)] focus:shadow-[inset_0_0_0_1px_var(--color-accent)] focus:outline-none',
		'disabled:cursor-not-allowed disabled:opacity-50',
		'hover:shadow-[inset_0_0_0_1px_var(--color-border-strong)]',
		invalid &&
			'shadow-[inset_0_0_0_1px_var(--color-danger)] focus:shadow-[inset_0_0_0_1px_var(--color-danger)]',
		klass
	)}
	{...rest}
/>
