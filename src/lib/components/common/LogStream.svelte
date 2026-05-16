<script lang="ts">
	import { untrack } from 'svelte';
	import { openSseStream, type SseSubscription } from '$lib/api/sse';
	import Button from '$lib/components/ui/Button.svelte';
	import Banner from '$lib/components/ui/Banner.svelte';
	import { cn } from '$lib/utils/cn';
	import type { Connection } from '$lib/stores/connections.svelte';
	import { m } from '$lib/paraglide/messages';

	interface Props {
		conn: Connection;
		/** Path without `/sse` prefix (added by client). e.g. `/docker/containers/{id}/logs/stream`. */
		path: string;
		initialTail?: number;
		maxLines?: number;
		class?: string;
	}

	let {
		conn,
		path,
		initialTail = 200,
		maxLines = 5000,
		class: klass = ''
	}: Props = $props();

	type Line = { kind: 'log' | 'error'; text: string; ts: number };

	let lines = $state<Line[]>([]);
	let live = $state(true);
	let autoScroll = $state(true);
	// Tail is locally mutable; the prop only seeds the initial value.
	let tail = $state(untrack(() => initialTail));
	let status = $state<'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed'>('idle');
	let lastError = $state<string | null>(null);
	let pendingSince = $state<number>(0);
	let now = $state<number>(Date.now());
	let scroller: HTMLDivElement | null = $state(null);

	let sub: SseSubscription | null = null;

	function pushLine(text: string, kind: 'log' | 'error' = 'log') {
		lines.push({ kind, text, ts: Date.now() });
		if (lines.length > maxLines) lines.splice(0, lines.length - maxLines);
		if (autoScroll) {
			queueMicrotask(scrollToBottom);
		}
	}

	function scrollToBottom() {
		if (scroller) scroller.scrollTop = scroller.scrollHeight;
	}

	function open() {
		if (sub) return;
		const url = `${conn.client.sseUrl(path)}?tail=${tail}`;
		status = 'connecting';
		pendingSince = Date.now();
		lastError = null;
		sub = openSseStream({
			url,
			getAccessToken: () => conn.accessToken,
			handlers: {
				onOpen: () => {
					status = 'open';
					pendingSince = 0;
					lastError = null;
				},
				onMessage: (data, event) => {
					if (event === 'error') pushLine(data, 'error');
					else pushLine(data, 'log');
				},
				onError: (err) => {
					if (status !== 'reconnecting') pendingSince = Date.now();
					status = 'reconnecting';
					lastError = err instanceof Error ? err.message : String(err);
				},
				onClose: () => {
					status = 'closed';
					pendingSince = 0;
				}
			}
		});
	}

	function close() {
		sub?.close();
		sub = null;
		status = 'idle';
		pendingSince = 0;
	}

	$effect(() => {
		if (live && conn.isAuthenticated) {
			open();
			return () => close();
		}
	});

	$effect(() => {
		if (status !== 'connecting' && status !== 'reconnecting') return;
		const t = setInterval(() => (now = Date.now()), 500);
		return () => clearInterval(t);
	});

	function toggleLive() {
		live = !live;
	}

	function reconnect() {
		close();
		live = true;
		queueMicrotask(open);
	}

	function clear() {
		lines.length = 0;
	}

	let statusLabel = $derived(
		status === 'open'
			? m.detail_status_live()
			: status === 'connecting'
				? m.log_status_connecting()
				: status === 'reconnecting'
					? m.log_status_reconnecting()
					: m.log_status_paused()
	);
	let statusDot = $derived(
		status === 'open'
			? 'bg-[var(--color-success)]'
			: status === 'connecting' || status === 'reconnecting'
				? 'bg-[var(--color-warning)]'
				: 'bg-[var(--color-fg-subtle)]'
	);

	let pendingSecs = $derived(pendingSince > 0 ? Math.floor((now - pendingSince) / 1000) : 0);
	let slow = $derived(pendingSecs >= 5 && pendingSecs < 15);
	let stuck = $derived(pendingSecs >= 15);

	// When `tail` changes while we're live, restart the stream so the server
	// re-replays the new tail count.
	function applyTail() {
		if (live) {
			close();
			queueMicrotask(open);
		}
	}
</script>

<div class={cn('flex flex-col gap-3', klass)}>
	<div class="flex flex-wrap items-center justify-between gap-3">
		<div class="flex items-center gap-3">
			<span class="inline-flex items-center gap-2 text-xs">
				<span class={cn('h-2 w-2 rounded-full', statusDot)}></span>
				<span class="text-[var(--color-fg-muted)]">{statusLabel}</span>
			</span>
			<span class="text-xs text-[var(--color-fg-subtle)] tabular-nums">
				{m.log_lines_count({ count: lines.length })}
			</span>
		</div>

		<div class="flex items-center gap-2">
			<label class="flex items-center gap-1.5 text-xs text-[var(--color-fg-muted)]">
				{m.log_tail_label()}
				<input
					type="number"
					min="0"
					max="5000"
					step="50"
					bind:value={tail}
					onblur={applyTail}
					onkeydown={(e) => {
						if (e.key === 'Enter') applyTail();
					}}
					class="h-7 w-20 rounded-md border border-[var(--color-border)] bg-[var(--color-bg-soft)] px-2 text-xs"
				/>
			</label>
			<label class="flex items-center gap-1.5 text-xs text-[var(--color-fg-muted)]">
				<input type="checkbox" bind:checked={autoScroll} class="accent-[var(--color-accent)]" />
				{m.log_autoscroll_label()}
			</label>
			<Button variant="ghost" size="sm" onclick={clear}>{m.log_action_clear()}</Button>
			<Button variant="secondary" size="sm" onclick={toggleLive}>
				{live ? m.log_action_pause() : m.log_action_resume()}
			</Button>
		</div>
	</div>

	{#if status === 'connecting' && !stuck}
		<Banner
			variant="info"
			title={slow ? m.log_banner_opening_slow_title() : m.log_banner_opening_title()}
		>
			{slow
				? m.log_banner_opening_slow_body({ secs: pendingSecs })
				: m.log_banner_opening_body()}
		</Banner>
	{:else if status === 'reconnecting' && !stuck}
		<Banner
			variant="warning"
			title={slow ? m.log_banner_reconnecting_slow_title() : m.log_status_reconnecting()}
		>
			{lastError ?? m.log_banner_reconnecting_body_default()}
		</Banner>
	{:else if stuck}
		<Banner variant="danger" title={m.log_banner_stuck_title()}>
			{lastError ?? m.log_banner_stuck_no_response_default({ secs: pendingSecs })}
			{m.log_banner_stuck_suffix()}
			{#snippet actions()}
				<Button variant="secondary" size="sm" onclick={reconnect}>
					{m.log_action_reconnect_now()}
				</Button>
			{/snippet}
		</Banner>
	{:else if status === 'closed' && !live}
		<Banner variant="info" title={m.log_banner_paused_title()}>
			{m.log_banner_paused_body()}
			{#snippet actions()}
				<Button variant="secondary" size="sm" onclick={() => (live = true)}>
					{m.log_action_resume()}
				</Button>
			{/snippet}
		</Banner>
	{/if}

	<div
		bind:this={scroller}
		class="h-[480px] overflow-auto rounded-[var(--radius-input)] border border-[var(--color-border)] bg-black/40 px-4 py-3 font-mono text-[12px] leading-[1.55]"
	>
		{#if lines.length === 0}
			<p class="text-[var(--color-fg-subtle)]">{m.log_empty_state()}</p>
		{:else}
			{#each lines as l (l.ts + ':' + l.text)}
				<div
					class={cn(
						'whitespace-pre-wrap break-words',
						l.kind === 'error' && 'text-[var(--color-danger)]'
					)}
				>
					{l.text}
				</div>
			{/each}
		{/if}
	</div>
</div>
