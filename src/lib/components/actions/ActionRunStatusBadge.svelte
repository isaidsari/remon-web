<script lang="ts">
	import { cn } from '$lib/utils/cn';
	import { m } from '$lib/paraglide/messages';
	import type { ActionRunStatus } from '$lib/types/api';
	import IconCircleCheck from '~icons/lucide/circle-check';
	import IconCircleX from '~icons/lucide/circle-x';
	import IconCircleHelp from '~icons/lucide/circle-help';
	import IconLoader from '~icons/lucide/loader';
	import IconSkipForward from '~icons/lucide/skip-forward';
	import IconHourglass from '~icons/lucide/hourglass';
	import IconCircleOff from '~icons/lucide/circle-off';

	interface Props {
		status: ActionRunStatus;
		class?: string;
	}

	let { status, class: klass = '' }: Props = $props();

	// `pending` is the one that wants attention — it is a question waiting on
	// a person, not a report of something that already happened.
	const palettes: Record<ActionRunStatus, string> = {
		pending: 'bg-[var(--color-warning-bg)] text-[var(--color-warning)]',
		running: 'bg-[var(--color-cyan-bg)] text-[var(--color-info)]',
		succeeded: 'bg-[var(--color-success-bg)] text-[var(--color-success)]',
		failed: 'bg-[var(--color-danger-bg)] text-[var(--color-danger)]',
		skipped: 'bg-[var(--color-surface-2)] text-[var(--color-fg-muted)]',
		expired: 'bg-[var(--color-surface-2)] text-[var(--color-fg-faint)]',
		dismissed: 'bg-[var(--color-surface-2)] text-[var(--color-fg-faint)]'
	};

	const icons = {
		pending: IconCircleHelp,
		running: IconLoader,
		succeeded: IconCircleCheck,
		failed: IconCircleX,
		skipped: IconSkipForward,
		expired: IconHourglass,
		dismissed: IconCircleOff
	} as const;

	// Static switch: paraglide messages are tree-shaken, so a dynamic key
	// lookup would pull in the whole catalogue.
	let label = $derived.by(() => {
		switch (status) {
			case 'pending':
				return m.action_status_pending();
			case 'running':
				return m.action_status_running();
			case 'succeeded':
				return m.action_status_succeeded();
			case 'failed':
				return m.action_status_failed();
			case 'skipped':
				return m.action_status_skipped();
			case 'expired':
				return m.action_status_expired();
			case 'dismissed':
				return m.action_status_dismissed();
		}
	});

	const Icon = $derived(icons[status]);
</script>

<span
	class={cn(
		'text-3xs inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 font-mono tracking-[0.04em] whitespace-nowrap',
		palettes[status],
		klass
	)}
>
	<Icon class={cn('size-[11px]', status === 'running' && 'animate-spin')} stroke-width="2.25" />
	{label}
</span>
