<script lang="ts">
	import { cn } from '$lib/utils/cn';

	interface Props {
		class?: string;
		style?: string;
		rounded?: 'sm' | 'md' | 'lg' | 'full' | 'none';
	}

	let { class: klass = '', style, rounded = 'md' }: Props = $props();

	const roundedClass = $derived(
		{
			none: '',
			sm: 'rounded-sm',
			md: 'rounded-md',
			lg: 'rounded-lg',
			full: 'rounded-full'
		}[rounded]
	);
</script>

<div
	class={cn(
		'animate-pulse bg-[var(--color-surface-3)]',
		roundedClass,
		klass
	)}
	{style}
></div>
