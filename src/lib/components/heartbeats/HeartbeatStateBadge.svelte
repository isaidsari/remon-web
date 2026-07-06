<script lang="ts">
	import { cn } from '$lib/utils/cn';
	import { m } from '$lib/paraglide/messages';
	import type { HeartbeatState } from '$lib/types/api';
	import IconCircleCheck from '~icons/lucide/circle-check';
	import IconCircleX from '~icons/lucide/circle-x';
	import IconCircleAlert from '~icons/lucide/circle-alert';
	import IconClock from '~icons/lucide/clock';
	import IconHourglass from '~icons/lucide/hourglass';
	import IconPause from '~icons/lucide/pause';
	import IconCircleOff from '~icons/lucide/circle-off';

	interface Props {
		state: HeartbeatState;
		class?: string;
	}

	let { state, class: klass = '' }: Props = $props();

	const palettes: Record<HeartbeatState, string> = {
		up: 'bg-[var(--color-success-bg)] text-[var(--color-success)]',
		late: 'bg-[var(--color-warning-bg)] text-[var(--color-warning)]',
		down: 'bg-[var(--color-danger-bg)] text-[var(--color-danger)]',
		failed: 'bg-[var(--color-danger-bg)] text-[var(--color-danger)]',
		waiting: 'bg-[var(--color-surface-2)] text-[var(--color-fg-muted)]',
		paused: 'bg-[var(--color-surface-2)] text-[var(--color-info)]',
		disabled: 'bg-[var(--color-surface-2)] text-[var(--color-fg-faint)]'
	};

	const icons = {
		up: IconCircleCheck,
		late: IconClock,
		down: IconCircleX,
		failed: IconCircleAlert,
		waiting: IconHourglass,
		paused: IconPause,
		disabled: IconCircleOff
	} as const;

	// Static switch: paraglide messages are tree-shaken, so dynamic key
	// lookup would include all messages.
	let label = $derived.by(() => {
		switch (state) {
			case 'up':
				return m.heartbeat_state_up();
			case 'late':
				return m.heartbeat_state_late();
			case 'down':
				return m.heartbeat_state_down();
			case 'failed':
				return m.heartbeat_state_failed();
			case 'waiting':
				return m.heartbeat_state_waiting();
			case 'paused':
				return m.heartbeat_state_paused();
			case 'disabled':
				return m.heartbeat_state_disabled();
		}
	});

	const Icon = $derived(icons[state]);
</script>

<span
	class={cn(
		'inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[10px] tracking-[0.04em]',
		palettes[state],
		klass
	)}
>
	<Icon class="size-[11px]" stroke-width="2.25" />
	{label}
</span>
