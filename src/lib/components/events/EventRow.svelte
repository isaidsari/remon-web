<script lang="ts" module>
	import type { Component } from 'svelte';
	import type { EventDto, EventSeverity } from '$lib/types/api';
	import IconPower from '~icons/lucide/power';
	import IconRocket from '~icons/lucide/rocket';
	import IconSkull from '~icons/lucide/skull';
	import IconHardDrive from '~icons/lucide/hard-drive';
	import IconActivity from '~icons/lucide/activity';
	import IconContainer from '~icons/lucide/container';
	import IconSquareX from '~icons/lucide/square-x';
	import IconFlame from '~icons/lucide/flame';
	import IconCircleCheck from '~icons/lucide/circle-check';
	import IconBellOff from '~icons/lucide/bell-off';
	import IconBell from '~icons/lucide/bell';
	import IconCamera from '~icons/lucide/camera';
	import IconSlidersHorizontal from '~icons/lucide/sliders-horizontal';
	import IconStethoscope from '~icons/lucide/stethoscope';
	import IconSmartphone from '~icons/lucide/smartphone';
	import IconCircleDot from '~icons/lucide/circle-dot';
	import IconBug from '~icons/lucide/bug';
	import IconOctagonAlert from '~icons/lucide/octagon-alert';

	// Open-vocabulary kind → glyph. Unknown kinds fall back to a neutral dot,
	// so a server that grows a new kind still renders sensibly without a web
	// change (the message text carries the meaning regardless).
	function iconFor(kind: string): Component {
		switch (kind) {
			case 'boot':
				return IconPower;
			case 'server_started':
				return IconRocket;
			case 'oom_kill':
				return IconSkull;
			case 'smart_health':
				return IconHardDrive;
			case 'app_crash':
				return IconBug;
			case 'disk_error':
				return IconOctagonAlert;
			case 'service_action':
				return IconActivity;
			case 'container_action':
				return IconContainer;
			case 'process_killed':
				return IconSquareX;
			case 'alert_fired':
				return IconFlame;
			case 'alert_resolved':
				return IconCircleCheck;
			case 'alert_silenced':
				return IconBellOff;
			case 'alert_unsilenced':
				return IconBell;
			case 'incident_captured':
				return IconCamera;
			case 'config_changed':
				return IconSlidersHorizontal;
			case 'probes_reloaded':
				return IconStethoscope;
			case 'device_paired':
			case 'device_revoked':
				return IconSmartphone;
			default:
				return IconCircleDot;
		}
	}

	// Severity is the normalized colour axis across every source.
	function toneClass(sev: EventSeverity): string {
		switch (sev) {
			case 'error':
				return 'text-[var(--color-danger)]';
			case 'warn':
				return 'text-[var(--color-warning)]';
			default:
				return 'text-[var(--color-fg-subtle)]';
		}
	}

	function dotClass(sev: EventSeverity): string {
		switch (sev) {
			case 'error':
				return 'bg-[var(--color-danger)]';
			case 'warn':
				return 'bg-[var(--color-warning)]';
			default:
				return 'bg-[var(--color-fg-faint)]';
		}
	}
</script>

<script lang="ts">
	import { fmtRelative } from '$lib/utils/format';
	import { cn } from '$lib/utils/cn';
	import { m } from '$lib/paraglide/messages';
	import IconArrowUpRight from '~icons/lucide/arrow-up-right';

	interface Props {
		event: EventDto;
		now?: number;
		/** When set, refs that map to a page render as links. */
		serverId?: string;
		class?: string;
	}

	let { event, now = Date.now(), serverId, class: klass = '' }: Props = $props();

	let Icon = $derived(iconFor(event.kind));

	// Only refs that have a destination page today become links. Alert rules
	// go to the alerts view; incident snapshots have no detail page yet, so
	// they stay non-clickable rather than dead-link.
	let refHref = $derived.by(() => {
		if (!serverId || !event.ref) return null;
		if (event.ref.type === 'alert_rule') return `/servers/${serverId}/alerts?tab=events`;
		return null;
	});
	let refLabel = $derived(event.ref?.type === 'alert_rule' ? m.events_ref_alert() : null);
</script>

<li
	class={cn(
		'relative flex items-baseline gap-2.5 border-l border-[var(--color-border)] py-1.5 pl-4',
		klass
	)}
>
	<span
		class={cn(
			'absolute top-[0.85rem] -left-[3.5px] size-[7px] -translate-y-1/2 rounded-full',
			dotClass(event.severity)
		)}
	></span>

	<Icon
		class={cn('size-[14px] shrink-0 translate-y-0.5', toneClass(event.severity))}
		stroke-width="2"
	/>

	<span class="min-w-0 flex-1 text-[12.5px] leading-snug text-[var(--color-fg)]">
		{event.message}
		{#if event.source === 'operator' && event.actor?.name}
			<span class="text-[var(--color-fg-subtle)]"
				>· {m.events_actor_by({ name: event.actor.name })}</span
			>
		{/if}
		{#if refHref && refLabel}
			<a
				href={refHref}
				class="group ml-1 inline-flex items-center gap-0.5 text-[11px] text-[var(--color-accent)] hover:underline"
			>
				{refLabel}
				<IconArrowUpRight class="size-3 transition-transform group-hover:translate-x-0.5" />
			</a>
		{/if}
	</span>

	<span class="shrink-0 font-mono text-[10.5px] text-[var(--color-fg-faint)] tabular-nums">
		{fmtRelative(event.ts, now)}
	</span>
</li>
