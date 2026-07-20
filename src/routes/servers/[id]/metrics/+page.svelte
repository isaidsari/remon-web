<script lang="ts">
	import { untrack } from 'svelte';
	import { page } from '$app/state';
	import Card from '$lib/components/ui/Card.svelte';
	import Skeleton from '$lib/components/ui/Skeleton.svelte';
	import HistoryChart, {
		type Series,
		type ChartAnnotation
	} from '$lib/components/charts/HistoryChart.svelte';
	import RangePicker, { type RefreshInterval } from '$lib/components/charts/RangePicker.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import IconHistory from '~icons/lucide/history';
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
		EventDto,
		MemoryHistoryResponse,
		NetworkHistoryResponse,
		PressureHistoryResponse,
		SmartResponse
	} from '$lib/types/api';

	let id = $derived(page.params.id ?? '');
	let profile = $derived(id ? profiles.byId(id) : undefined);
	let conn = $derived(profile ? connections.connect(profile) : null);

	$effect(() => {
		if (!conn) return;
		untrack(() => {
			conn.ensureSignedIn().catch((e) => {
				if (e instanceof ApiError) {
					toast.error(m.overview_toast_signin_failed(), {
						description: e.userMessage
					});
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
	let events = $state<EventDto[]>([]);
	let showAnnotations = $state(true);
	let queryEnd = $state(0);
	let smart = $state<SmartResponse | null>(null);

	let cancelCtrl: AbortController | null = null;

	async function fetchAll() {
		if (!conn?.isAuthenticated) return;
		cancelCtrl?.abort();
		cancelCtrl = new AbortController();
		const span = RANGE_SECONDS[range];
		const end = Math.floor(Date.now() / 1000) - offsetSecs;
		const start = end - span;
		const q = { start, end };
		queryEnd = end;

		busy = true;
		try {
			const [batch, pc, pm, pi, ev] = await Promise.all([
				conn.client.metricsBatch({
					resources: 'cpu,memory,disk,network,components',
					...q
				}),
				conn.client.pressureHistory('cpu', q).catch(() => null),
				conn.client.pressureHistory('memory', q).catch(() => null),
				conn.client.pressureHistory('io', q).catch(() => null),
				conn.client
					.events({ ...q, limit: 500 })
					.then((r) => r.events)
					.catch(() => [])
			]);
			const res = batch.resolution;
			const cpuBatch = batch.series.find((s) => s.resource === 'cpu');
			const memBatch = batch.series.find((s) => s.resource === 'memory');
			const diskBatch = batch.series.find((s) => s.resource === 'disk');
			const netBatch = batch.series.find((s) => s.resource === 'network');
			const compBatch = batch.series.find((s) => s.resource === 'components');
			cpu =
				cpuBatch && cpuBatch.resource === 'cpu'
					? { resolution: res, points: cpuBatch.points }
					: null;
			memory =
				memBatch && memBatch.resource === 'memory'
					? { resolution: res, points: memBatch.points }
					: null;
			disk =
				diskBatch && diskBatch.resource === 'disk'
					? { resolution: res, points: diskBatch.points }
					: null;
			network =
				netBatch && netBatch.resource === 'network'
					? { resolution: res, points: netBatch.points }
					: null;
			components =
				compBatch && compBatch.resource === 'components'
					? { resolution: res, points: compBatch.points }
					: null;
			pressureCpu = pc;
			pressureMem = pm;
			pressureIo = pi;
			events = ev;
			resolution = res;
			lastFetched = Date.now();
		} catch (e) {
			if (e instanceof ApiError) {
				toast.error(m.metrics_toast_fetch_failed(), {
					description: e.userMessage
				});
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

	$effect(() => {
		if (!conn?.isAuthenticated || smart !== null) return;
		conn.client
			.systemSmart()
			.then((r) => (smart = r))
			.catch(() => null);
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
		if (hasAny(cpu.points, (p) => p.user_percent)) {
			series.push({
				name: m.metrics_series_user(),
				data: { xs, ys: cpu.points.map((p) => p.user_percent ?? 0) },
				color: 'rgb(52, 211, 153)'
			});
		}
		if (hasAny(cpu.points, (p) => p.system_percent)) {
			series.push({
				name: m.metrics_series_system(),
				data: { xs, ys: cpu.points.map((p) => p.system_percent ?? 0) },
				color: 'rgb(192, 132, 252)'
			});
		}
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
		return [
			{
				name: m.overview_card_memory_title(),
				data: { xs, ys },
				color: 'rgb(167, 139, 250)'
			}
		];
	});

	let memoryPressureSeries = $derived.by((): Series[] => {
		if (!memory) return [];
		const xs = memory.points.map((p) => p.timestamp);
		const series: Series[] = [];
		if (hasAny(memory.points, (p) => p.page_faults_major_per_sec)) {
			series.push({
				name: m.metrics_series_major_faults(),
				data: {
					xs,
					ys: memory.points.map((p) => p.page_faults_major_per_sec ?? 0)
				},
				color: 'rgb(248, 113, 113)',
				fill: true
			});
		}
		if (hasAny(memory.points, (p) => p.swap_in_pages_per_sec)) {
			series.push({
				name: m.metrics_series_swap_in(),
				data: {
					xs,
					ys: memory.points.map((p) => p.swap_in_pages_per_sec ?? 0)
				},
				color: 'rgb(251, 113, 133)'
			});
		}
		if (hasAny(memory.points, (p) => p.swap_out_pages_per_sec)) {
			series.push({
				name: m.metrics_series_swap_out(),
				data: {
					xs,
					ys: memory.points.map((p) => p.swap_out_pages_per_sec ?? 0)
				},
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

	let diskIopsSeries = $derived.by((): Series[] => {
		if (!disk) return [];
		const readByTs = new Map<number, number>();
		const writeByTs = new Map<number, number>();
		for (const p of disk.points) {
			if (isDockerMount(p.mount_point)) continue;
			if (p.read_iops != null)
				readByTs.set(p.timestamp, (readByTs.get(p.timestamp) ?? 0) + p.read_iops);
			if (p.write_iops != null)
				writeByTs.set(p.timestamp, (writeByTs.get(p.timestamp) ?? 0) + p.write_iops);
		}
		if (readByTs.size === 0) return [];
		const xs = [...readByTs.keys()].sort((a, b) => a - b);
		return [
			{
				name: m.metrics_series_read_iops(),
				data: { xs, ys: xs.map((x) => readByTs.get(x) ?? 0) },
				color: 'rgb(251, 191, 36)'
			},
			{
				name: m.metrics_series_write_iops(),
				data: { xs, ys: xs.map((x) => writeByTs.get(x) ?? 0) },
				color: 'rgb(244, 114, 182)'
			}
		];
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
			{
				name: 'RX',
				data: { xs, ys: rx },
				color: 'rgb(96, 165, 250)',
				fill: true
			},
			{
				name: 'TX',
				data: { xs, ys: tx },
				color: 'rgb(52, 211, 153)',
				fill: true
			}
		];
	});

	let loading = $derived(cpu === null);

	// Host-event overlay for the primary charts: alert fired→resolved pairs
	// become shaded bands, every other kind becomes a dashed instant line.
	// Shown identically across cpu/memory/disk/network — correlation is the
	// point ("did an OOM kill line up with that memory chart?"), and the
	// reader can tell at a glance which chart's own series moved.
	let chartAnnotations = $derived.by((): ChartAnnotation[] => {
		const alertKey = (e: EventDto) =>
			e.ref
				? `${e.ref.type}:${e.ref.id}:${(e.details?.label_set as string | undefined) ?? ''}`
				: '';

		const fired = events.filter((e) => e.kind === 'alert_fired').sort((a, b) => a.ts - b.ts);
		const resolved = events.filter((e) => e.kind === 'alert_resolved').sort((a, b) => a.ts - b.ts);
		const resolvedByKey = new Map<string, EventDto[]>();
		for (const r of resolved) {
			const k = alertKey(r);
			const arr = resolvedByKey.get(k);
			if (arr) arr.push(r);
			else resolvedByKey.set(k, [r]);
		}

		const bands: ChartAnnotation[] = fired.map((f) => {
			const k = alertKey(f);
			// First not-yet-consumed resolve after this fire, same rule+labels.
			const candidates = resolvedByKey.get(k) ?? [];
			const idx = candidates.findIndex((r) => r.ts >= f.ts);
			const match = idx >= 0 ? candidates.splice(idx, 1)[0] : undefined;
			return {
				ts: f.ts,
				// Still firing at the window edge → band runs to "now" (the
				// query's end), reading as an open-ended, ongoing condition.
				endTs: match ? match.ts : queryEnd,
				label: f.message,
				severity: f.severity
			};
		});

		const instants: ChartAnnotation[] = events
			.filter((e) => e.kind !== 'alert_fired' && e.kind !== 'alert_resolved')
			.map((e) => ({
				ts: e.ts,
				label: e.message,
				severity: e.severity
			}));

		return [...bands, ...instants];
	});

	let cpuKey = $derived(cpuSeries.map((s) => s.name).join('|'));
	let memoryKey = $derived(memorySeries.map((s) => s.name).join('|'));
	let memoryPressureKey = $derived(memoryPressureSeries.map((s) => s.name).join('|'));
	let diskKey = $derived(diskSeries.map((s) => s.name).join('|'));
	let diskIopsKey = $derived(diskIopsSeries.map((s) => s.name).join('|'));
	let networkKey = $derived(networkSeries.map((s) => s.name).join('|'));

	let lastCpu = $derived(cpu && cpu.points.length > 0 ? cpu.points[cpu.points.length - 1] : null);

	let hasKernelRateData = $derived(
		!!lastCpu && (lastCpu.context_switches_per_sec != null || lastCpu.process_forks_per_sec != null)
	);

	type InodeRow = { mount: string; pct: number; isDocker: boolean };
	let inodeRows = $derived.by((): InodeRow[] => {
		const latest = latestByKey(disk?.points, (p) => p.mount_point);
		const out: InodeRow[] = [];
		for (const [mount, p] of latest) {
			if (p.inode_used_percent != null)
				out.push({
					mount,
					pct: p.inode_used_percent,
					isDocker: isDockerMount(mount)
				});
		}
		return out.sort((a, b) => b.pct - a.pct);
	});
	let mainInodeRows = $derived(inodeRows.filter((r) => !r.isDocker));
	let dockerInodeRows = $derived(inodeRows.filter((r) => r.isDocker));

	type IoUtilRow = {
		mount: string;
		readIops: number;
		writeIops: number;
		util: number;
		isDocker: boolean;
	};
	let ioUtilRows = $derived.by((): IoUtilRow[] => {
		const latest = latestByKey(disk?.points, (p) => p.mount_point);
		const out: IoUtilRow[] = [];
		for (const [mount, p] of latest) {
			if (p.io_util_percent != null)
				out.push({
					mount,
					readIops: p.read_iops ?? 0,
					writeIops: p.write_iops ?? 0,
					util: p.io_util_percent,
					isDocker: isDockerMount(mount)
				});
		}
		return out.filter((r) => !r.isDocker).sort((a, b) => b.util - a.util);
	});

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

	function inodeColor(p: number): string {
		if (p >= 90) return 'bg-[var(--color-danger)]';
		if (p >= 75) return 'bg-[var(--color-warning)]';
		return 'bg-[var(--color-info)]';
	}
</script>

{#if profile}
	<div class="px-4 py-6 md:px-8 md:py-8">
		<header class="mb-6 flex flex-col gap-4 lg:mb-8 lg:flex-row lg:items-start lg:justify-between">
			<div class="min-w-0">
				<h1 class="text-[24px] font-semibold tracking-tight">
					{m.section_metrics()}
				</h1>
				<p class="mt-1.5 max-w-2xl text-[14px] leading-6 text-[var(--color-fg-muted)]">
					{m.metrics_page_subtitle()}
				</p>
			</div>
			<div class="flex flex-col gap-2 lg:items-end">
				<div class="flex items-center gap-2">
					<Button
						variant={showAnnotations ? 'secondary' : 'ghost'}
						size="sm"
						aria-pressed={showAnnotations}
						title={m.metrics_annotations_toggle_hint()}
						onclick={() => (showAnnotations = !showAnnotations)}
					>
						<IconHistory class="size-3.5" stroke-width="2" />
						{m.metrics_annotations_toggle()}
					</Button>
					<RangePicker
						class="lg:w-auto lg:justify-end"
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
				</div>
				<div
					class="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] tabular-nums text-[var(--color-fg-subtle)] lg:justify-end"
				>
					{#if resolution}
						<span>
							{m.metrics_resolution_label({ value: resolution })}
						</span>
					{/if}
					{#if lastFetched}
						<span>
							{m.metrics_updated_at({
								time: new Date(lastFetched).toLocaleTimeString()
							})}
						</span>
					{/if}
				</div>
			</div>
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
						<h2 class="text-sm font-medium text-[var(--color-fg)]">
							{m.metrics_card_cpu_title()}
						</h2>
					</div>
					{#if loading}
						{@render chartSkeleton()}
					{:else}
						{#if cpuSeries.length > 0}
							<StatStrip
								data={cpuSeries[0].data}
								format={fmtPct}
								accent={cpuSeries[0].color}
								class="mb-3"
							/>
						{/if}
						{#key cpuKey}
							<HistoryChart
								series={cpuSeries}
								valueFormatter={fmtPct}
								yMin={0}
								yMax={100}
								group="metrics"
								annotations={showAnnotations ? chartAnnotations : []}
							/>
						{/key}
						{#if hasKernelRateData && lastCpu}
							<div
								class="mt-3 flex items-center justify-end gap-4 border-t border-[var(--color-border)] pt-2.5 font-mono text-[11px] tabular-nums text-[var(--color-fg-muted)]"
							>
								{#if lastCpu.context_switches_per_sec != null}
									<span>
										<span class="text-[var(--color-fg-subtle)]">{m.metrics_kernel_ctx_label()}</span
										>
										{fmtRate(lastCpu.context_switches_per_sec)}
									</span>
								{/if}
								{#if lastCpu.process_forks_per_sec != null}
									<span>
										<span class="text-[var(--color-fg-subtle)]"
											>{m.metrics_kernel_forks_label()}</span
										>
										{fmtRate(lastCpu.process_forks_per_sec)}
									</span>
								{/if}
							</div>
						{/if}
					{/if}
				</Card>

				<Card>
					<div class="mb-3 flex items-center justify-between gap-3">
						<h2 class="text-sm font-medium text-[var(--color-fg)]">
							{m.metrics_card_memory_title()}
						</h2>
					</div>
					{#if loading}
						{@render chartSkeleton()}
					{:else}
						{#if memorySeries.length > 0}
							<StatStrip
								data={memorySeries[0].data}
								format={fmtPct}
								accent={memorySeries[0].color}
								class="mb-3"
							/>
						{/if}
						{#key memoryKey}
							<HistoryChart
								series={memorySeries}
								valueFormatter={fmtPct}
								yMin={0}
								yMax={100}
								group="metrics"
								annotations={showAnnotations ? chartAnnotations : []}
							/>
						{/key}
					{/if}
				</Card>

				<Card>
					<div class="mb-3 flex items-center justify-between gap-3">
						<h2 class="text-sm font-medium text-[var(--color-fg)]">
							{m.metrics_card_disk_title()}
						</h2>
					</div>
					{#if loading}
						{@render chartSkeleton()}
					{:else}
						{#key diskKey}
							<HistoryChart
								series={diskSeries}
								valueFormatter={fmtPct}
								yMin={0}
								yMax={100}
								group="metrics"
								annotations={showAnnotations ? chartAnnotations : []}
							/>
						{/key}

						{#if diskIopsSeries.length > 0}
							<div class="mt-4 border-t border-[var(--color-border)] pt-4">
								<p class="mb-2 text-[10px] tracking-wide text-[var(--color-fg-muted)]">
									{m.metrics_disk_iops_label()}
								</p>
								<div class="mb-3 grid grid-cols-1 gap-y-2 sm:grid-cols-2">
									{#each diskIopsSeries as s (s.name)}
										<div>
											<p class="mb-0.5 text-[10px] tracking-[0.08em]" style="color: {s.color}">
												{s.name}
											</p>
											<StatStrip
												data={s.data}
												format={(v) => (v == null ? '—' : `${fmtNumber(v, 0)}/s`)}
											/>
										</div>
									{/each}
								</div>
								{#key diskIopsKey}
									<HistoryChart
										series={diskIopsSeries}
										valueFormatter={(v) => (v == null ? '—' : `${fmtNumber(v, 0)}/s`)}
										group="metrics"
									/>
								{/key}
								{#if ioUtilRows.length > 0}
									<div class="mt-3 border-t border-[var(--color-border)] pt-3">
										<p class="mb-2 text-[10px] tracking-wide text-[var(--color-fg-muted)]">
											{m.metrics_disk_util_label()}
										</p>
										<ul class="flex flex-col gap-1.5">
											{#each ioUtilRows as r (r.mount)}
												<li
													class="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 text-xs"
												>
													<span
														class="truncate font-mono text-[var(--color-fg-muted)]"
														title={r.mount}
													>
														{shortenMount(r.mount)}
													</span>
													<div
														class="flex items-center gap-3 tabular-nums text-[var(--color-fg-subtle)]"
													>
														<span class="text-[rgb(251,191,36)]">↓ {fmtRate(r.readIops)}</span>
														<span class="text-[rgb(244,114,182)]">↑ {fmtRate(r.writeIops)}</span>
														<span
															class={r.util >= 80
																? 'text-[var(--color-danger)]'
																: r.util >= 50
																	? 'text-[var(--color-warning)]'
																	: ''}
														>
															{fmtPct(r.util)}
														</span>
													</div>
												</li>
											{/each}
										</ul>
									</div>
								{/if}
							</div>
						{/if}

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
											{m.metrics_container_layers_label({
												count: dockerInodeRows.length
											})}
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
						<h2 class="text-sm font-medium text-[var(--color-fg)]">
							{m.metrics_card_network_title()}
						</h2>
					</div>
					{#if loading}
						{@render chartSkeleton()}
					{:else}
						{#if networkSeries.length > 0}
							<div class="mb-3 grid grid-cols-1 gap-y-2 sm:grid-cols-2">
								{#each networkSeries as s (s.name)}
									<div>
										<p
											class="mb-0.5 text-[10px] tracking-[0.08em] text-[var(--color-fg-subtle)]"
											style="color: {s.color}"
										>
											{s.name}
										</p>
										<StatStrip data={s.data} format={fmtBpsCell} />
									</div>
								{/each}
							</div>
						{/if}
						{#key networkKey}
							<HistoryChart
								series={networkSeries}
								valueFormatter={fmtBpsCell}
								group="metrics"
								annotations={showAnnotations ? chartAnnotations : []}
							/>
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
											{m.metrics_iface_group_container({
												count: containerNetRows.length
											})}
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
											{m.metrics_iface_group_virtual({
												count: virtualNetRows.length
											})}
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

				{#if smart !== null}
					<Card class="xl:col-span-2" padding="none">
						<div class="px-4 py-3 border-b border-[var(--color-border)]">
							<h2 class="text-sm font-medium text-[var(--color-fg)]">
								{m.metrics_smart_title()}
							</h2>
						</div>
						{#if !smart.available}
							<p class="px-4 py-4 text-sm text-[var(--color-fg-muted)]">
								{m.metrics_smart_unavailable()}
							</p>
						{:else if smart.devices.length === 0}
							<p class="px-4 py-4 text-sm text-[var(--color-fg-subtle)]">
								{m.metrics_smart_no_devices()}
							</p>
						{:else}
							{@const isNvme = smart.devices.some(
								(d) => d.percentage_used != null || d.available_spare_percent != null
							)}
							{@const isAta = smart.devices.some((d) => d.reallocated_sectors != null)}
							<div class="overflow-x-auto">
								<table class="w-full text-sm">
									<thead
										class="bg-[var(--color-surface-2)] text-xs tracking-wide text-[var(--color-fg-muted)]"
									>
										<tr>
											<th class="px-3 py-2 text-left font-medium">{m.metrics_smart_col_device()}</th
											>
											<th class="px-3 py-2 text-left font-medium">{m.metrics_smart_col_model()}</th>
											<th class="px-3 py-2 text-left font-medium">{m.metrics_smart_col_health()}</th
											>
											<th class="px-3 py-2 text-right font-medium">{m.metrics_smart_col_temp()}</th>
											<th class="px-3 py-2 text-right font-medium">{m.metrics_smart_col_hours()}</th
											>
											{#if isAta}
												<th class="px-3 py-2 text-right font-medium"
													>{m.metrics_smart_col_reallocated()}</th
												>
												<th class="px-3 py-2 text-right font-medium"
													>{m.metrics_smart_col_pending()}</th
												>
												<th class="px-3 py-2 text-right font-medium"
													>{m.metrics_smart_col_uncorrectable()}</th
												>
											{/if}
											{#if isNvme}
												<th class="px-3 py-2 text-right font-medium"
													>{m.metrics_smart_col_nvme_used()}</th
												>
												<th class="px-3 py-2 text-right font-medium"
													>{m.metrics_smart_col_spare()}</th
												>
												<th class="px-3 py-2 text-right font-medium"
													>{m.metrics_smart_col_media_errors()}</th
												>
											{/if}
										</tr>
									</thead>
									<tbody>
										{#each smart.devices as dev (dev.device)}
											{@const failed = dev.health_passed === false}
											<tr
												class={cn(
													'border-t border-[var(--color-border)]',
													failed && 'bg-[var(--color-danger)]/5'
												)}
											>
												<td class="px-3 py-2.5 font-mono text-xs text-[var(--color-fg)]"
													>{dev.device}</td
												>
												<td class="px-3 py-2.5 text-xs text-[var(--color-fg-muted)]"
													>{dev.model ?? '—'}</td
												>
												<td class="px-3 py-2.5">
													{#if dev.health_passed === true}
														<span
															class="inline-flex items-center rounded-full bg-[var(--color-success)]/10 px-2 py-0.5 font-mono text-[10px] text-[var(--color-success)]"
														>
															{m.metrics_smart_health_passed()}
														</span>
													{:else if dev.health_passed === false}
														<span
															class="inline-flex items-center rounded-full bg-[var(--color-danger)]/10 px-2 py-0.5 font-mono text-[10px] font-medium text-[var(--color-danger)]"
														>
															{m.metrics_smart_health_failed()}
														</span>
													{:else}
														<span class="font-mono text-[11px] text-[var(--color-fg-subtle)]"
															>{m.metrics_smart_health_unknown()}</span
														>
													{/if}
												</td>
												<td class="px-3 py-2.5 text-right font-mono text-xs tabular-nums">
													{dev.temperature_c != null ? `${dev.temperature_c.toFixed(0)} °C` : '—'}
												</td>
												<td
													class="px-3 py-2.5 text-right font-mono text-xs tabular-nums text-[var(--color-fg-muted)]"
												>
													{dev.power_on_hours != null
														? `${dev.power_on_hours.toLocaleString()} h`
														: '—'}
												</td>
												{#if isAta}
													<td
														class={cn(
															'px-3 py-2.5 text-right font-mono text-xs tabular-nums',
															(dev.reallocated_sectors ?? 0) > 0 && 'text-[var(--color-warning)]'
														)}
													>
														{dev.reallocated_sectors ?? '—'}
													</td>
													<td
														class={cn(
															'px-3 py-2.5 text-right font-mono text-xs tabular-nums',
															(dev.pending_sectors ?? 0) > 0 && 'text-[var(--color-warning)]'
														)}
													>
														{dev.pending_sectors ?? '—'}
													</td>
													<td
														class={cn(
															'px-3 py-2.5 text-right font-mono text-xs tabular-nums',
															(dev.uncorrectable_sectors ?? 0) > 0 && 'text-[var(--color-danger)]'
														)}
													>
														{dev.uncorrectable_sectors ?? '—'}
													</td>
												{/if}
												{#if isNvme}
													<td
														class={cn(
															'px-3 py-2.5 text-right font-mono text-xs tabular-nums',
															(dev.percentage_used ?? 0) >= 90 && 'text-[var(--color-warning)]'
														)}
													>
														{dev.percentage_used != null ? `${dev.percentage_used}%` : '—'}
													</td>
													<td
														class="px-3 py-2.5 text-right font-mono text-xs tabular-nums text-[var(--color-fg-muted)]"
													>
														{dev.available_spare_percent != null
															? `${dev.available_spare_percent}%`
															: '—'}
													</td>
													<td
														class={cn(
															'px-3 py-2.5 text-right font-mono text-xs tabular-nums',
															(dev.media_errors ?? 0) > 0 && 'text-[var(--color-danger)]'
														)}
													>
														{dev.media_errors ?? '—'}
													</td>
												{/if}
											</tr>
										{/each}
									</tbody>
								</table>
							</div>
						{/if}
					</Card>
				{/if}

				{#if memoryPressureSeries.length > 0}
					<Card class="xl:col-span-2">
						<div class="mb-3 flex items-center justify-between">
							<div>
								<h2 class="text-sm font-medium text-[var(--color-fg)]">
									{m.metrics_card_memory_pressure_title()}
								</h2>
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
		{#each [80, 64, 56, 56, 64] as w, i (i)}
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
