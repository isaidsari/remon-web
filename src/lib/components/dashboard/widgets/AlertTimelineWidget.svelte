<script lang="ts">
	import Card from '$lib/components/ui/Card.svelte';
	import Skeleton from '$lib/components/ui/Skeleton.svelte';
	import EventRow from '$lib/components/events/EventRow.svelte';
	import type { Connection } from '$lib/stores/connections.svelte';
	import type { EventDto, IncidentSummaryDto } from '$lib/types/api';
	import { m } from '$lib/paraglide/messages';
	import IconArrowRight from '~icons/lucide/arrow-right';

	interface Props {
		conn: Connection | null;
	}

	let { conn }: Props = $props();

	const LIMIT = 15;
	let events = $state<EventDto[] | null>(null);

	/** An incident as a timeline row; open ones read as errors until they close. */
	function incidentRow(i: IncidentSummaryDto): EventDto {
		return {
			ts: i.opened_at,
			source: 'system',
			kind: 'incident',
			severity: i.closed_at == null ? 'error' : 'info',
			message: i.rule_name ?? i.reason ?? m.incident_title(),
			ref: { type: 'incident', id: String(i.id) }
		};
	}

	// Alerts, operator actions and incidents in one list, newest first. The
	// event feed already logs a manual capture, so those incidents are skipped.
	async function fetchData() {
		if (!conn?.isAuthenticated) return;
		try {
			const [ev, inc] = await Promise.all([
				conn.client.events({ limit: LIMIT }),
				conn.client.listIncidents(10).catch(() => ({ incidents: [] }))
			]);
			const seen = new Set(
				ev.events.filter((e) => e.ref?.type === 'incident').map((e) => e.ref!.id)
			);
			const rows = inc.incidents.filter((i) => !seen.has(String(i.id))).map(incidentRow);
			events = [...ev.events, ...rows].sort((a, b) => b.ts - a.ts).slice(0, LIMIT);
		} catch {
			// keep the stale feed on a transient failure
		}
	}

	$effect(() => {
		if (!conn?.isAuthenticated) return;
		void fetchData();
		const t = setInterval(fetchData, 30_000);
		return () => clearInterval(t);
	});

	// Re-render relative timestamps once a minute.
	let now = $state(Date.now());
	$effect(() => {
		const t = setInterval(() => (now = Date.now()), 60_000);
		return () => clearInterval(t);
	});
</script>

<Card class="flex h-full flex-col overflow-hidden" padding="none">
	<div class="flex items-center gap-2 px-4 pt-3.5 pb-1">
		<h2 class="flex-1 text-sm font-semibold text-[var(--color-fg)]">{m.overview_events_title()}</h2>
		<a
			href={conn ? `/servers/${conn.serverId}/events` : '#'}
			class="group text-2xs inline-flex items-center gap-1 text-[var(--color-fg-subtle)] transition-colors hover:text-[var(--color-fg)]"
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
			{#each events as ev, i (ev.ts + '-' + ev.kind + '-' + i)}
				<EventRow event={ev} {now} serverId={conn?.serverId} />
			{/each}
		</ol>
	{/if}
</Card>
