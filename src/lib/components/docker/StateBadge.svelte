<script lang="ts">
	import { cn } from '$lib/utils/cn';
	import type { Component } from 'svelte';
	import IconPlay from '~icons/lucide/play';
	import IconPause from '~icons/lucide/pause';
	import IconRefresh from '~icons/lucide/refresh-cw';
	import IconSquare from '~icons/lucide/square';
	import IconSkull from '~icons/lucide/skull';
	import IconCirclePlus from '~icons/lucide/circle-plus';
	import IconCircleHelp from '~icons/lucide/circle-help';
	import { m } from '$lib/paraglide/messages';

	function stateLabel(raw: string): string {
		switch (raw.toLowerCase()) {
			case 'running':
				return m.badge_state_running();
			case 'paused':
				return m.badge_state_paused();
			case 'restarting':
				return m.badge_state_restarting();
			case 'exited':
				return m.badge_state_exited();
			case 'dead':
				return m.badge_state_dead();
			case 'created':
				return m.badge_state_created();
			default:
				return raw;
		}
	}

	interface Props {
		state: string;
		class?: string;
	}

	let { state, class: klass = '' }: Props = $props();

	const styles: Record<string, string> = {
		running: 'bg-[var(--color-success)]/15 text-[var(--color-success)]',
		paused: 'bg-[var(--color-warning)]/15 text-[var(--color-warning)]',
		restarting: 'bg-[var(--color-info)]/15 text-[var(--color-info)]',
		exited: 'bg-[var(--color-fg-subtle)]/15 text-[var(--color-fg-muted)]',
		dead: 'bg-[var(--color-danger)]/15 text-[var(--color-danger)]',
		created: 'bg-[var(--color-fg-subtle)]/15 text-[var(--color-fg-subtle)]'
	};

	const icons: Record<string, Component> = {
		running: IconPlay,
		paused: IconPause,
		restarting: IconRefresh,
		exited: IconSquare,
		dead: IconSkull,
		created: IconCirclePlus
	};

	let key = $derived(state.toLowerCase());
	let cls = $derived(styles[key] ?? 'bg-[var(--color-surface-2)] text-[var(--color-fg-muted)]');
	let Icon = $derived(icons[key] ?? IconCircleHelp);
	let spin = $derived(key === 'restarting');
</script>

<span
	class={cn(
		'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium',
		cls,
		klass
	)}
>
	<Icon class={cn('size-[11px] shrink-0', spin && 'animate-spin')} stroke-width="2.5" />
	{stateLabel(state)}
</span>
