<script lang="ts">
	import { untrack } from 'svelte';
	import { page } from '$app/state';
	import Card from '$lib/components/ui/Card.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Banner from '$lib/components/ui/Banner.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Skeleton from '$lib/components/ui/Skeleton.svelte';
	import SegmentedControl, { type SegmentOption } from '$lib/components/ui/SegmentedControl.svelte';
	import { profiles } from '$lib/stores/profiles.svelte';
	import { connections } from '$lib/stores/connections.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { ApiError } from '$lib/api/error';
	import { cn } from '$lib/utils/cn';
	import { m } from '$lib/paraglide/messages';
	import type { LogEntry, LogLevel } from '$lib/types/api';

	let id = $derived(page.params.id ?? '');
	let profile = $derived(id ? profiles.byId(id) : undefined);
	let conn = $derived(profile ? connections.connect(profile) : null);

	$effect(() => {
		if (!conn) return;
		untrack(() => {
			conn.ensureSignedIn().catch((e) => {
				if (e instanceof ApiError)
					toast.error(m.logs_load_failed(), { description: e.userMessage });
			});
		});
	});

	type RangeKey = '1h' | '24h' | '7d' | '30d';
	const RANGE_SECS: Record<RangeKey, number> = {
		'1h': 3600,
		'24h': 86_400,
		'7d': 604_800,
		'30d': 2_592_000
	};

	/** No cursor on this endpoint; a full page is the only "there is more" signal. */
	const LIMIT = 1000;

	let level = $state<LogLevel>('info');
	let range = $state<RangeKey>('24h');
	let filter = $state('');

	let entries = $state<LogEntry[] | null>(null);
	let busy = $state(false);
	let loadFailed = $state(false);
	/** Drops a poll that started under the old filter. */
	let generation = 0;

	/** `background` = the 30s poll; it must not spin the Refresh button. */
	async function fetchData(background = false) {
		if (!conn?.isAuthenticated) return;
		if (!background) busy = true;
		const gen = ++generation;
		const now = Math.floor(Date.now() / 1000);
		try {
			// `level` is a floor: `warn` returns warn and error.
			const res = await conn.client.logs({
				start: now - RANGE_SECS[range],
				end: now,
				level,
				limit: LIMIT
			});
			if (gen !== generation) return;
			entries = res.entries;
			loadFailed = false;
		} catch {
			// Keep the stale list on a transient failure; flag it for the banner.
			loadFailed = true;
		} finally {
			if (!background) busy = false;
		}
	}

	// Refetch when the filters or auth change; poll every 30s while mounted.
	$effect(() => {
		void level;
		void range;
		if (!conn?.isAuthenticated) return;
		void fetchData();
		const t = setInterval(() => void fetchData(true), 30_000);
		return () => clearInterval(t);
	});

	// No server-side search: this narrows what was fetched, and the count says so.
	let shown = $derived.by(() => {
		const list = entries ?? [];
		const needle = filter.trim().toLowerCase();
		if (!needle) return list;
		return list.filter(
			(e) => e.message.toLowerCase().includes(needle) || e.target.toLowerCase().includes(needle)
		);
	});

	/** A full page means older entries were cut off. */
	let truncated = $derived((entries?.length ?? 0) >= LIMIT);

	const levelOpts: SegmentOption<LogLevel>[] = [
		{ value: 'error', label: m.logs_level_error() },
		{ value: 'warn', label: m.logs_level_warn() },
		{ value: 'info', label: m.logs_level_info() },
		{ value: 'debug', label: m.logs_level_debug() },
		{ value: 'trace', label: m.logs_level_trace() }
	];
	const rangeOpts: SegmentOption<RangeKey>[] = [
		{ value: '1h', label: m.events_range_1h() },
		{ value: '24h', label: m.events_range_24h() },
		{ value: '7d', label: m.events_range_7d() },
		{ value: '30d', label: m.events_range_30d() }
	];

	function levelTone(l: LogLevel): string {
		switch (l) {
			case 'error':
				return 'text-[var(--color-danger)]';
			case 'warn':
				return 'text-[var(--color-warning)]';
			case 'info':
				return 'text-[var(--color-fg-muted)]';
			default:
				return 'text-[var(--color-fg-faint)]';
		}
	}
</script>

<div class="px-4 py-6 md:px-8 md:py-8">
	<header class="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
		<div>
			<h1 class="text-[24px] font-semibold tracking-tight">{m.logs_title()}</h1>
			<p class="mt-1.5 text-sm text-[var(--color-fg-muted)]">{m.logs_subtitle()}</p>
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
				value={level}
				options={levelOpts}
				onSelect={(v) => (level = v)}
				ariaLabel={m.logs_level_aria()}
			/>
			<SegmentedControl
				value={range}
				options={rangeOpts}
				onSelect={(v) => (range = v)}
				ariaLabel={m.events_range_24h()}
			/>
			<Input
				bind:value={filter}
				placeholder={m.logs_filter_placeholder()}
				class="h-8 w-full sm:w-56"
				aria-label={m.logs_filter_placeholder()}
			/>
			{#if entries && entries.length > 0}
				<span class="ml-auto text-[11px] text-[var(--color-fg-subtle)] tabular-nums">
					{filter.trim()
						? m.logs_count_filtered({ shown: shown.length, total: entries.length })
						: m.logs_count({ count: entries.length })}
				</span>
			{/if}
		</div>

		{#if loadFailed}
			{#if entries === null}
				<Banner variant="danger" title={m.logs_load_failed()} class="mb-4" />
			{:else}
				<!-- A list is on screen but no longer current — say so, otherwise
				     the poll fails silently and stale rows read as live. -->
				<Banner variant="warning" title={m.logs_refresh_failed()} class="mb-4" />
			{/if}
		{/if}

		{#if truncated}
			<Banner variant="info" title={m.logs_truncated({ count: LIMIT })} class="mb-4" />
		{/if}

		<Card padding="none" class="overflow-hidden">
			{#if entries === null}
				<div class="space-y-2 p-4">
					<Skeleton class="h-4 w-full" />
					<Skeleton class="h-4 w-4/5" />
					<Skeleton class="h-4 w-5/6" />
					<Skeleton class="h-4 w-2/3" />
				</div>
			{:else if shown.length === 0}
				<div class="flex flex-col items-center justify-center gap-2 px-4 py-14 text-center">
					<span class="inline-flex size-2 rounded-full bg-[var(--color-success)]"></span>
					<p class="text-[13px] text-[var(--color-fg-muted)]">
						{entries.length === 0 ? m.logs_empty() : m.logs_empty_filtered()}
					</p>
				</div>
			{:else}
				<!-- Long messages (panics, stack-ish payloads) would otherwise widen
				     the page; the list scrolls on its own axis instead. -->
				<div class="overflow-x-auto">
					<ol class="min-w-max divide-y divide-[var(--color-border)]/60">
						{#each shown as e (e.id)}
							<li class="flex items-baseline gap-3 px-4 py-1.5 font-mono text-[12px] leading-snug">
								<span
									class="shrink-0 text-[10.5px] text-[var(--color-fg-faint)] tabular-nums"
									title={new Date(e.timestamp * 1000).toLocaleString()}
								>
									{new Date(e.timestamp * 1000).toLocaleTimeString()}
								</span>
								<span
									class={cn('w-[3.25rem] shrink-0 text-[10.5px] uppercase', levelTone(e.level))}
								>
									{e.level}
								</span>
								<span class="shrink-0 text-[10.5px] text-[var(--color-fg-subtle)]">{e.target}</span>
								<span class="text-[var(--color-fg)]">{e.message}</span>
							</li>
						{/each}
					</ol>
				</div>
			{/if}
		</Card>
	{/if}
</div>
