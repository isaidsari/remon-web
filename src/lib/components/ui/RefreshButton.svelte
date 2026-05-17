<script lang="ts">
	import { cn } from '$lib/utils/cn';
	import { m } from '$lib/paraglide/messages';
	import IconRefresh from '~icons/lucide/refresh-cw';

	interface Props {
		onclick: () => void;
		loading?: boolean;
		label?: string;
		class?: string;
	}

	let { onclick, loading = false, label = m.chart_refresh_aria(), class: klass = '' }: Props = $props();
</script>

<button
	type="button"
	{onclick}
	disabled={loading}
	class={cn(
		'grid h-8 w-8 shrink-0 place-items-center rounded-[var(--radius-input)] border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-fg-muted)] transition hover:border-[var(--color-border-strong)] hover:text-[var(--color-fg)] disabled:cursor-not-allowed disabled:opacity-50',
		klass
	)}
	aria-label={label}
	title={label}
>
	<IconRefresh class={cn('size-[14px]', loading && 'animate-spin')} stroke-width="2" />
</button>
