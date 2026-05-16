<script lang="ts">
	import { cn } from '$lib/utils/cn';
	import IconCircleCheck from '~icons/lucide/circle-check';
	import IconCircleX from '~icons/lucide/circle-x';
	import IconClock from '~icons/lucide/clock';
	import { m } from '$lib/paraglide/messages';

	interface Props {
		parseOk: boolean | null;
		class?: string;
	}

	let { parseOk, class: klass = '' }: Props = $props();

	let palette = $derived(
		parseOk === true
			? 'bg-[var(--color-success-bg)] text-[var(--color-success)]'
			: parseOk === false
				? 'bg-[var(--color-danger-bg)] text-[var(--color-danger)]'
				: 'bg-[var(--color-surface-2)] text-[var(--color-fg-faint)]'
	);

	let label = $derived(
		parseOk === true ? m.badge_probe_ok() : parseOk === false ? m.badge_probe_fail() : m.badge_probe_pending()
	);

	const Icon = $derived(
		parseOk === true ? IconCircleCheck : parseOk === false ? IconCircleX : IconClock
	);
</script>

<span
	class={cn(
		'inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[10px] tracking-[0.04em]',
		palette,
		klass
	)}
>
	<Icon class="size-[11px]" stroke-width="2.25" />
	{label}
</span>
