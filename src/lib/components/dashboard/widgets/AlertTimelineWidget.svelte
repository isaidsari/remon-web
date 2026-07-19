<script lang="ts">
	import Card from '$lib/components/ui/Card.svelte';
	import Skeleton from '$lib/components/ui/Skeleton.svelte';
	import EventRow from '$lib/components/events/EventRow.svelte';
	import type { Connection } from '$lib/stores/connections.svelte';
	import type { EventDto } from '$lib/types/api';
	import { m } from '$lib/paraglide/messages';
	import IconHistory from '~icons/lucide/history';
	import IconArrowRight from '~icons/lucide/arrow-right';

	interface Props {
		conn: Connection | null;
	}

	let { conn }: Props = $props();

	let events = $state<EventDto[] | null>(null);

	// The union timeline already carries human messages + severity, so the
	// widget no longer resolves rule names itself — one call, not two.
	async function fetchData() {
		if (!conn?.isAuthenticated) return;
		try {
			const res = await conn.client.events({ limit: 15 });
			events = res.events;
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
	<div class="flex items-center gap-2 px-4 pt-3.5 pb-2.5">
		<IconHistory class="size-[15px] shrink-0 text-[var(--color-fg-subtle)]" stroke-width="2" />
		<h2 class="flex-1 text-sm font-medium text-[var(--color-fg)]">{m.overview_events_title()}</h2>
		<a
			href={conn ? `/servers/${conn.serverId}/events` : '#'}
			class="group inline-flex items-center gap-1 text-[11px] text-[var(--color-fg-subtle)] transition-colors hover:text-[var(--color-fg)]"
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
			<p class="mt-2 text-[12.5px] text-[var(--color-fg-muted)]">{m.overview_events_empty()}</p>
		</div>
	{:else}
		<!-- Timeline: hairline rail on the left, one row per host event. -->
		<ol class="min-h-0 flex-1 overflow-y-auto px-4 pb-3">
			{#each events as ev, i (ev.ts + '-' + ev.kind + '-' + i)}
				<EventRow event={ev} {now} serverId={conn?.serverId} />
			{/each}
		</ol>
	{/if}
</Card>
