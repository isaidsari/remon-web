<script lang="ts">
	import Card from '$lib/components/ui/Card.svelte';
	import Skeleton from '$lib/components/ui/Skeleton.svelte';
	import EventRow from '$lib/components/events/EventRow.svelte';
	import type { Connection } from '$lib/stores/connections.svelte';
	import type { EventDto } from '$lib/types/api';
	import { RANGE_SECONDS } from '$lib/components/charts/range';
	import type { Span } from '$lib/screen/plan';
	import { m } from '$lib/paraglide/messages';
	import PanelError from './PanelError.svelte';

	interface Props {
		title: string;
		kinds?: string[];
		sources?: string[];
		span: Span;
		label: string;
		conn: Connection;
	}

	let { title, kinds, sources, span, label, conn }: Props = $props();

	let events = $state<EventDto[] | null>(null);
	let error = $state<string | null>(null);
	let requestId = 0;

	async function load() {
		const id = ++requestId;
		const now = Math.floor(Date.now() / 1000);
		const [start, end] =
			'window' in span
				? [span.window.start, span.window.end]
				: [now - RANGE_SECONDS[span.range], now];
		try {
			const res = await conn.client.events({
				start,
				end,
				kinds: kinds?.join(','),
				sources: sources?.join(','),
				limit: 200
			});
			if (id === requestId) {
				events = res.events;
				error = null;
			}
		} catch (e) {
			if (id === requestId) error = e instanceof Error ? e.message : String(e);
		}
	}

	$effect(() => {
		void JSON.stringify([span, kinds, sources]);
		if (!conn.isAuthenticated) return;
		events = null;
		void load();
		// A fixed window is history and does not change; "last N" keeps moving.
		if ('window' in span) return () => ++requestId;
		const timer = setInterval(load, 60_000);
		return () => {
			++requestId;
			clearInterval(timer);
		};
	});
</script>

<Card class="flex h-full flex-col" padding="sm">
	<div class="mb-2 flex items-baseline justify-between gap-2">
		<h2 class="truncate text-sm font-medium text-[var(--color-fg)]">{title}</h2>
		<span class="text-3xs shrink-0 font-mono text-[var(--color-fg-subtle)]">{label}</span>
	</div>
	{#if error}
		<PanelError {error} />
	{:else if !events}
		<Skeleton class="h-24 w-full" rounded="lg" />
	{:else if events.length === 0}
		<p class="text-2xs py-6 text-center text-[var(--color-fg-subtle)]">{m.screen_no_events()}</p>
	{:else}
		<ol class="max-h-80 min-h-0 overflow-y-auto">
			{#each events as event, i (i)}
				<EventRow {event} serverId={conn.serverId} compact />
			{/each}
		</ol>
	{/if}
</Card>
