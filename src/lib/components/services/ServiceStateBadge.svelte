<script lang="ts">
	import { cn } from '$lib/utils/cn';
	import type { Component } from 'svelte';
	import type { ServiceState } from '$lib/types/api';
	import IconPlay from '~icons/lucide/play';
	import IconSquare from '~icons/lucide/square';
	import IconLoader from '~icons/lucide/loader-circle';
	import IconPause from '~icons/lucide/pause';
	import IconAlertTriangle from '~icons/lucide/triangle-alert';
	import IconRefresh from '~icons/lucide/refresh-cw';
	import IconCircleHelp from '~icons/lucide/circle-help';
	import { m } from '$lib/paraglide/messages';

	function stateLabel(s: ServiceState): string {
		switch (s) {
			case 'running': return m.badge_state_running();
			case 'stopped': return m.badge_state_stopped();
			case 'starting': return m.badge_state_starting();
			case 'stopping': return m.badge_state_stopping();
			case 'paused': return m.badge_state_paused();
			case 'failed': return m.badge_state_failed();
			case 'reloading': return m.badge_state_reloading();
			case 'unknown': return m.badge_state_unknown();
		}
	}

	interface Props {
		state: ServiceState;
		class?: string;
	}

	let { state, class: klass = '' }: Props = $props();

	const palette: Record<ServiceState, string> = {
		running: 'bg-[var(--color-success)]/15 text-[var(--color-success)]',
		stopped: 'bg-[var(--color-fg-subtle)]/15 text-[var(--color-fg-muted)]',
		starting: 'bg-[var(--color-info)]/15 text-[var(--color-info)]',
		stopping: 'bg-[var(--color-warning)]/15 text-[var(--color-warning)]',
		paused: 'bg-[var(--color-warning)]/15 text-[var(--color-warning)]',
		failed: 'bg-[var(--color-danger)]/15 text-[var(--color-danger)]',
		reloading: 'bg-[var(--color-info)]/15 text-[var(--color-info)]',
		unknown: 'bg-[var(--color-surface-2)] text-[var(--color-fg-subtle)]'
	};

	const icons: Record<ServiceState, Component> = {
		running: IconPlay,
		stopped: IconSquare,
		starting: IconLoader,
		stopping: IconLoader,
		paused: IconPause,
		failed: IconAlertTriangle,
		reloading: IconRefresh,
		unknown: IconCircleHelp
	};

	const spin: Partial<Record<ServiceState, boolean>> = {
		starting: true,
		stopping: true,
		reloading: true
	};

	let CurrentIcon = $derived(icons[state]);
</script>

<span
	class={cn(
		'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium',
		palette[state],
		klass
	)}
>
	<CurrentIcon
		class={cn('size-[11px] shrink-0', spin[state] && 'animate-spin')}
		stroke-width="2.5"
	/>
	{stateLabel(state)}
</span>
