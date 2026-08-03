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
	import { m } from '$lib/paraglide/messages';
	import type { EventDto, EventSource } from '$lib/types/api';

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

	let events = $state<EventDto[] | null>(null);
	let busy = $state(false);
	let loadingMore = $state(false);
	let loadFailed = $state(false);
	/** `next_cursor` from the newest page; absent once the range is exhausted. */
	let nextCursor = $state<string | undefined>(undefined);
	/** True once the operator has paged past the first screenful. */
	let paged = $state(false);
	/** The window page 1 was read from. Later pages reuse it so a clock that
	 *  moved between clicks can't shift the range under the cursor. */
	let windowStart = 0;
	let windowEnd = 0;
	/** Bumped by every page-1 load. A request that outlives its filters must
	 *  not land: an in-flight `load more` would otherwise append rows from a
	 *  range the operator has already navigated away from. */
	let generation = 0;

	/** `background` = the 30s poll: it must not put the Refresh button into a
	 *  loading state, or the page appears to refresh itself every half minute. */
	async function fetchData(background = false) {
		if (!conn?.isAuthenticated) return;
		if (!background) busy = true;
		const gen = ++generation;
		const now = Math.floor(Date.now() / 1000);
		const start = now - RANGE_SECS[range];
		try {
			const res = await conn.client.events({
				start,
				end: now,
				sources: source === 'all' ? undefined : source,
				limit: PAGE_SIZE
			});
			if (gen !== generation) return;
			events = res.events;
			nextCursor = res.next_cursor;
			windowStart = start;
			windowEnd = now;
			paged = false;
			loadFailed = false;
		} catch {
			// Keep the stale list on a transient failure; flag it for the banner.
			loadFailed = true;
		} finally {
			if (!background) busy = false;
		}
	}

	/** Append the next keyset page. Without this the view stops at the first
	 *  page and says nothing about the events behind it. */
	async function loadMore() {
		if (!conn?.isAuthenticated || loadingMore || !nextCursor) return;
		loadingMore = true;
		const gen = generation;
		try {
			const res = await conn.client.events({
				start: windowStart,
				end: windowEnd,
				sources: source === 'all' ? undefined : source,
				limit: PAGE_SIZE,
				cursor: nextCursor
			});
			if (gen !== generation) return;
			events = [...(events ?? []), ...res.events];
			nextCursor = res.next_cursor;
			paged = true;
			loadFailed = false;
		} catch {
			loadFailed = true;
		} finally {
			loadingMore = false;
		}
	}

	// Refetch when the filters or auth change; poll every 30s while mounted.
	$effect(() => {
		void source;
		void range;
		if (!conn?.isAuthenticated) return;
		void fetchData();
		const t = setInterval(() => {
			// A background refresh replaces the list with page 1. While the
			// operator is reading further down the timeline that would pull the
			// pages they just loaded out from under them, so the poll stands
			// down until they refresh by hand.
			if (!paged) void fetchData(true);
		}, 30_000);
		return () => clearInterval(t);
	});

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
		<!-- Wrapped, not passed by reference: the click event would land in `background`. -->
		<Button variant="secondary" size="sm" onclick={() => fetchData()} loading={busy}>
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
				{#if nextCursor}
					<div class="border-t border-[var(--color-border)] px-4 py-3 text-center">
						<Button variant="ghost" size="sm" onclick={loadMore} loading={loadingMore}>
							{m.events_load_more()}
						</Button>
					</div>
				{/if}
			{/if}
		</Card>
	{/if}
</div>
