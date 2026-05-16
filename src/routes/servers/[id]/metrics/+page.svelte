<script lang="ts">
	import { untrack } from 'svelte';
	import { page } from '$app/state';
	import Card from '$lib/components/ui/Card.svelte';
	import Skeleton from '$lib/components/ui/Skeleton.svelte';
	import HistoryChart, { type Series } from '$lib/components/charts/HistoryChart.svelte';
	import RangePicker, { type RefreshInterval } from '$lib/components/charts/RangePicker.svelte';
	import StatStrip from '$lib/components/charts/StatStrip.svelte';
	import { RANGE_SECONDS, type RangeKey } from '$lib/components/charts/range';
	import PressureCard from '$lib/components/metrics/PressureCard.svelte';
	import ComponentsCard from '$lib/components/metrics/ComponentsCard.svelte';
	import { profiles } from '$lib/stores/profiles.svelte';
	import { connections } from '$lib/stores/connections.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { ApiError } from '$lib/api/error';
	import { fmtBps, fmtNumber, fmtPercent } from '$lib/utils/format';
	import { cn } from '$lib/utils/cn';
	import { m } from '$lib/paraglide/messages';
	import {
		classifyInterface,
		isPhysicalInterface,
		isContainerMount,
		type IfaceClass
	} from '$lib/utils/netClassify';
	import type {
		ComponentsHistoryResponse,
		CpuHistoryResponse,
		DiskHistoryResponse,
		MemoryHistoryResponse,
		NetworkHistoryResponse,
		PressureHistoryResponse
	} from '$lib/types/api';

	let id = $derived(page.params.id ?? '');
	let profile = $derived(id ? profiles.byId(id) : undefined);
	let conn = $derived(profile ? connections.connect(profile) : null);

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

	let range = $state<RangeKey>('1h');
	let autoRefresh = $state<RefreshInterval>('off');
	let busy = $state(false);
	let lastFetched = $state<number | null>(null);
	let offsetSecs = $state(0);

	const REFRESH_MS: Record<RefreshInterval, number> = {
		off: 0,
		'15s': 15_000,
		'30s': 30_000,
		'60s': 60_000
	};

	$effect(() => {
		const ms = REFRESH_MS[autoRefresh];
		// Skip auto-refresh when panning to a past window — the window shouldn't shift on a timer.
		if (!conn?.isAuthenticated || ms === 0 || offsetSecs !== 0) return;
		const t = setInterval(() => {
			void fetchAll();
		}, ms);
		return () => clearInterval(t);
	});

	let cpu = $state<CpuHistoryResponse | null>(null);
	let memory = $state<MemoryHistoryResponse | null>(null);
	let disk = $state<DiskHistoryResponse | null>(null);
	let network = $state<NetworkHistoryResponse | null>(null);
	let pressureCpu = $state<PressureHistoryResponse | null>(null);
	let pressureMem = $state<PressureHistoryResponse | null>(null);
	let pressureIo = $state<PressureHistoryResponse | null>(null);
	let components = $state<ComponentsHistoryResponse | null>(null);
	let resolution = $state<string | null>(null);

	let cancelCtrl: AbortController | null = null;

	async function fetchAll() {
		if (!conn?.isAuthenticated) return;
		cancelCtrl?.abort();
		cancelCtrl = new AbortController();
		const span = RANGE_SECONDS[range];
		const end = Math.floor(Date.now() / 1000) - offsetSecs;
		const start = end - span;
		const q = { start, end };

		busy = true;
		try {
			const [batch, pc, pm, pi] = await Promise.all([
				conn.client.metricsBatch({ resources: 'cpu,memory,disk,network,components', ...q }),
				conn.client.pressureHistory('cpu', q).catch(() => null),
				conn.client.pressureHistory('memory', q).catch(() => null),
				conn.client.pressureHistory('io', q).catch(() => null)
			]);
			const res = batch.resolution;
			const cpuBatch   = batch.series.find(s => s.resource === 'cpu');
			const memBatch   = batch.series.find(s => s.resource === 'memory');
			const diskBatch  = batch.series.find(s => s.resource === 'disk');
			const netBatch   = batch.series.find(s => s.resource === 'network');
			const compBatch  = batch.series.find(s => s.resource === 'components');
			cpu        = cpuBatch  && cpuBatch.resource  === 'cpu'        ? { resolution: res, points: cpuBatch.points  } : null;
			memory     = memBatch  && memBatch.resource  === 'memory'     ? { resolution: res, points: memBatch.points  } : null;
			disk       = diskBatch && diskBatch.resource === 'disk'       ? { resolution: res, points: diskBatch.points } : null;
			network    = netBatch  && netBatch.resource  === 'network'    ? { resolution: res, points: netBatch.points  } : null;
			components = compBatch && compBatch.resource === 'components' ? { resolution: res, points: compBatch.points } : null;
			pressureCpu = pc;
			pressureMem = pm;
			pressureIo  = pi;
			resolution  = res;
			lastFetched = Date.now();
		} catch (e) {
			if (e instanceof ApiError) {
				toast.error(m.metrics_toast_fetch_failed(), { description: e.userMessage });
			}
		} finally {
			busy = false;
		}
	}

	$effect(() => {
		if (conn?.isAuthenticated) {
			void range;
			void offsetSecs;
			void profile?.id;
			fetchAll();
		}
	});

	function latestByKey<T extends { timestamp: number }>(
		points: T[] | undefined,
		key: (p: T) => string
	): Map<string, T> {
		const out = new Map<string, T>();
		if (!points) return out;
		for (const p of points) {
			const cur = out.get(key(p));
			if (!cur || p.timestamp > cur.timestamp) out.set(key(p), p);
		}
		return out;
	}

	function hasAny<T>(points: T[] | undefined, pick: (p: T) => number | null | undefined): boolean {
		if (!points) return false;
		for (const p of points) {
			const v = pick(p);
			if (v != null) return true;
		}
		return false;
	}

	const isPhysicalIface = isPhysicalInterface;
	const isDockerMount = isContainerMount;

	let cpuSeries = $derived.by((): Series[] => {
		if (!cpu) return [];
		const xs = cpu.points.map((p) => p.timestamp);
		const series: Series[] = [
			{
				name: m.metrics_series_usage(),
				data: { xs, ys: cpu.points.map((p) => p.usage_percent) },
				color: 'rgb(96, 165, 250)'
			}
		];
		if (hasAny(cpu.points, (p) => p.steal_percent)) {
			series.push({
				name: m.metrics_series_steal(),
				data: { xs, ys: cpu.points.map((p) => p.steal_percent ?? 0) },
				color: 'rgb(248, 113, 113)'
			});
		}
		if (hasAny(cpu.points, (p) => p.iowait_percent)) {
			series.push({
				name: m.metrics_series_iowait(),
				data: { xs, ys: cpu.points.map((p) => p.iowait_percent ?? 0) },
				color: 'rgb(251, 191, 36)'
			});
		}
		return series;
	});

	let memorySeries = $derived.by((): Series[] => {
		if (!memory) return [];
		const xs = memory.points.map((p) => p.timestamp);
		const ys = memory.points.map((p) => {
			const total = p.used_bytes + p.available_bytes;
			return total > 0 ? (p.used_bytes / total) * 100 : 0;
		});
		return [{ name: m.overview_card_memory_title(), data: { xs, ys }, color: 'rgb(167, 139, 250)' }];
	});

	let memoryPressureSeries = $derived.by((): Series[] => {
		if (!memory) return [];
		const xs = memory.points.map((p) => p.timestamp);
		const series: Series[] = [];
		if (hasAny(memory.points, (p) => p.page_faults_major_per_sec)) {
			series.push({
				name: m.metrics_series_major_faults(),
				data: { xs, ys: memory.points.map((p) => p.page_faults_major_per_sec ?? 0) },
				color: 'rgb(248, 113, 113)',
				fill: true
			});
		}
		if (hasAny(memory.points, (p) => p.swap_in_pages_per_sec)) {
			series.push({
				name: m.metrics_series_swap_in(),
				data: { xs, ys: memory.points.map((p) => p.swap_in_pages_per_sec ?? 0) },
				color: 'rgb(251, 113, 133)'
			});
		}
		if (hasAny(memory.points, (p) => p.swap_out_pages_per_sec)) {
			series.push({
				name: m.metrics_series_swap_out(),
				data: { xs, ys: memory.points.map((p) => p.swap_out_pages_per_sec ?? 0) },
				color: 'rgb(244, 114, 182)'
			});
		}
		return series;
	});

	const DISK_PALETTE = [
		'rgb(251, 191, 36)',
		'rgb(244, 114, 182)',
		'rgb(16, 185, 129)',
		'rgb(56, 189, 248)',
		'rgb(217, 70, 239)'
	];

	let diskSeries = $derived.by((): Series[] => {
		if (!disk) return [];
		const byMount = new Map<string, { xs: number[]; ys: number[] }>();
		for (const p of disk.points) {
			if (isDockerMount(p.mount_point)) continue;
			let s = byMount.get(p.mount_point);
			if (!s) {
				s = { xs: [], ys: [] };
				byMount.set(p.mount_point, s);
			}
			s.xs.push(p.timestamp);
			const total = p.used_bytes + p.available_bytes;
			s.ys.push(total > 0 ? (p.used_bytes / total) * 100 : 0);
		}
		return [...byMount.entries()].map(([name, data], i) => ({
			name,
			data,
			color: DISK_PALETTE[i % DISK_PALETTE.length]
		}));
	});

	let networkSeries = $derived.by((): Series[] => {
		if (!network) return [];
		// Physical interfaces only — veth pairs double-count bytes.
		const sums = new Map<number, { rx: number; tx: number }>();
		for (const p of network.points) {
			if (!isPhysicalIface(p.interface_name)) continue;
			let s = sums.get(p.timestamp);
			if (!s) {
				s = { rx: 0, tx: 0 };
				sums.set(p.timestamp, s);
			}
			s.rx += p.rx_bytes_per_sec;
			s.tx += p.tx_bytes_per_sec;
		}
		const xs = [...sums.keys()].sort((a, b) => a - b);
		const rx = xs.map((x) => sums.get(x)!.rx);
		const tx = xs.map((x) => sums.get(x)!.tx);
		return [
			{ name: 'RX', data: { xs, ys: rx }, color: 'rgb(96, 165, 250)', fill: true },
			{ name: 'TX', data: { xs, ys: tx }, color: 'rgb(52, 211, 153)', fill: true }
		];
	});

	let loading = $derived(cpu === null);

	let cpuKey = $derived(cpuSeries.map((s) => s.name).join('|'));
	let memoryKey = $derived(memorySeries.map((s) => s.name).join('|'));
	let memoryPressureKey = $derived(memoryPressureSeries.map((s) => s.name).join('|'));
	let diskKey = $derived(diskSeries.map((s) => s.name).join('|'));
	let networkKey = $derived(networkSeries.map((s) => s.name).join('|'));

	let lastCpu = $derived(
		cpu && cpu.points.length > 0 ? cpu.points[cpu.points.length - 1] : null
	);

	let hasKernelRateData = $derived(
		!!lastCpu && (lastCpu.context_switches_per_sec != null || lastCpu.process_forks_per_sec != null)
	);

	type InodeRow = { mount: string; pct: number; isDocker: boolean };
	let inodeRows = $derived.by((): InodeRow[] => {
		const latest = latestByKey(disk?.points, (p) => p.mount_point);
		const out: InodeRow[] = [];
		for (const [mount, p] of latest) {
			if (p.inode_used_percent != null)
				out.push({ mount, pct: p.inode_used_percent, isDocker: isDockerMount(mount) });
		}
		return out.sort((a, b) => b.pct - a.pct);
	});
	let mainInodeRows = $derived(inodeRows.filter((r) => !r.isDocker));
	let dockerInodeRows = $derived(inodeRows.filter((r) => r.isDocker));

	function shortenMount(path: string): string {
		const segs = path.split('/').filter(Boolean);
		const last = segs[segs.length - 1] ?? '';
		if (/^[a-f0-9]{32,}$/.test(last)) {
			const head = segs.slice(0, -1).join('/');
			return `/${head}/${last.slice(0, 12)}…`;
		}
		return path;
	}

	const classifyIface = classifyInterface;
	type NetErrRow = {
		iface: string;
		rxErr: number;
		txErr: number;
		rx: number;
		tx: number;
		klass: IfaceClass;
	};
	let netErrorRows = $derived.by((): NetErrRow[] => {
		const latest = latestByKey(network?.points, (p) => p.interface_name);
		const out: NetErrRow[] = [];
		for (const [iface, p] of latest) {
			out.push({
				iface,
				rxErr: p.errors_in_per_sec,
				txErr: p.errors_out_per_sec,
				rx: p.rx_bytes_per_sec,
				tx: p.tx_bytes_per_sec,
				klass: classifyIface(iface)
			});
		}
		// Sort: error-bearing interfaces first, then by total throughput.
		return out.sort((a, b) => {
			const aErr = a.rxErr + a.txErr;
			const bErr = b.rxErr + b.txErr;
			if (aErr !== bErr) return bErr - aErr;
			return b.rx + b.tx - (a.rx + a.tx);
		});
	});
	let physicalNetRows = $derived(netErrorRows.filter((r) => r.klass === 'physical'));
	let containerNetRows = $derived(netErrorRows.filter((r) => r.klass === 'container'));
	let virtualNetRows = $derived(netErrorRows.filter((r) => r.klass === 'virtual'));

	function fmtPct(v: number | null): string {
		if (v == null) return '—';
		return fmtPercent(v, 1);
	}
	function fmtBpsCell(v: number | null): string {
		if (v == null) return '—';
		return fmtBps(v, 1);
	}
	function fmtRate(v: number | null): string {
		if (v == null) return '—';
		return `${fmtNumber(v, 0)}/s`;
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
	function inodeColor(p: number): string {
		if (p >= 90) return 'bg-[var(--color-danger)]';
		if (p >= 75) return 'bg-[var(--color-warning)]';
		return 'bg-[var(--color-info)]';
	}
</script>

{#if profile}
	<div class="px-4 py-6 md:px-8 md:py-8">
		<header class="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
			<div>
				<h1 class="text-[24px] font-semibold tracking-tight">{m.section_metrics()}</h1>
				<p class="mt-1.5 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[14px] text-[var(--color-fg-muted)]">
					<span>{m.metrics_page_subtitle()}</span>
					{#if resolution}
						<span
							class="rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-0.5 font-mono text-[11px] tracking-[0.06em] text-[var(--color-fg-muted)]"
						>
							{m.metrics_resolution_label({ value: resolution })}
						</span>
					{/if}
					{#if lastFetched}
						<span class="text-[12px] text-[var(--color-fg-subtle)]">
							{m.metrics_updated_at({ time: new Date(lastFetched).toLocaleTimeString() })}
						</span>
					{/if}
				</p>
			</div>
			<RangePicker
				value={range}
				onSelect={(k) => (range = k)}
				onRefresh={fetchAll}
				{busy}
				{autoRefresh}
				onAutoRefreshChange={(i) => (autoRefresh = i)}
				{offsetSecs}
				onShift={(d) => (offsetSecs = Math.max(0, offsetSecs - d))}
				onResetNow={() => (offsetSecs = 0)}
			/>
		</header>

		{#if !conn?.isAuthenticated}
			<Card padding="lg" class="border-[var(--color-warning)]/30">
				<p class="text-sm text-[var(--color-fg-muted)]">
					{m.metrics_signin_required()}
				</p>
			</Card>
		{:else}
			<div class="grid grid-cols-1 gap-4 xl:grid-cols-2">
				<Card>
					<div class="mb-3 flex items-center justify-between gap-3">
						<h2 class="text-sm font-medium text-[var(--color-fg)]">{m.metrics_card_cpu_title()}</h2>
					</div>
					{#if loading}
						{@render chartSkeleton()}
					{:else}
						{#if cpuSeries.length > 0}
							<StatStrip data={cpuSeries[0].data} format={fmtPct} accent={cpuSeries[0].color} class="mb-3" />
						{/if}
						{#key cpuKey}
							<HistoryChart series={cpuSeries} valueFormatter={fmtPct} yMin={0} yMax={100} group="metrics" />
						{/key}
						{#if hasKernelRateData && lastCpu}
							<div class="mt-3 flex items-center justify-end gap-4 border-t border-[var(--color-border)] pt-2.5 font-mono text-[11px] tabular-nums text-[var(--color-fg-muted)]">
								{#if lastCpu.context_switches_per_sec != null}
									<span>
										<span class="text-[var(--color-fg-subtle)]">{m.metrics_kernel_ctx_label()}</span>
										{fmtRate(lastCpu.context_switches_per_sec)}
									</span>
								{/if}
								{#if lastCpu.process_forks_per_sec != null}
									<span>
										<span class="text-[var(--color-fg-subtle)]">{m.metrics_kernel_forks_label()}</span>
										{fmtRate(lastCpu.process_forks_per_sec)}
									</span>
								{/if}
							</div>
						{/if}
					{/if}
				</Card>

				<Card>
					<div class="mb-3 flex items-center justify-between gap-3">
						<h2 class="text-sm font-medium text-[var(--color-fg)]">{m.metrics_card_memory_title()}</h2>
					</div>
					{#if loading}
						{@render chartSkeleton()}
					{:else}
						{#if memorySeries.length > 0}
							<StatStrip data={memorySeries[0].data} format={fmtPct} accent={memorySeries[0].color} class="mb-3" />
						{/if}
						{#key memoryKey}
							<HistoryChart series={memorySeries} valueFormatter={fmtPct} yMin={0} yMax={100} group="metrics" />
						{/key}
					{/if}
				</Card>

				<Card>
					<div class="mb-3 flex items-center justify-between gap-3">
						<h2 class="text-sm font-medium text-[var(--color-fg)]">{m.metrics_card_disk_title()}</h2>
					</div>
					{#if loading}
						{@render chartSkeleton()}
					{:else}
						{#key diskKey}
							<HistoryChart series={diskSeries} valueFormatter={fmtPct} yMin={0} yMax={100} group="metrics" />
						{/key}

					{#if inodeRows.length > 0}
						<div class="mt-4 border-t border-[var(--color-border)] pt-4">
							<p class="mb-2 text-[10px] tracking-wide text-[var(--color-fg-muted)]">
								{m.metrics_inode_usage_label()}
							</p>
							<ul class="flex flex-col gap-2">
								{#each mainInodeRows as r (r.mount)}
									{@render inodeRow(r)}
								{/each}
							</ul>
							{#if dockerInodeRows.length > 0}
								<details class="mt-3 border-t border-[var(--color-border)] pt-3">
									<summary
										class="cursor-pointer font-mono text-[10px] tracking-[0.08em] text-[var(--color-fg-subtle)] select-none hover:text-[var(--color-fg-muted)]"
									>
										{m.metrics_container_layers_label({ count: dockerInodeRows.length })}
									</summary>
									<ul class="mt-2 flex flex-col gap-2">
										{#each dockerInodeRows as r (r.mount)}
											{@render inodeRow(r)}
										{/each}
									</ul>
								</details>
							{/if}
						</div>
					{/if}
					{/if}
				</Card>

				<Card>
					<div class="mb-3 flex items-center justify-between gap-3">
						<h2 class="text-sm font-medium text-[var(--color-fg)]">{m.metrics_card_network_title()}</h2>
					</div>
					{#if loading}
						{@render chartSkeleton()}
					{:else}
					{#if networkSeries.length > 0}
						<div class="mb-3 grid grid-cols-1 gap-y-2 sm:grid-cols-2">
							{#each networkSeries as s (s.name)}
								<div>
									<p class="mb-0.5 text-[10px] tracking-[0.08em] text-[var(--color-fg-subtle)]" style="color: {s.color}">
										{s.name}
									</p>
									<StatStrip data={s.data} format={fmtBpsCell} />
								</div>
							{/each}
						</div>
					{/if}
					{#key networkKey}
						<HistoryChart series={networkSeries} valueFormatter={fmtBpsCell} group="metrics" />
					{/key}

					{#if netErrorRows.length > 0}
						<div class="mt-4 border-t border-[var(--color-border)] pt-4">
							<p class="mb-2 text-[10px] tracking-wide text-[var(--color-fg-muted)]">
								{m.metrics_per_interface_latest_label()}
							</p>
							<ul class="flex flex-col gap-1.5">
								{#each physicalNetRows as r (r.iface)}
									{@render ifaceRow(r)}
								{/each}
							</ul>
							{#if containerNetRows.length > 0}
								<details class="mt-3 border-t border-[var(--color-border)] pt-3">
									<summary
										class="cursor-pointer font-mono text-[10px] tracking-[0.08em] text-[var(--color-fg-subtle)] select-none hover:text-[var(--color-fg-muted)]"
									>
										{m.metrics_iface_group_container({ count: containerNetRows.length })}
									</summary>
									<ul class="mt-2 flex flex-col gap-1.5">
										{#each containerNetRows as r (r.iface)}
											{@render ifaceRow(r)}
										{/each}
									</ul>
								</details>
							{/if}
							{#if virtualNetRows.length > 0}
								<details class="mt-2">
									<summary
										class="cursor-pointer font-mono text-[10px] tracking-[0.08em] text-[var(--color-fg-subtle)] select-none hover:text-[var(--color-fg-muted)]"
									>
										{m.metrics_iface_group_virtual({ count: virtualNetRows.length })}
									</summary>
									<ul class="mt-2 flex flex-col gap-1.5">
										{#each virtualNetRows as r (r.iface)}
											{@render ifaceRow(r)}
										{/each}
									</ul>
								</details>
							{/if}
						</div>
					{/if}
					{/if}
				</Card>

				<PressureCard cpu={pressureCpu} memory={pressureMem} io={pressureIo} />

				{#if components && components.points.length > 0}
					<ComponentsCard data={components} />
				{/if}

				{#if memoryPressureSeries.length > 0}
					<Card class="xl:col-span-2">
						<div class="mb-3 flex items-center justify-between">
							<div>
								<h2 class="text-sm font-medium text-[var(--color-fg)]">{m.metrics_card_memory_pressure_title()}</h2>
								<p class="mt-0.5 text-xs text-[var(--color-fg-muted)]">
									{m.metrics_card_memory_pressure_subtitle()}
								</p>
							</div>
						</div>
						{#key memoryPressureKey}
							<HistoryChart
								series={memoryPressureSeries}
								valueFormatter={(v) => (v == null ? '—' : fmtNumber(v, 0))}
								group="metrics"
							/>
						{/key}
					</Card>
				{/if}
			</div>

		{/if}
	</div>
{/if}

{#snippet chartSkeleton()}
	<div class="mb-3 flex gap-4">
		{#each [80, 64, 56, 56, 64] as w}
			<div class="flex flex-col gap-1.5">
				<Skeleton class="h-2.5" style="width: {w}px" />
				<Skeleton class="h-3.5" style="width: {w}px" />
			</div>
		{/each}
	</div>
	<Skeleton class="h-[280px]" rounded="lg" />
{/snippet}

{#snippet inodeRow(r: InodeRow)}
	<li class="text-sm">
		<div class="flex items-baseline justify-between gap-3">
			<span class="truncate font-mono text-xs text-[var(--color-fg-muted)]" title={r.mount}>
				{shortenMount(r.mount)}
			</span>
			<span class="font-mono text-xs tabular-nums">{fmtPct(r.pct)}</span>
		</div>
		<div class="mt-1 h-1 overflow-hidden rounded-full bg-[var(--color-surface-3)]">
			<div
				class={cn('h-full rounded-full transition-all', inodeColor(r.pct))}
				style="width: {Math.min(100, r.pct)}%"
			></div>
		</div>
	</li>
{/snippet}

{#snippet ifaceRow(r: NetErrRow)}
	{@const hasErr = r.rxErr > 0 || r.txErr > 0}
	<li
		class={cn(
			'flex items-center justify-between gap-3 rounded-md px-2 py-1.5 text-xs',
			hasErr && 'bg-[var(--color-danger)]/10'
		)}
	>
		<span class="truncate font-mono text-[var(--color-fg-muted)]">{r.iface}</span>
		<div class="flex items-center gap-3 tabular-nums">
			<span class="text-[var(--color-info)]">↓ {fmtBpsCell(r.rx)}</span>
			<span class="text-[var(--color-success)]">↑ {fmtBpsCell(r.tx)}</span>
			{#if hasErr}
				<span class="text-[var(--color-danger)]">
					{m.metrics_iface_errors({ rx: r.rxErr, tx: r.txErr })}
				</span>
			{/if}
		</div>
	</li>
{/snippet}
