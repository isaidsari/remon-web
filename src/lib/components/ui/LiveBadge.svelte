<script lang="ts">
	import { cn } from '$lib/utils/cn';
	import { m } from '$lib/paraglide/messages';
	import type { LiveTone } from '$lib/utils/connTone';

	interface Props {
		tone: LiveTone;
		label?: string;
		live?: boolean;
		class?: string;
	}

	let { tone, label, live = false, class: klass = '' }: Props = $props();

	const dotBg: Record<LiveTone, string> = {
		online: 'bg-[var(--color-success)]',
		connecting: 'bg-[var(--color-warning)]',
		warning: 'bg-[var(--color-warning)]',
		offline: 'bg-[var(--color-danger)]',
		idle: 'bg-[var(--color-fg-subtle)]'
	};

	// CSS variable so keyframes read the tone color, not the muted label text color.
	const pulseColor: Record<LiveTone, string> = {
		online: 'var(--color-success)',
		connecting: 'var(--color-warning)',
		warning: 'var(--color-warning)',
		offline: 'var(--color-danger)',
		idle: 'var(--color-fg-subtle)'
	};

	function defaultLabel(t: LiveTone): string {
		switch (t) {
			case 'online': return m.livebadge_online();
			case 'connecting': return m.livebadge_connecting();
			case 'warning': return m.livebadge_degraded();
			case 'offline': return m.livebadge_offline();
			case 'idle': return m.livebadge_idle();
		}
	}
</script>

<span
	class={cn(
		'inline-flex items-center gap-1.5 text-[11px] text-[var(--color-fg-muted)]',
		klass
	)}
>
	<span
		class={cn('relative inline-block h-1.5 w-1.5 shrink-0 rounded-full', dotBg[tone], live && 'live-pulse')}
		style={live ? `--pulse-color: ${pulseColor[tone]}` : undefined}
		aria-hidden="true"
	></span>
	<span class="leading-none">
		{label ?? defaultLabel(tone)}
	</span>
</span>
