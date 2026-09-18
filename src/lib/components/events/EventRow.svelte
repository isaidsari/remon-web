<script lang="ts">
	import type { EventDto, EventSeverity } from '$lib/types/api';
	import { fmtRelative } from '$lib/utils/format';
	import { cn } from '$lib/utils/cn';
	import { m } from '$lib/paraglide/messages';

	interface Props {
		event: EventDto;
		now?: number;
		/** When set, refs that map to a page render as links. */
		serverId?: string;
		class?: string;
	}

	let { event, now = Date.now(), serverId, class: klass = '' }: Props = $props();

	// Severity is the one colour on the row; the message carries the meaning.
	const bar: Record<EventSeverity, string> = {
		error: 'bg-[var(--color-danger)]',
		warn: 'bg-[var(--color-warning)]',
		info: 'bg-[var(--color-fg-faint)]'
	};

	// Only refs with a destination page become links.
	let refHref = $derived.by(() => {
		if (!serverId || !event.ref) return null;
		if (event.ref.type === 'alert_rule') return `/servers/${serverId}/alerts?tab=events`;
		if (event.ref.type === 'incident') return `/servers/${serverId}/incidents/${event.ref.id}`;
		return null;
	});
	let refLabel = $derived(
		event.ref?.type === 'alert_rule'
			? m.events_ref_alert()
			: event.ref?.type === 'incident'
				? m.events_ref_incident()
				: null
	);
	let actor = $derived(event.source === 'operator' ? event.actor?.name : undefined);
</script>

<li
	class={cn(
		'grid grid-cols-[3px_1fr_auto] items-center gap-3 py-2.5 [&:not(:first-child)]:border-t [&:not(:first-child)]:border-[var(--color-border)]',
		klass
	)}
>
	<span class={cn('h-8 w-[3px] rounded-full', bar[event.severity])} aria-hidden="true"></span>
	<span class="min-w-0">
		<span class="text-md block leading-snug font-medium break-words text-[var(--color-fg)]">
			{event.message}
		</span>
		{#if actor || refHref}
			<span class="text-2xs mt-0.5 flex flex-wrap gap-x-2 font-mono text-[var(--color-fg-subtle)]">
				{#if actor}<span>{m.events_actor_by({ name: actor })}</span>{/if}
				{#if refHref && refLabel}
					<a href={refHref} class="text-[var(--color-accent)] hover:underline">{refLabel} →</a>
				{/if}
			</span>
		{/if}
	</span>
	<span class="text-2xs shrink-0 font-mono text-[var(--color-fg-faint)] tabular-nums">
		{fmtRelative(event.ts, now)}
	</span>
</li>
