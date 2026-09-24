<script lang="ts">
	import Card from '$lib/components/ui/Card.svelte';
	import Skeleton from '$lib/components/ui/Skeleton.svelte';
	import EventRow from '$lib/components/events/EventRow.svelte';
	import IncidentTimelineRow from './IncidentTimelineRow.svelte';
	import type { Connection } from '$lib/stores/connections.svelte';
	import type { EventDto, IncidentSummaryDto } from '$lib/types/api';
	import { m } from '$lib/paraglide/messages';
	import IconArrowRight from '~icons/lucide/arrow-right';
	import { tabVisible } from '$lib/utils/visibility.svelte';

	interface Props {
		conn: Connection | null;
	}

	let { conn }: Props = $props();

	const LIMIT = 15;
	type TimelineEntry = { ts: number; key: string } & (
		{ event: EventDto; incident?: never } | { incident: IncidentSummaryDto; event?: never }
	);
	let events = $state<TimelineEntry[] | null>(null);
	let narrow = $state(false);
	let preview = $derived(events?.slice(0, narrow ? 3 : 5));
	$effect(() => {
		const media = window.matchMedia('(max-width: 767px)');
		const update = () => (narrow = media.matches);
		update();
		media.addEventListener('change', update);
		return () => media.removeEventListener('change', update);
	});

	// Alerts, operator actions and incidents in one list, newest first. The
	// event feed already logs a manual capture, so those incidents are skipped.
	async function fetchData(connection: Connection, isCurrent: () => boolean) {
		try {
			const [ev, inc] = await Promise.all([
				connection.client.events({ limit: LIMIT }),
				connection.client.listIncidents(10).catch(() => ({ incidents: [] }))
			]);
			if (!isCurrent()) return;
			const seen = new Set(
				ev.events.filter((e) => e.ref?.type === 'incident').map((e) => e.ref!.id)
			);
			const rows: TimelineEntry[] = inc.incidents
				.filter((i) => !seen.has(String(i.id)))
				.map((incident) => ({ ts: incident.opened_at, key: `incident-${incident.id}`, incident }));
			events = [
				...ev.events.map((event, index) => ({
					ts: event.ts,
					key: `event-${event.ts}-${index}`,
					event
				})),
				...rows
			]
				.sort((a, b) => b.ts - a.ts)
				.slice(0, LIMIT);
		} catch {
			// keep the stale feed on a transient failure
		}
	}

	$effect(() => {
		if (!conn?.isAuthenticated || !tabVisible()) return;
		const connection = conn;
		let current = true;
		let pending = false;
		const refresh = async () => {
			if (pending) return;
			pending = true;
			await fetchData(connection, () => current);
			pending = false;
		};
		void refresh();
		const t = setInterval(refresh, 30_000);
		return () => {
			current = false;
			clearInterval(t);
		};
	});

	// Re-render relative timestamps once a minute.
	let now = $state(Date.now());
	$effect(() => {
		if (!tabVisible()) return;
		now = Date.now();
		const t = setInterval(() => (now = Date.now()), 60_000);
		return () => clearInterval(t);
	});
</script>

<Card class="flex h-full flex-col overflow-hidden" padding="none">
	<div class="flex items-center gap-2 px-4 pt-3.5 pb-1">
		<h2 class="flex-1 text-sm font-semibold text-[var(--color-fg)]">{m.overview_events_title()}</h2>
		<a
			href={conn ? `/servers/${conn.serverId}/events` : '#'}
			class="group -mr-2 inline-flex min-h-11 items-center gap-1 rounded-md px-2 text-xs text-[var(--color-fg-subtle)] transition-colors hover:text-[var(--color-fg)] focus-visible:outline-2 focus-visible:outline-[var(--color-accent)]"
		>
			{m.overview_events_all()}
			<IconArrowRight
				class="size-3 transition-transform duration-[var(--dur-fast)] group-hover:translate-x-0.5"
			/>
		</a>
	</div>

	{#if events === null}
		<div class="space-y-2 px-4 pb-4">
			<Skeleton class="h-4 w-full" />
			<Skeleton class="h-4 w-3/4" />
			<Skeleton class="h-4 w-5/6" />
		</div>
	{:else if events.length === 0}
		<div class="flex flex-1 flex-col items-center justify-center gap-1 px-4 pb-6 text-center">
			<span class="relative inline-flex size-2 rounded-full bg-[var(--color-success)]"></span>
			<p class="mt-2 text-xs text-[var(--color-fg-muted)]">{m.overview_events_empty()}</p>
		</div>
	{:else}
		<ol class="min-h-0 flex-1 overflow-y-auto px-4 pb-2">
			{#each preview ?? [] as entry (entry.key)}
				{#if entry.incident}
					<IncidentTimelineRow incident={entry.incident} {now} serverId={conn?.serverId} />
				{:else}
					<EventRow event={entry.event} {now} serverId={conn?.serverId} compact />
				{/if}
			{/each}
		</ol>
	{/if}
</Card>
