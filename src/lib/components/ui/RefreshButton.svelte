<script lang="ts">
	import { cn } from '$lib/utils/cn';
	import { m } from '$lib/paraglide/messages';
	import IconButton from './IconButton.svelte';
	import IconRefresh from '~icons/lucide/refresh-cw';

	interface Props {
		onclick: () => void;
		loading?: boolean;
		label?: string;
		class?: string;
	}

	let {
		onclick,
		loading = false,
		label = m.chart_refresh_aria(),
		class: klass = ''
	}: Props = $props();
</script>

<IconButton {label} {onclick} disabled={loading} class={klass}>
	<IconRefresh class={cn('size-[14px]', loading && 'animate-spin')} stroke-width="2" />
</IconButton>
