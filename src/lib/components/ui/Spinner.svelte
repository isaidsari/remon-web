<script lang="ts">
	import { cn } from '$lib/utils/cn';

	let { class: klass = '' }: { class?: string } = $props();
</script>

<span
	class={cn(
		'inline-block size-3.5 shrink-0 animate-spin rounded-full border-2 border-current border-r-transparent',
		klass
	)}
	aria-hidden="true"
></span>
