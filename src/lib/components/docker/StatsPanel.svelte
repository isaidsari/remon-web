<script lang="ts">
	import Card from '$lib/components/ui/Card.svelte';
	import Banner from '$lib/components/ui/Banner.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import { deriveStats } from '$lib/utils/dockerStats';
	import { fmtBps, fmtBytes, fmtPercent } from '$lib/utils/format';
	import type { Connection } from '$lib/stores/connections.svelte';
	// Local `m` = derived stats — alias paraglide messages to `t` to avoid
	// the name clash without renaming every `m.cpuPercent` access below.
	import { m as t } from '$lib/paraglide/messages';
	import type { RawStats } from '$lib/utils/dockerStats';

	interface Props {
		conn: Connection;
		containerId: string;
		intervalMs?: number;
		paused?: boolean;
	}

	let { conn, containerId, intervalMs = 2000, paused = false }: Props = $props();

	let prev = $state<RawStats | null>(null);
	let curr = $state<RawStats | null>(null);
	let lastSampleAt = $state<number>(0);
	let deltaSecs = $state(0);
	let error = $state<string | null>(null);
	let manualReloadAt = $state<number>(0);
	let now = $state(Date.now());

	$effect(() => {
		if (paused || !conn.isAuthenticated) return;
		void manualReloadAt; // re-trigger when user requests a forced retry
		let cancelled = false;

		async function tick() {
			if (cancelled) return;
			try {
				const s = await conn.client.containerStats(containerId);
				if (cancelled) return;
				const ts = Date.now();
				deltaSecs = lastSampleAt > 0 ? (ts - lastSampleAt) / 1000 : 0;
				lastSampleAt = ts;
				prev = curr;
				curr = s;
				error = null;
			} catch (e) {
				if (!cancelled) error = e instanceof Error ? e.message : String(e);
			}
		}

		void tick();
		const t = setInterval(tick, intervalMs);
		return () => {
			cancelled = true;
			clearInterval(t);
		};
	});

	$effect(() => {
		if (paused) return;
		const t = setInterval(() => (now = Date.now()), 1000);
		return () => clearInterval(t);
	});

	let m = $derived(deriveStats(curr, prev, deltaSecs));

	let secondsSinceSample = $derived(lastSampleAt > 0 ? Math.floor((now - lastSampleAt) / 1000) : 0);
	let stale = $derived(
		!paused &&
			lastSampleAt > 0 &&
			secondsSinceSample * 1000 > intervalMs * 3
	);

	function fmtMaybePct(v: number | null): string {
		return v === null ? '—' : fmtPercent(v);
	}
	function fmtMaybeBps(v: number | null): string {
		return v === null ? '—' : fmtBps(v);
	}

	function retry() {
		manualReloadAt = Date.now();
	}
</script>

<Card>
	<div class="mb-4 flex items-center justify-between">
		<h2 class="text-sm font-medium text-[var(--color-fg)]">{t.statspanel_title()}</h2>
		<div class="flex items-center gap-2">
			{#if stale}
				<span
					class="rounded-full bg-[var(--color-warning)]/15 px-2 py-0.5 text-[10px] tracking-wide text-[var(--color-warning)]"
					title={t.statspanel_stale_title({ secs: secondsSinceSample })}
				>
					{t.statspanel_stale_badge()} · {secondsSinceSample}s
				</span>
			{/if}
			<span class="text-xs text-[var(--color-fg-subtle)]">
				{paused
					? t.statspanel_paused_status()
					: t.statspanel_polling({ secs: Math.round(intervalMs / 1000) })}
			</span>
		</div>
	</div>

	{#if error}
		<div class="mb-3">
			<Banner variant="danger" title={t.statspanel_error_title()}>
				{error}
				{#snippet actions()}
					<Button variant="secondary" size="sm" onclick={retry}>{t.common_retry()}</Button>
				{/snippet}
			</Banner>
		</div>
	{/if}

	<div class="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
		<div class="flex flex-col gap-1">
			<span class="text-xs tracking-wide text-[var(--color-fg-muted)]">CPU</span>
			<span class="text-xl font-semibold tabular-nums" style="color: rgb(96, 165, 250)">
				{fmtMaybePct(m.cpuPercent)}
			</span>
		</div>

		<div class="flex flex-col gap-1">
			<span class="text-xs tracking-wide text-[var(--color-fg-muted)]">{t.statspanel_label_memory()}</span>
			<span class="text-xl font-semibold tabular-nums" style="color: rgb(167, 139, 250)">
				{fmtMaybePct(m.memPercent)}
			</span>
			{#if m.memUsedBytes !== null && m.memLimitBytes !== null}
				<span class="font-mono text-[11px] text-[var(--color-fg-subtle)]">
					{fmtBytes(m.memUsedBytes)} / {fmtBytes(m.memLimitBytes)}
				</span>
			{/if}
		</div>

		<div class="flex flex-col gap-1">
			<span class="text-xs tracking-wide text-[var(--color-fg-muted)]">{t.statspanel_label_network()}</span>
			<span class="text-xl font-semibold tabular-nums" style="color: rgb(52, 211, 153)">
				{fmtMaybeBps((m.netRxBps ?? 0) + (m.netTxBps ?? 0))}
			</span>
			{#if m.netRxBps !== null && m.netTxBps !== null}
				<span class="font-mono text-[11px] text-[var(--color-fg-subtle)]">
					↓ {fmtBps(m.netRxBps)} · ↑ {fmtBps(m.netTxBps)}
				</span>
			{/if}
		</div>

		<div class="flex flex-col gap-1">
			<span class="text-xs tracking-wide text-[var(--color-fg-muted)]">{t.statspanel_label_block_io()}</span>
			<span class="text-xl font-semibold tabular-nums" style="color: rgb(251, 191, 36)">
				{fmtMaybeBps((m.blkReadBps ?? 0) + (m.blkWriteBps ?? 0))}
			</span>
			{#if m.blkReadBps !== null && m.blkWriteBps !== null}
				<span class="font-mono text-[11px] text-[var(--color-fg-subtle)]">
					r {fmtBps(m.blkReadBps)} · w {fmtBps(m.blkWriteBps)}
				</span>
			{/if}
		</div>

		<div class="flex flex-col gap-1">
			<span class="text-xs tracking-wide text-[var(--color-fg-muted)]">PIDs</span>
			<span class="text-xl font-semibold tabular-nums" style="color: rgb(244, 114, 182)">
				{m.pids === null ? '—' : m.pids}
			</span>
		</div>
	</div>

	{#if !paused && curr === null && error === null}
		<p class="mt-4 text-xs text-[var(--color-fg-subtle)]">{t.statspanel_sampling()}</p>
	{/if}
	{#if paused}
		<p class="mt-4 text-xs text-[var(--color-fg-subtle)]">
			{t.statspanel_paused_resume_hint()}
		</p>
	{/if}
</Card>
