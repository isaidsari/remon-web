<script lang="ts">
	import { untrack } from 'svelte';
	import { page } from '$app/state';
	import Card from '$lib/components/ui/Card.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Banner from '$lib/components/ui/Banner.svelte';
	import Skeleton from '$lib/components/ui/Skeleton.svelte';
	import SegmentedControl, { type SegmentOption } from '$lib/components/ui/SegmentedControl.svelte';
	import EventRow from '$lib/components/events/EventRow.svelte';
	import { profiles } from '$lib/stores/profiles.svelte';
	import { connections } from '$lib/stores/connections.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { ApiError } from '$lib/api/error';
	import { serverKey } from '$lib/api/query';
	import { createInfiniteQuery, type InfiniteData } from '@tanstack/svelte-query';
	import { m } from '$lib/paraglide/messages';
	import type { EventDto, EventSource, ListEventsResponse } from '$lib/types/api';

	let id = $derived(page.params.id ?? '');
	let profile = $derived(id ? profiles.byId(id) : undefined);
	let conn = $derived(profile ? connections.connect(profile) : null);

	$effect(() => {
		if (!conn) return;
		untrack(() => {
			conn.ensureSignedIn().catch((e) => {
				if (e instanceof ApiError)
					toast.error(m.events_load_failed(), { description: e.userMessage });
			});
		});
	});

	type SourceFilter = 'all' | EventSource;
	type RangeKey = '1h' | '24h' | '7d' | '30d';
	const RANGE_SECS: Record<RangeKey, number> = {
		'1h': 3600,
		'24h': 86_400,
		'7d': 604_800,
		'30d': 2_592_000
	};

	let source = $state<SourceFilter>('all');
	let range = $state<RangeKey>('24h');

	/** One screenful. The server caps a page at 1000 and hands back a cursor
	 *  whenever a full one came back, so a large page just delays the first
	 *  paint — it never removes the need to follow the cursor. */
	const PAGE_SIZE = 200;

	const query = createInfiniteQuery<ListEventsResponse, ApiError, InfiniteData<ListEventsResponse>>(
		() => ({
			queryKey: serverKey(id, 'events', source, range),
			enabled: !!conn?.isAuthenticated,
			initialPageParam: undefined,
			getNextPageParam: (last: ListEventsResponse) => last.next_cursor,
			// The window is read per fetch rather than frozen at page 1: that is
			// what lets the poll below surface events that happened since. Only
			// page 1 is bounded by `end` — every later page is bounded by its
			// cursor, so a clock that moved between pages cannot skip a row.
			queryFn: async ({ pageParam, signal }) => {
				const now = Math.floor(Date.now() / 1000);
				return conn!.client.events(
					{
						start: now - RANGE_SECS[range],
						end: now,
						sources: source === 'all' ? undefined : source,
						limit: PAGE_SIZE,
						cursor: pageParam as string | undefined
					},
					{ signal }
				);
			},
			// A poll refetches every loaded page. While the operator is reading
			// further down the timeline that is both wasteful and disruptive, so
			// paging past the first screenful stands the poll down until they
			// refresh by hand.
			refetchInterval: (q) => ((q.state.data?.pages.length ?? 1) > 1 ? false : 30_000)
		})
	);

	/** Flattened for rendering; `null` until the first page lands. */
	let events = $derived<EventDto[] | null>(
		query.data ? query.data.pages.flatMap((p) => p.events) : null
	);
	/** A failed background refetch keeps the last good pages on screen — the
	 *  banner is what says they are no longer current. */
	let loadFailed = $derived(query.isError);

	// Only an explicit refresh spins the button; the 30s poll must not, or the
	// page appears to refresh itself every half minute.
	let busy = $state(false);
	async function refresh() {
		busy = true;
		try {
			await query.refetch();
		} finally {
			busy = false;
		}
	}

	// Re-render relative timestamps once a minute.
	let nowMs = $state(Date.now());
	$effect(() => {
		const t = setInterval(() => (nowMs = Date.now()), 60_000);
		return () => clearInterval(t);
	});

	const sourceOpts: SegmentOption<SourceFilter>[] = [
		{ value: 'all', label: m.events_source_all() },
		{ value: 'system', label: m.events_source_system() },
		{ value: 'operator', label: m.events_source_operator() },
		{ value: 'agent', label: m.events_source_agent() }
	];
	const rangeOpts: SegmentOption<RangeKey>[] = [
		{ value: '1h', label: m.events_range_1h() },
		{ value: '24h', label: m.events_range_24h() },
		{ value: '7d', label: m.events_range_7d() },
		{ value: '30d', label: m.events_range_30d() }
	];
</script>

<div class="px-4 py-6 md:px-8 md:py-8">
	<header class="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
		<div>
			<h1 class="text-[24px] font-semibold tracking-tight">{m.events_title()}</h1>
			<p class="mt-1.5 text-sm text-[var(--color-fg-muted)]">{m.events_subtitle()}</p>
		</div>
		<Button variant="secondary" size="sm" onclick={refresh} loading={busy}>
			{m.alerts_action_refresh()}
		</Button>
	</header>

	{#if !conn?.isAuthenticated}
		<Banner variant="warning" title={m.alerts_banner_not_signed_in_title()}>
			{m.alerts_banner_not_signed_in_body()}
		</Banner>
	{:else}
		<div class="mb-4 flex flex-wrap items-center gap-2">
			<SegmentedControl
				value={source}
				options={sourceOpts}
				onSelect={(v) => (source = v)}
				ariaLabel={m.events_source_all()}
			/>
			<SegmentedControl
				value={range}
				options={rangeOpts}
				onSelect={(v) => (range = v)}
				ariaLabel={m.events_range_24h()}
			/>
			{#if events && events.length > 0}
				<span class="ml-auto text-[11px] text-[var(--color-fg-subtle)] tabular-nums">
					{m.events_count({ count: events.length })}
				</span>
			{/if}
		</div>

		{#if loadFailed}
			{#if events === null}
				<Banner variant="danger" title={m.events_load_failed()} class="mb-4" />
			{:else}
				<!-- A list is on screen but no longer current — say so, otherwise
				     the poll fails silently and stale rows read as live. -->
				<Banner variant="warning" title={m.events_refresh_failed()} class="mb-4" />
			{/if}
		{/if}

		<Card padding="none" class="overflow-hidden">
			{#if events === null}
				<div class="space-y-2 p-4">
					<Skeleton class="h-4 w-full" />
					<Skeleton class="h-4 w-4/5" />
					<Skeleton class="h-4 w-5/6" />
					<Skeleton class="h-4 w-2/3" />
				</div>
			{:else if events.length === 0}
				<div class="flex flex-col items-center justify-center gap-2 px-4 py-14 text-center">
					<span class="inline-flex size-2 rounded-full bg-[var(--color-success)]"></span>
					<p class="text-[13px] text-[var(--color-fg-muted)]">{m.events_empty()}</p>
				</div>
			{:else}
				<ol class="px-4 py-3">
					{#each events as ev, i (ev.ts + '-' + ev.kind + '-' + i)}
						<EventRow event={ev} now={nowMs} serverId={id} />
					{/each}
				</ol>
				{#if query.hasNextPage}
					<div class="border-t border-[var(--color-border)] px-4 py-3 text-center">
						<Button
							variant="ghost"
							size="sm"
							onclick={() => query.fetchNextPage()}
							loading={query.isFetchingNextPage}
						>
							{m.events_load_more()}
						</Button>
					</div>
				{/if}
			{/if}
		</Card>
	{/if}
</div>
