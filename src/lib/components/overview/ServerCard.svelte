<script lang="ts">
	import { goto } from '$app/navigation';
	import Sparkline from '$lib/components/charts/Sparkline.svelte';
	import LiveBadge from '$lib/components/ui/LiveBadge.svelte';
	import TweenedNumber from '$lib/components/ui/TweenedNumber.svelte';
	import { fmtBps, fmtDuration, fmtPercent } from '$lib/utils/format';
	import { cn } from '$lib/utils/cn';
	import type { ServerProfile } from '$lib/types/profile';
	import type { Connection } from '$lib/stores/connections.svelte';
	import type { LiveTone } from '$lib/utils/connTone';
	import IconTrash from '~icons/lucide/trash-2';
	import OsIcon from './OsIcon.svelte';
	import { DEFAULT_ACCENT, accentFg } from '$lib/utils/accent';
	import { connectionTone } from '$lib/utils/connTone';
	import { m } from '$lib/paraglide/messages';

	interface Props {
		profile: ServerProfile;
		conn: Connection;
		onRemove?: (e: MouseEvent) => void;
	}

	let { profile, conn, onRemove }: Props = $props();

	let live = $derived(conn.live);

	// Acquire/release SSE while card is mounted AND auth is up.
	$effect(() => {
		if (!conn.isAuthenticated) return;
		const l = live;
		l.acquire();
		return () => l.release();
	});

	// Pull system info once so the OS icon next to the server name has data
	// — it's cached on the connection, so visiting /overview later costs nothing.
	$effect(() => {
		if (!conn.isAuthenticated) return;
		void conn.fetchSystemInfo();
	});

	let cpuPct = $derived(live.cpu?.usage_percent ?? null);
	let memPct = $derived.by(() => {
		const m = live.memory;
		if (!m) return null;
		return m.total_bytes > 0 ? (m.used_bytes / m.total_bytes) * 100 : 0;
	});
	let diskPct = $derived.by(() => {
		const ds = live.disks;
		if (!ds || ds.length === 0) return null;
		let max = 0;
		for (const d of ds) {
			if (d.total_bytes <= 0) continue;
			const p = (d.used_bytes / d.total_bytes) * 100;
			if (p > max) max = p;
		}
		return max;
	});
	let netRx = $derived.by(() => {
		const ns = live.network;
		if (!ns || ns.length === 0) return null;
		return ns.reduce((s, n) => s + n.rx_bytes_per_sec, 0);
	});
	let netTx = $derived.by(() => {
		const ns = live.network;
		if (!ns || ns.length === 0) return null;
		return ns.reduce((s, n) => s + n.tx_bytes_per_sec, 0);
	});

	// connTone is shared with the server list so both count by the same rule.
	let tone = $derived<LiveTone>(connectionTone(conn));
	let isStreaming = $derived(conn.isAuthenticated && live.status === 'open');
	let accent = $derived(profile.accent ?? DEFAULT_ACCENT);

	let sysInfo = $derived(conn.systemInfo?.data ?? null);
	let sysFetchedAt = $derived(conn.systemInfo?.fetchedAt ?? 0);
	let now = $state(Date.now());
	$effect(() => {
		const t = setInterval(() => (now = Date.now()), 1000);
		return () => clearInterval(t);
	});
	let liveUptime = $derived(
		sysInfo && sysFetchedAt > 0
			? sysInfo.description.uptime_secs + Math.floor((now - sysFetchedAt) / 1000)
			: 0
	);
	let osLabel = $derived.by(() => {
		if (!sysInfo) return null;
		const { os, os_version } = sysInfo.description;
		if (!os_version || os_version === 'unknown') return os.toLowerCase();
		const candidate = os_version.toLowerCase().includes(os.toLowerCase())
			? os_version
			: `${os} ${os_version}`;
		return candidate.toLowerCase();
	});
	let cpuLabel = $derived.by(() => {
		if (!sysInfo) return null;
		return `${sysInfo.hardware.cpu_cores}c / ${sysInfo.hardware.cpu_threads}t`;
	});

	function fmtPct(v: number) {
		return fmtPercent(v, 1);
	}
	function fmtBpsClean(v: number) {
		return fmtBps(v);
	}
	function severity(pct: number | null): string {
		if (pct === null) return '';
		if (pct >= 90) return 'text-[var(--color-danger)]';
		if (pct >= 75) return 'text-[var(--color-warning)]';
		return 'text-[var(--color-fg)]';
	}

	const metricColor = {
		cpu: '#4fb6c2',  // teal-500
		mem: '#d97706',  // amber-600
		disk: '#8b7cc6', // muted violet
		netRx: '#3b82f6', // blue-500 — download (incoming)
		netTx: '#f59e0b'  // amber-500 — upload (outgoing)
	} as const;

	function handleRemoveClick(e: MouseEvent) {
		e.preventDefault();
		e.stopPropagation();
		onRemove?.(e);
	}

	function handleRepairClick(e: MouseEvent) {
		e.preventDefault();
		e.stopPropagation();
		goto(`/servers/new?replace=${profile.id}`);
	}

	// Prefetch overview REST calls on hover; client cache (5s) covers hover→click.
	function prefetchOverview() {
		if (!conn.isAuthenticated) return;
		const end = Math.floor(Date.now() / 1000);
		const start = end - 600;
		const q = { start, end };
		void conn.client.cpuHistory({ ...q, limit: 30 }).catch(() => {});
		void conn.client.pressureHistory('cpu', q).catch(() => {});
		void conn.client.pressureHistory('memory', q).catch(() => {});
		void conn.client.pressureHistory('io', q).catch(() => {});
	}
</script>

<a
	href={`/servers/${profile.id}`}
	onmouseenter={prefetchOverview}
	onfocus={prefetchOverview}
	class={cn(
		'group enter relative block overflow-hidden rounded-[var(--radius-card)] bg-[var(--color-surface)]',
		'shadow-[inset_0_1px_0_rgba(255,255,255,0.03),0_0_0_1px_var(--card-border,var(--color-border))]',
		'transition-shadow duration-[var(--dur-mid)] ease-[var(--ease-snap)]',
		'hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_0_0_1px_var(--card-border-strong,var(--color-border-strong))]',
		'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]'
	)}
	style={profile.accent
		? `--card-border: ${profile.accent}; --card-border-strong: ${profile.accent}`
		: ''}
	aria-label={m.servercard_aria_open({ name: profile.name })}
>
	<header class="flex items-start gap-3 px-4 pt-4">
		<div class="min-w-0 flex-1">
			<h3 class="flex items-center gap-2 font-mono text-[14px] font-semibold tracking-[0.01em] text-[var(--color-fg)]">
				{#if sysInfo}
					<OsIcon
						os={sysInfo.description.os}
						version={sysInfo.description.os_version}
						class="size-4 shrink-0"
					/>
				{/if}
				<span class="truncate">{profile.name}</span>
				<LiveBadge {tone} live={isStreaming} class="ml-1 shrink-0" />
			</h3>
			<p class="mt-1 truncate font-mono text-[11px] text-[var(--color-fg-muted)]">
				{profile.baseUrl}
			</p>
			{#if !conn.isAuthenticated && conn.error}
				<div class="mt-1.5 flex items-center gap-2">
					<p
						class="min-w-0 flex-1 truncate font-mono text-[10px] text-[var(--color-danger)]/80"
						title={conn.error.userMessage}
					>
						{conn.error.userMessage}
					</p>
					{#if conn.error.needsRepair}
						<button
							type="button"
							onclick={handleRepairClick}
							class="shrink-0 rounded-md border border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 px-2 py-0.5 font-mono text-[10px] tracking-wide text-[var(--color-warning)] transition-all duration-[var(--dur-fast)] hover:bg-[var(--color-warning)]/15 hover:border-[var(--color-warning)]/60"
						>
							{m.servercard_repair_button()}
						</button>
					{/if}
				</div>
			{/if}
		</div>
		{#if onRemove}
			<button
				type="button"
				onclick={handleRemoveClick}
				class="grid h-7 w-7 shrink-0 place-items-center rounded-md text-[var(--color-fg-subtle)] opacity-60 transition-all duration-[var(--dur-fast)] hover:bg-[var(--color-surface-3)] hover:text-[var(--color-danger)] hover:opacity-100 focus-visible:opacity-100 group-hover:opacity-100"
				aria-label={m.servercard_aria_remove()}
				title={m.servercard_remove_title()}
			>
				<IconTrash class="size-[13px]" stroke-width="2" />
			</button>
		{/if}
	</header>

	<div class="mt-2.5 flex flex-col gap-1 px-4">
		{@render sparkRow('CPU', cpuPct, fmtPct, metricColor.cpu, live.cpuHistory, severity(cpuPct), 0, 100)}
		{@render barRow('MEM', memPct, fmtPct, metricColor.mem, severity(memPct))}
		{@render barRow('DISK', diskPct, fmtPct, metricColor.disk, severity(diskPct))}
		{@render netRow()}
	</div>

	<footer
		class="mt-2.5 flex items-center gap-2 border-t border-[var(--color-border)] px-4 py-2.5 text-[12px] text-[var(--color-fg-muted)]"
	>
		{#if osLabel}
			<span class="truncate">{osLabel}</span>
		{:else}
			<span class="text-[var(--color-fg-subtle)]">{m.servercard_awaiting_host()}</span>
		{/if}
		{#if sysInfo}
			<span class="text-[var(--color-fg-faint)]" aria-hidden="true">·</span>
			<span class="shrink-0">{m.servercard_uptime_prefix()} {fmtDuration(liveUptime)}</span>
			{#if cpuLabel}
				<span class="text-[var(--color-fg-faint)]" aria-hidden="true">·</span>
				<span class="shrink-0 font-mono">{cpuLabel}</span>
			{/if}
		{/if}
	</footer>
</a>

{#snippet sparkRow(
	label: string,
	value: number | null,
	fmt: (v: number) => string,
	color: string,
	series: { xs: number[]; ys: number[] },
	valueClass: string,
	min?: number,
	max?: number
)}
	<div class="grid grid-cols-[40px_1fr_auto] items-center gap-4">
		<span class="font-mono text-[11px] font-medium tracking-[0.08em] text-[var(--color-fg-muted)]">{label}</span>
		<div class="min-w-0">
			<Sparkline data={series} {color} height={36} {min} {max} fill window={20} />
		</div>
		<TweenedNumber
			{value}
			format={fmt}
			class={cn(
				'inline-block min-w-[88px] text-right font-mono text-[13px] tabular-nums',
				valueClass || 'text-[var(--color-fg)]'
			)}
		/>
	</div>
{/snippet}

{#snippet netRow()}
	<div class="grid grid-cols-[40px_1fr_auto] items-center gap-4">
		<span class="font-mono text-[11px] font-medium tracking-[0.08em] text-[var(--color-fg-muted)]">NET</span>
		<div class="min-w-0">
			<Sparkline
				data={live.netRxHistory}
				color={metricColor.netRx}
				extra={{ data: live.netTxHistory, color: metricColor.netTx }}
				height={36}
				fill
				window={20}
			/>
		</div>
		<div class="flex min-w-[88px] flex-col items-end gap-0.5 font-mono text-[11px] tabular-nums leading-tight">
			<span class="flex items-center gap-1 text-[var(--color-fg)]">
				<span class="text-[var(--color-fg-subtle)]">↓</span>
				<TweenedNumber value={netRx} format={fmtBpsClean} class="inline-block" />
			</span>
			<span class="flex items-center gap-1 text-[var(--color-fg-muted)]">
				<span class="text-[var(--color-fg-subtle)]">↑</span>
				<TweenedNumber value={netTx} format={fmtBpsClean} class="inline-block" />
			</span>
		</div>
	</div>
{/snippet}

{#snippet barRow(
	label: string,
	value: number | null,
	fmt: (v: number) => string,
	color: string,
	valueClass: string
)}
	<div class="grid grid-cols-[40px_1fr_auto] items-center gap-4">
		<span class="font-mono text-[11px] font-medium tracking-[0.08em] text-[var(--color-fg-muted)]">{label}</span>
		<div class="flex h-9 min-w-0 items-center">
			<div class="relative h-2 w-full overflow-hidden rounded-full bg-[var(--color-surface-2)]">
				<div
					class="absolute inset-y-0 left-0 rounded-full transition-[width] duration-500 ease-[var(--ease-snap)]"
					style={`width: ${value === null ? 0 : Math.min(100, Math.max(0, value))}%; background: ${color}`}
				></div>
			</div>
		</div>
		<TweenedNumber
			{value}
			format={fmt}
			class={cn(
				'inline-block min-w-[88px] text-right font-mono text-[13px] tabular-nums',
				valueClass || 'text-[var(--color-fg)]'
			)}
		/>
	</div>
{/snippet}
