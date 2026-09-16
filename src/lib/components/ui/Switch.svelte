<script lang="ts">
	import { cn } from '$lib/utils/cn';

	interface Props {
		checked: boolean;
		onchange: (checked: boolean) => void;
		/** Accessible name; also the tooltip. */
		label: string;
		disabled?: boolean;
		class?: string;
	}

	let { checked, onchange, label, disabled = false, class: klass = '' }: Props = $props();
</script>

<button
	type="button"
	role="switch"
	aria-checked={checked}
	aria-label={label}
	title={label}
	{disabled}
	onclick={() => onchange(!checked)}
	class={cn(
		'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-[var(--dur-mid)] disabled:cursor-not-allowed disabled:opacity-50',
		checked ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-border-strong)]',
		klass
	)}
>
	<span
		class={cn(
			'pointer-events-none inline-block size-4 rounded-full bg-white shadow transition-transform duration-[var(--dur-mid)] ease-[var(--ease-snap)]',
			checked ? 'translate-x-4' : 'translate-x-0'
		)}
	></span>
</button>
