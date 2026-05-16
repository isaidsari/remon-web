<script lang="ts">
	import { untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { profiles } from '$lib/stores/profiles.svelte';
	import { connections } from '$lib/stores/connections.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { ApiError } from '$lib/api/error';
	import Card from '$lib/components/ui/Card.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Skeleton from '$lib/components/ui/Skeleton.svelte';
	import StatusDot from '$lib/components/layout/StatusDot.svelte';
	import MetricCard from '$lib/components/overview/MetricCard.svelte';
	import HostInfoCard from '$lib/components/overview/HostInfoCard.svelte';
	import IfaceIcon from '$lib/components/overview/IfaceIcon.svelte';
	import MountIcon from '$lib/components/overview/MountIcon.svelte';
	import { fmtBps, fmtBytes, fmtPercent, fmtNumber } from '$lib/utils/format';
	import { cn } from '$lib/utils/cn';
	import { m } from '$lib/paraglide/messages';
	import { classifyInterface, isContainerMount } from '$lib/utils/netClassify';
	import type { CpuPoint, PressureHistoryResponse } from '$lib/types/api';

	let id = $derived(page.params.id ?? '');
	let profile = $derived(id ? profiles.byId(id) : undefined);
	let conn = $derived(profile ? connections.connect(profile) : null);
	let live = $derived(conn?.live);

	let lastCpuMetric = $state<CpuPoint | null>(null);
	let pressureCpu = $state<PressureHistoryResponse | null>(null);
	let pressureMem = $state<PressureHistoryResponse | null>(null);
	let pressureIo = $state<PressureHistoryResponse | null>(null);

	async function refreshExtras() {
		if (!conn?.isAuthenticated) return;
		try {
			const end = Math.floor(Date.now() / 1000);
			const start = end - 600;
			const q = { start, end };
			const [c, pc, pm, pi] = await Promise.all([
				conn.client.cpuHistory({ ...q, limit: 30 }),
				conn.client.pressureHistory('cpu', q).catch(() => null),
				conn.client.pressureHistory('memory', q).catch(() => null),
				conn.client.pressureHistory('io', q).catch(() => null)
			]);
			lastCpuMetric = c.points.length > 0 ? c.points[c.points.length - 1] : null;
			pressureCpu = pc;
			pressureMem = pm;
			pressureIo = pi;
		} catch {
			// Silent — supplementary data, page still useful without it.
		}
	}

	$effect(() => {
		if (!conn?.isAuthenticated) return;
		void refreshExtras();
		const t = setInterval(refreshExtras, 30_000);
		return () => clearInterval(t);
	});

	$effect(() => {
		if (!conn?.isAuthenticated) return;
		void conn.fetchSystemInfo();
	});

	// untrack: ensureSignedIn is idempotent; without it, status flicker retriggers the effect.
	$effect(() => {
		if (!conn) return;
		untrack(() => {
			conn.ensureSignedIn().catch((e) => {
				if (e instanceof ApiError) {
					toast.error(m.overview_toast_signin_failed(), { description: e.userMessage });
				}
			});
		});
	});

	$effect(() => {
		if (!conn || !live) return;
		if (!conn.isAuthenticated) return;
		live.acquire();
		return () => live.release();
	});

	let cpu = $derived(live?.cpu ?? null);
	let memory = $derived(live?.memory ?? null);
	let disks = $derived(live?.disks ?? []);
	let network = $derived(live?.network ?? []);

	let cpuPct = $derived(cpu?.usage_percent ?? 0);

	let memTotal = $derived(memory?.total_bytes ?? 0);
	let memAvailable = $derived(memory?.available_bytes ?? 0);
	let memCached = $derived(memory?.cached_bytes ?? 0);
	// memActive uses MemAvailable (htop "used"), not sysinfo used_bytes (total-free counts buffers/cache against you).
	let memActive = $derived(Math.max(0, memTotal - memAvailable));
	let memPct = $derived(memTotal > 0 ? (memActive / memTotal) * 100 : 0);
	// available already includes reclaimable cache; subtract cached to get truly free memory.
	let memFreeRest = $derived(Math.max(0, memAvailable - memCached));

	let diskTotalUsedPct = $derived.by(() => {
		if (disks.length === 0) return 0;
		let max = 0;
		for (const d of disks) {
			if (d.total_bytes <= 0) continue;
			const p = (d.used_bytes / d.total_bytes) * 100;
			if (p > max) max = p;
		}
		return max;
	});

	let diskReadTotal = $derived.by(() => {
		if (disks.length === 0) return null;
		let sum = 0;
		for (const d of disks) {
			if (d.mount_point.startsWith('/var/lib/docker/') || d.mount_point.startsWith('/var/lib/containers/')) continue;
			sum += d.read_bytes_per_sec ?? 0;
		}
		return sum;
	});
	let diskWriteTotal = $derived.by(() => {
		if (disks.length === 0) return null;
		let sum = 0;
		for (const d of disks) {
			if (d.mount_point.startsWith('/var/lib/docker/') || d.mount_point.startsWith('/var/lib/containers/')) continue;
			sum += d.write_bytes_per_sec ?? 0;
		}
		return sum;
	});
	let diskIoTotal = $derived(
		diskReadTotal === null && diskWriteTotal === null ? null : (diskReadTotal ?? 0) + (diskWriteTotal ?? 0)
	);

	function diskCapacityClass(p: number): string {
		if (p >= 90) return 'text-[var(--color-danger)]';
		if (p >= 75) return 'text-[var(--color-warning)]';
		return 'text-[var(--color-fg-muted)]';
	}

	let physicalNet = $derived(network.filter((n) => classifyInterface(n.interface) === 'physical'));
	let containerNet = $derived(network.filter((n) => classifyInterface(n.interface) === 'container'));
	let virtualNet = $derived(network.filter((n) => classifyInterface(n.interface) === 'virtual'));

	let netRx = $derived(physicalNet.reduce((s, n) => s + n.rx_bytes_per_sec, 0));
	let netTx = $derived(physicalNet.reduce((s, n) => s + n.tx_bytes_per_sec, 0));

	let mainDisks = $derived(disks.filter((d) => !isContainerMount(d.mount_point)));
	let dockerDisks = $derived(disks.filter((d) => isContainerMount(d.mount_point)));

	// Trim docker overlay SHA segments to 12 chars; full path in title tooltip.
	function shortenMount(path: string): string {
		const segs = path.split('/').filter(Boolean);
		const last = segs[segs.length - 1] ?? '';
		if (/^[a-f0-9]{32,}$/.test(last)) {
			const head = segs.slice(0, -1).join('/');
			return `/${head}/${last.slice(0, 12)}…`;
		}
		return path;
	}

	let streamStatus = $derived(live?.status ?? 'idle');
	let streamLabel = $derived.by(() => {
		switch (streamStatus) {
			case 'open':
				return m.detail_status_live();
			case 'connecting':
				return m.overview_stream_connecting();
			case 'reconnecting':
				return m.overview_stream_reconnecting();
			case 'closed':
				return m.overview_stream_disconnected();
			default:
				return m.overview_stream_idle();
		}
	});
	let streamDotStatus = $derived.by(() => {
		if (streamStatus === 'open') return 'connected' as const;
		if (streamStatus === 'connecting' || streamStatus === 'reconnecting') return 'unknown' as const;
		return 'offline' as const;
	});

	function diskPct(used: number, total: number): number {
		return total > 0 ? (used / total) * 100 : 0;
	}

	async function manualSignIn() {
		if (!conn) return;
		try {
			await conn.login();
			toast.success(m.overview_toast_signed_in());
		} catch (e) {
			if (e instanceof ApiError) {
				toast.error(m.overview_toast_signin_failed(), { description: e.userMessage });
			}
		}
	}

	function stealColor(p: number | null | undefined): string {
		if (p == null) return 'text-[var(--color-fg)]';
		if (p >= 5) return 'text-[var(--color-danger)]';
		if (p >= 2) return 'text-[var(--color-warning)]';
		return 'text-[var(--color-fg)]';
	}
	function iowaitColor(p: number | null | undefined): string {
		if (p == null) return 'text-[var(--color-fg)]';
		if (p >= 30) return 'text-[var(--color-danger)]';
		if (p >= 15) return 'text-[var(--color-warning)]';
		return 'text-[var(--color-fg)]';
	}
	function pressureColor(p: number | null | undefined): string {
		if (p == null) return 'text-[var(--color-fg)]';
		if (p >= 30) return 'text-[var(--color-danger)]';
		if (p >= 10) return 'text-[var(--color-warning)]';
		return 'text-[var(--color-fg)]';
	}

	function latestPsi(p: PressureHistoryResponse | null): number | null {
		if (!p || p.points.length === 0) return null;
		return p.points[p.points.length - 1].some_avg10;
	}
</script>

{#if profile}
	<div class="px-4 py-6 md:px-8 md:py-8">
		<header class="mb-6">
			<h1 class="text-[24px] font-semibold tracking-tight">{m.section_overview()}</h1>
		</header>

		{#if !conn?.isAuthenticated}
			{@const needsRepair = conn?.error?.needsRepair === true}
			<Card padding="lg" class="mb-6 border-[var(--color-warning)]/30">
				<div class="flex items-start justify-between gap-4">
					<div>
						<p class="font-medium">
							{conn?.status === 'authenticating'
								? m.overview_auth_signing_in()
								: needsRepair
									? m.overview_auth_credential_rejected()
									: m.overview_auth_not_signed_in()}
						</p>
						<p class="mt-1 text-sm text-[var(--color-fg-muted)]">
							{#if needsRepair}
								{m.overview_auth_needs_repair_body()}
							{:else}
								{m.overview_auth_signin_prompt()}
							{/if}
						</p>
						{#if conn?.error}
							<p class="mt-1 text-sm text-[var(--color-danger)]">{conn.error.userMessage}</p>
						{/if}
					</div>
					<div class="flex flex-shrink-0 items-center gap-2">
						{#if needsRepair}
							<Button
								variant="primary"
								onclick={() => goto(`/servers/new?replace=${id}`)}
							>
								{m.overview_auth_repair_button()}
							</Button>
							<Button
								variant="ghost"
								onclick={manualSignIn}
								loading={conn?.status === 'authenticating'}
							>
								{m.overview_auth_retry_button()}
							</Button>
						{:else}
							<Button onclick={manualSignIn} loading={conn?.status === 'authenticating'}>
								{m.overview_auth_signin_button()}
							</Button>
						{/if}
					</div>
				</div>
			</Card>
		{/if}

		{#if conn?.isAuthenticated}
			<HostInfoCard
				info={conn.systemInfo?.data ?? null}
				fetchedAt={conn.systemInfo?.fetchedAt ?? 0}
				class="mb-4"
			/>
		{/if}

		<div
			class="hairline-grid grid-cols-1 overflow-hidden rounded-[var(--radius-card)] shadow-[inset_0_1px_0_rgba(255,255,255,0.03),0_0_0_1px_var(--color-border)] sm:grid-cols-2 xl:grid-cols-4"
		>
			<MetricCard
				label={m.overview_metric_cpu_label()}
				value={cpu ? cpuPct : null}
				format={(v) => fmtPercent(v, 1)}
				secondary={cpu ? m.overview_metric_cores_count({ count: cpu.per_core.length }) : ''}
				series={live?.cpuHistory ?? { xs: [], ys: [] }}
				color="#4fb6c2"
				min={0}
				max={100}
			/>
			<MetricCard
				label={m.overview_metric_memory_label()}
				value={memory ? memPct : null}
				format={(v) => fmtPercent(v, 1)}
				secondary={memTotal > 0 ? `${fmtBytes(memActive)} / ${fmtBytes(memTotal)}` : ''}
				series={live?.memoryActivePercentHistory ?? { xs: [], ys: [] }}
				color="#d97706"
				min={0}
				max={100}
			/>
			<MetricCard
				label={m.overview_metric_disk_io_label()}
				value={diskIoTotal}
				format={(v) => fmtBps(v, 1)}
				series={live?.diskReadHistory ?? { xs: [], ys: [] }}
				extra={live?.diskWriteHistory ? { data: live.diskWriteHistory, color: '#c4b5fd' } : undefined}
				color="#8b7cc6"
				min={0}
			>
				{#snippet secondary()}
					{#if disks.length > 0}
						<span class="inline-flex items-center gap-2 font-mono text-[11px] tabular-nums text-[var(--color-fg-subtle)]">
							<span class="inline-flex items-center gap-1">
								<span class="font-semibold" style="color: #8b7cc6">R</span>
								<span>{fmtBps(diskReadTotal ?? 0, 0)}</span>
							</span>
							<span class="text-[var(--color-fg-faint)]" aria-hidden="true">·</span>
							<span class="inline-flex items-center gap-1">
								<span class="font-semibold" style="color: #c4b5fd">W</span>
								<span>{fmtBps(diskWriteTotal ?? 0, 0)}</span>
							</span>
						</span>
					{/if}
				{/snippet}
			</MetricCard>
			<MetricCard
				label={m.overview_metric_network_label()}
				value={physicalNet.length > 0 ? netRx + netTx : null}
				format={(v) => fmtBps(v, 1)}
				series={live?.netRxHistory ?? { xs: [], ys: [] }}
				extra={live?.netTxHistory ? { data: live.netTxHistory, color: '#fbbf24' } : undefined}
				color="#3b82f6"
				min={0}
			>
				{#snippet secondary()}
					{#if physicalNet.length}
						<span class="inline-flex items-center gap-2 font-mono text-[11px] tabular-nums text-[var(--color-fg-subtle)]">
							<span class="inline-flex items-center gap-1">
								<span class="font-semibold" style="color: #3b82f6">↓</span>
								<span>{fmtBps(netRx)}</span>
							</span>
							<span class="text-[var(--color-fg-faint)]" aria-hidden="true">·</span>
							<span class="inline-flex items-center gap-1">
								<span class="font-semibold" style="color: #fbbf24">↑</span>
								<span>{fmtBps(netTx)}</span>
							</span>
						</span>
					{/if}
				{/snippet}
			</MetricCard>
		</div>

		<Card class="mt-4" padding="md">
			<div class="mb-3 flex items-baseline justify-between">
				<p class="text-xs tracking-wide text-[var(--color-fg-muted)]">{m.overview_per_core_cpu_title()}</p>
				{#if cpu && cpu.per_core.length > 0}
					<span class="font-mono text-[11px] text-[var(--color-fg-muted)]">
						{m.overview_metric_cores_count({ count: cpu.per_core.length })}
					</span>
				{/if}
			</div>
			{#if cpu && cpu.per_core.length > 0}
				<div class="per-core-grid">
					{#each cpu.per_core as core (core.core_index)}
						{@const pct = Math.min(100, Math.max(0, core.usage_percent))}
						{@const rgb = pct < 60 ? '79,182,194' : pct < 80 ? '217,119,6' : '220,38,38'}
						{@const alpha = (Math.max(4, pct) / 100 * 0.55 + 0.05).toFixed(2)}
						<div
							class="flex flex-col items-center justify-center gap-0.5 rounded-md py-2 transition-colors duration-500"
							style="background: rgba({rgb},{alpha})"
						>
							<span class="font-mono text-[9px] text-[var(--color-fg-subtle)]">{core.core_index}</span>
							<span class="tabular-nums text-[11px] font-semibold">{Math.round(pct)}%</span>
						</div>
					{/each}
				</div>
			{:else}
				<div class="per-core-grid">
					{#each Array(8) as _, i (i)}
						<Skeleton class="h-[58px] w-full" />
					{/each}
				</div>
			{/if}
		</Card>

		<div class="mt-4 grid grid-cols-1 gap-4 lg:auto-rows-fr lg:grid-cols-2">
			<Card class="h-full">
				{@render cardHeader(m.overview_card_cpu_title(), latestPsi(pressureCpu))}
				<dl class="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
					<div>
						<dt class="text-xs text-[var(--color-fg-subtle)]">{m.overview_cpu_usage()}</dt>
						<dd class="mt-1 text-lg font-semibold tabular-nums">
							{cpu ? fmtPercent(cpuPct, 1) : '—'}
						</dd>
					</div>
					<div>
						<dt class="text-xs text-[var(--color-fg-subtle)]">{m.overview_cpu_load_1m()}</dt>
						<dd class="mt-1 text-lg font-semibold tabular-nums">
							{cpu ? fmtNumber(cpu.load_avg.one) : '—'}
						</dd>
					</div>
					<div>
						<dt class="text-xs text-[var(--color-fg-subtle)]">{m.overview_cpu_load_5m()}</dt>
						<dd class="mt-1 text-lg font-semibold tabular-nums">
							{cpu ? fmtNumber(cpu.load_avg.five) : '—'}
						</dd>
					</div>
					<div>
						<dt class="text-xs text-[var(--color-fg-subtle)]">{m.overview_cpu_load_15m()}</dt>
						<dd class="mt-1 text-lg font-semibold tabular-nums">
							{cpu ? fmtNumber(cpu.load_avg.fifteen) : '—'}
						</dd>
					</div>
				</dl>
				{#if lastCpuMetric && (lastCpuMetric.steal_percent != null || lastCpuMetric.iowait_percent != null)}
					<dl class="mt-4 grid grid-cols-2 gap-4 border-t border-[var(--color-border)] pt-4 text-sm">
						{#if lastCpuMetric.steal_percent != null}
							<div>
								<dt class="text-xs text-[var(--color-fg-subtle)]">{m.overview_cpu_steal()}</dt>
								<dd class={cn('mt-1 font-semibold tabular-nums', stealColor(lastCpuMetric.steal_percent))}>
									{fmtPercent(lastCpuMetric.steal_percent, 1)}
								</dd>
							</div>
						{/if}
						{#if lastCpuMetric.iowait_percent != null}
							<div>
								<dt class="text-xs text-[var(--color-fg-subtle)]">{m.overview_cpu_iowait()}</dt>
								<dd class={cn('mt-1 font-semibold tabular-nums', iowaitColor(lastCpuMetric.iowait_percent))}>
									{fmtPercent(lastCpuMetric.iowait_percent, 1)}
								</dd>
							</div>
						{/if}
					</dl>
				{/if}
			</Card>

			<Card class="h-full">
				{@render cardHeader(m.overview_card_memory_title(), latestPsi(pressureMem))}
				{#if memory && memTotal > 0}
					{@const activePct = (memActive / memTotal) * 100}
					{@const cachePct = (memCached / memTotal) * 100}
					{@const freePct = Math.max(0, 100 - activePct - cachePct)}
					<div class="flex h-2.5 w-full overflow-hidden rounded-full bg-[var(--color-surface-3)]">
						<div
							class="h-full bg-[var(--color-info)]"
							style="width: {activePct}%"
							title={m.overview_mem_active_tooltip({ value: fmtBytes(memActive) })}
						></div>
						<div
							class="h-full bg-[color-mix(in_oklab,var(--color-info)_40%,var(--color-surface-3))]"
							style="width: {cachePct}%"
							title={m.overview_mem_cache_tooltip({ value: fmtBytes(memCached) })}
						></div>
						<div
							class="h-full bg-[var(--color-surface-3)]"
							style="width: {freePct}%"
							title={m.overview_mem_free_tooltip({ value: fmtBytes(memFreeRest) })}
						></div>
					</div>
					<dl class="mt-3 grid grid-cols-3 gap-2 font-mono text-[12px] tabular-nums">
						<div>
							<dt class="text-[11px] text-[var(--color-fg-muted)]">{m.overview_mem_active()}</dt>
							<dd class="text-[var(--color-fg)]">{fmtBytes(memActive)}</dd>
						</div>
						<div>
							<dt class="text-[11px] text-[var(--color-fg-muted)]">{m.overview_mem_cache()}</dt>
							<dd class="text-[var(--color-fg-muted)]">{fmtBytes(memCached)}</dd>
						</div>
						<div>
							<dt class="text-[11px] text-[var(--color-fg-muted)]">{m.overview_mem_free()}</dt>
							<dd class="text-[var(--color-fg-muted)]">{fmtBytes(memFreeRest)}</dd>
						</div>
					</dl>
					{#if memory.swap_total_bytes > 0}
						{@const swapPct = (memory.swap_used_bytes / memory.swap_total_bytes) * 100}
						<div class="mt-5 border-t border-[var(--color-border)] pt-4">
							<div class="mb-1.5 flex items-baseline justify-between text-xs">
								<span class="text-[var(--color-fg-subtle)]">{m.overview_mem_swap()}</span>
								<span class="font-mono tabular-nums text-[var(--color-fg-muted)]">
									{fmtBytes(memory.swap_used_bytes)} / {fmtBytes(memory.swap_total_bytes)}
									<span class="ml-2">{fmtPercent(swapPct, 0)}</span>
								</span>
							</div>
							<div class="h-1.5 overflow-hidden rounded-full bg-[var(--color-surface-3)]">
								<div
									class="h-full rounded-full bg-[var(--color-warning)]"
									style="width: {Math.min(100, swapPct)}%"
								></div>
							</div>
						</div>
					{/if}
				{:else}
					<Skeleton class="h-2.5 w-full" rounded="full" />
					<div class="mt-3 grid grid-cols-3 gap-2">
						<Skeleton class="h-7 w-full" />
						<Skeleton class="h-7 w-full" />
						<Skeleton class="h-7 w-full" />
					</div>
				{/if}
			</Card>

			<Card class="h-full">
				{@render cardHeader(m.overview_card_storage_title(), latestPsi(pressureIo))}
				{#if disks.length > 0}
					<div class="flex flex-col gap-4">
						{#each mainDisks as d (d.mount_point)}
							{@render diskRow(d)}
						{/each}
						{#if dockerDisks.length > 0}
							<details class="border-t border-[var(--color-border)] pt-3">
								<summary
									class="cursor-pointer font-mono text-[10px] tracking-[0.08em] text-[var(--color-fg-subtle)] select-none hover:text-[var(--color-fg-muted)]"
								>
									{m.overview_storage_container_layers({ count: dockerDisks.length })}
								</summary>
								<div class="mt-3 flex flex-col gap-4">
									{#each dockerDisks as d (d.mount_point)}
										{@render diskRow(d)}
									{/each}
								</div>
							</details>
						{/if}
					</div>
				{:else}
					<div class="flex flex-col gap-4">
						{#each Array(3) as _, i (i)}
							<div>
								<div class="mb-1.5 flex items-baseline justify-between gap-3">
									<Skeleton class="h-3 w-32" />
									<div class="flex items-center gap-3">
										<Skeleton class="h-3 w-28" />
										<Skeleton class="h-3 w-20" />
										<Skeleton class="h-3 w-10" />
									</div>
								</div>
								<Skeleton class="h-1.5 w-full" rounded="full" />
							</div>
						{/each}
					</div>
				{/if}
			</Card>

			<Card class="h-full">
				{@render cardHeader(m.overview_card_network_title(), undefined)}
				{#if network.length > 0}
					<ul class="flex flex-col gap-2.5">
						{#each physicalNet as n (n.interface)}
							{@render ifaceRow(n)}
						{/each}
					</ul>
					{#if containerNet.length > 0}
						<details class="mt-3 border-t border-[var(--color-border)] pt-3">
							<summary
								class="cursor-pointer font-mono text-[10px] tracking-[0.08em] text-[var(--color-fg-subtle)] select-none hover:text-[var(--color-fg-muted)]"
							>
								{m.overview_network_group_container({ count: containerNet.length })}
							</summary>
							<ul class="mt-2.5 flex flex-col gap-2.5">
								{#each containerNet as n (n.interface)}
									{@render ifaceRow(n)}
								{/each}
							</ul>
						</details>
					{/if}
					{#if virtualNet.length > 0}
						<details class="mt-2">
							<summary
								class="cursor-pointer font-mono text-[10px] tracking-[0.08em] text-[var(--color-fg-subtle)] select-none hover:text-[var(--color-fg-muted)]"
							>
								{m.overview_network_group_virtual({ count: virtualNet.length })}
							</summary>
							<ul class="mt-2.5 flex flex-col gap-2.5">
								{#each virtualNet as n (n.interface)}
									{@render ifaceRow(n)}
								{/each}
							</ul>
						</details>
					{/if}
				{:else}
					<ul class="flex flex-col gap-3">
						{#each Array(4) as _, i (i)}
							<li class="flex items-center justify-between">
								<Skeleton class="h-3 w-20" />
								<div class="flex items-center gap-3">
									<Skeleton class="h-3 w-14" />
									<Skeleton class="h-3 w-14" />
								</div>
							</li>
						{/each}
					</ul>
				{/if}
			</Card>
		</div>
	</div>
{/if}

{#snippet cardHeader(title: string, psi: number | null | undefined)}
	<div class="mb-4 flex items-baseline justify-between gap-3">
		<p class="text-xs tracking-wide text-[var(--color-fg-muted)]">{title}</p>
		{#if psi != null}
			<span
				class={cn('font-mono text-[10px] tabular-nums', pressureColor(psi))}
				title={m.overview_psi_tooltip()}
			>
				{m.overview_psi_label()} {fmtPercent(psi, 1)}
			</span>
		{/if}
	</div>
{/snippet}

{#snippet ifaceRow(n: { interface: string; rx_bytes_per_sec: number; tx_bytes_per_sec: number; rx_bytes_total?: number; tx_bytes_total?: number })}
	<li class="flex items-center justify-between text-sm">
		<span class="flex min-w-0 items-center gap-2 text-[var(--color-fg-muted)]">
			<IfaceIcon name={n.interface} class="size-[12px] shrink-0 text-[var(--color-fg-subtle)]" />
			<span class="truncate font-mono text-xs">{n.interface}</span>
		</span>
		<span class="flex flex-col items-end gap-0.5 tabular-nums">
			<span class="flex items-center gap-3 text-xs">
				<span class="text-[var(--color-info)]" title={m.overview_iface_receive()}>↓ {fmtBps(n.rx_bytes_per_sec)}</span>
				<span class="text-[var(--color-success)]" title={m.overview_iface_transmit()}>↑ {fmtBps(n.tx_bytes_per_sec)}</span>
			</span>
			{#if n.rx_bytes_total !== undefined && n.tx_bytes_total !== undefined}
				<span class="flex items-center gap-3 text-[10px] text-[var(--color-fg-subtle)]">
					<span title="total received since boot">↓ {fmtBytes(n.rx_bytes_total)}</span>
					<span title="total transmitted since boot">↑ {fmtBytes(n.tx_bytes_total)}</span>
				</span>
			{/if}
		</span>
	</li>
{/snippet}

{#snippet diskRow(d: {
	mount_point: string;
	used_bytes: number;
	total_bytes: number;
	read_bytes_per_sec: number;
	write_bytes_per_sec: number;
})}
	{@const pct = diskPct(d.used_bytes, d.total_bytes)}
	<div>
		<div class="mb-1.5 flex flex-col gap-0.5 text-sm">
			<div class="flex items-baseline justify-between gap-2">
				<span class="flex min-w-0 items-center gap-2 text-[var(--color-fg)]" title={d.mount_point}>
					<MountIcon path={d.mount_point} class="size-[12px] shrink-0 text-[var(--color-fg-subtle)]" />
					<span class="truncate font-mono">{shortenMount(d.mount_point)}</span>
				</span>
				<span class="shrink-0 tabular-nums text-xs text-[var(--color-fg-muted)]">
					R {fmtBps(d.read_bytes_per_sec, 0)} · W {fmtBps(d.write_bytes_per_sec, 0)}
				</span>
			</div>
			<div class="flex items-baseline justify-between pl-[20px] text-xs tabular-nums text-[var(--color-fg-muted)]">
				<span class="font-medium text-[var(--color-fg)]">{fmtBytes(d.used_bytes)} / {fmtBytes(d.total_bytes)}</span>
				<span>{fmtPercent(pct, 0)}</span>
			</div>
		</div>
		<div class="h-1.5 overflow-hidden rounded-full bg-[var(--color-surface-3)]">
			<div
				class="h-full rounded-full transition-all"
				style="width: {Math.min(100, pct)}%; background: {pct > 90
					? 'var(--color-danger)'
					: pct > 75
						? 'var(--color-warning)'
						: 'var(--color-info)'};"
			></div>
		</div>
	</div>
{/snippet}

<style>
	.per-core-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(48px, 1fr));
		gap: 0.375rem;
	}
</style>
