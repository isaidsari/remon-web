// Ref-counted SSE wrapper; acquire()/release() drive the stream. Keeps CAPACITY-point ring buffers per metric for sparklines.

import { openSseStream, type SseSubscription } from '$lib/api/sse';
import type {
	ComponentsSnapshot,
	CpuStats,
	DiskStats,
	MemoryStats,
	NetworkStats,
	PressureSnapshot,
	StatsEvent
} from '$lib/types/api';
import { isPhysicalInterface } from '$lib/utils/netClassify';
import type { Connection } from './connections.svelte';

export type StreamStatus = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed';

export interface TimeSeries {
	xs: number[]; // unix seconds
	ys: number[];
}

const CAPACITY = 90;

function emptySeries(): TimeSeries {
	return { xs: [], ys: [] };
}

function pushPoint(series: TimeSeries, x: number, y: number) {
	series.xs.push(x);
	series.ys.push(y);
	if (series.xs.length > CAPACITY) {
		const drop = series.xs.length - CAPACITY;
		series.xs.splice(0, drop);
		series.ys.splice(0, drop);
	}
}

// Merges batch into series; existing samples win on ts collision (live SSE beats stale rollup).
function merge(series: TimeSeries, batch: { ts: number; v: number }[]) {
	if (batch.length === 0) return;
	const map = new Map<number, number>();
	for (const p of batch) map.set(p.ts, p.v);
	// Existing data wins on conflict (it's the live SSE truth).
	for (let i = 0; i < series.xs.length; i++) map.set(series.xs[i], series.ys[i]);
	const sortedTs = [...map.keys()].sort((a, b) => a - b);
	const xs = sortedTs;
	const ys = sortedTs.map((ts) => map.get(ts)!);
	if (xs.length > CAPACITY) {
		const start = xs.length - CAPACITY;
		series.xs = xs.slice(start);
		series.ys = ys.slice(start);
	} else {
		series.xs = xs;
		series.ys = ys;
	}
}

export class LiveStats {
	// Latest snapshots
	cpu = $state<CpuStats | null>(null);
	memory = $state<MemoryStats | null>(null);
	disks = $state<DiskStats[]>([]);
	network = $state<NetworkStats[]>([]);
	/** PSI snapshot; null on pre-4.20 kernels and non-Linux. */
	pressure = $state<PressureSnapshot | null>(null);
	/** Hardware sensors; null until the server emits at least one reading. */
	components = $state<ComponentsSnapshot | null>(null);

	// Sparkline histories
	cpuHistory = $state<TimeSeries>(emptySeries());
	memoryActivePercentHistory = $state<TimeSeries>(emptySeries());
	diskMaxPercentHistory = $state<TimeSeries>(emptySeries());
	diskReadHistory = $state<TimeSeries>(emptySeries());
	diskWriteHistory = $state<TimeSeries>(emptySeries());
	netRxHistory = $state<TimeSeries>(emptySeries());
	netTxHistory = $state<TimeSeries>(emptySeries());
	netTotalHistory = $state<TimeSeries>(emptySeries());

	status = $state<StreamStatus>('idle');
	lastError = $state<string | null>(null);

	private subscribers = 0;
	private subscription: SseSubscription | null = null;
	// Grace period lets a navigation re-acquire cancel the teardown before it fires.
	private releaseTimer: ReturnType<typeof setTimeout> | null = null;
	// 2 s is above the typical unmount→mount gap under View Transitions (~few hundred ms).
	private static readonly RELEASE_GRACE_MS = 2_000;

	constructor(private connection: Connection) {}

	acquire(): void {
		if (this.releaseTimer !== null) {
			clearTimeout(this.releaseTimer);
			this.releaseTimer = null;
		}
		this.subscribers++;
		if (this.subscribers === 1 && this.subscription === null) {
			// Seed the sparkline buffers from history so they aren't empty for
			// the first few minutes; fire-and-forget — SSE starts immediately
			// and the prefetch merges in once it lands.
			void this.prefetchHistory();
			this.openStream();
		}
	}

	release(): void {
		this.subscribers = Math.max(0, this.subscribers - 1);
		if (this.subscribers !== 0) return;
		if (this.releaseTimer !== null) clearTimeout(this.releaseTimer);
		this.releaseTimer = setTimeout(() => {
			this.releaseTimer = null;
			if (this.subscribers === 0) this.closeStream();
		}, LiveStats.RELEASE_GRACE_MS);
	}

	/** Forced full restart — used after auth resets so the stream re-handshakes. */
	restart(): void {
		if (this.subscribers === 0) return;
		this.closeStream();
		this.openStream();
	}

	private async prefetchHistory(): Promise<void> {
		if (!this.connection.isAuthenticated) return;
		const end = Math.floor(Date.now() / 1000);
		const start = end - CAPACITY * 2; // CAPACITY samples × 2 s tick = 180 s
		const q = { start, end };
		try {
			const [c, m, d, n] = await Promise.all([
				this.connection.client.cpuHistory(q),
				this.connection.client.memoryHistory(q),
				this.connection.client.diskHistory(q),
				this.connection.client.networkHistory(q)
			]);

			const cpuPts = c.points.map((p) => ({ ts: p.timestamp, v: p.usage_percent }));
			merge(this.cpuHistory, cpuPts);

			const memPts = m.points.map((p) => {
				const total = p.total_bytes;
				const active = total - p.available_bytes;
				return { ts: p.timestamp, v: total > 0 ? (active / total) * 100 : 0 };
			});
			merge(this.memoryActivePercentHistory, memPts);

			const diskByTs = new Map<number, number>();
			const diskReadByTs = new Map<number, number>();
			const diskWriteByTs = new Map<number, number>();
			for (const p of d.points) {
				if (
					p.mount_point.startsWith('/var/lib/docker/') ||
					p.mount_point.startsWith('/var/lib/containers/')
				)
					continue;
				const total = p.total_bytes;
				if (total > 0) {
					const pct = (p.used_bytes / total) * 100;
					const cur = diskByTs.get(p.timestamp) ?? 0;
					if (pct > cur) diskByTs.set(p.timestamp, pct);
				}
				diskReadByTs.set(
					p.timestamp,
					(diskReadByTs.get(p.timestamp) ?? 0) + (p.read_bytes_per_sec ?? 0)
				);
				diskWriteByTs.set(
					p.timestamp,
					(diskWriteByTs.get(p.timestamp) ?? 0) + (p.write_bytes_per_sec ?? 0)
				);
			}
			const diskPts = [...diskByTs.entries()].map(([ts, v]) => ({ ts, v }));
			merge(this.diskMaxPercentHistory, diskPts);
			merge(
				this.diskReadHistory,
				[...diskReadByTs.entries()].map(([ts, v]) => ({ ts, v }))
			);
			merge(
				this.diskWriteHistory,
				[...diskWriteByTs.entries()].map(([ts, v]) => ({ ts, v }))
			);

			const netByTs = new Map<number, { rx: number; tx: number }>();
			for (const p of n.points) {
				// Same cross-platform physical-NIC filter as the live SSE path
				// uses for KPI aggregation — see $lib/utils/netClassify.ts for
				// what's matched. Historic rollup rows from older server
				// versions may still carry veth/Npcap/vEthernet entries, so
				// we filter at read time rather than trusting the source.
				if (!isPhysicalInterface(p.interface_name)) continue;
				const slot = netByTs.get(p.timestamp) ?? { rx: 0, tx: 0 };
				slot.rx += p.rx_bytes_per_sec;
				slot.tx += p.tx_bytes_per_sec;
				netByTs.set(p.timestamp, slot);
			}
			const netPts = [...netByTs.entries()];
			merge(
				this.netRxHistory,
				netPts.map(([ts, s]) => ({ ts, v: s.rx }))
			);
			merge(
				this.netTxHistory,
				netPts.map(([ts, s]) => ({ ts, v: s.tx }))
			);
			merge(
				this.netTotalHistory,
				netPts.map(([ts, s]) => ({ ts, v: s.rx + s.tx }))
			);
		} catch {
			// Silent — SSE is the source of truth, an empty start is fine.
		}
	}

	private openStream() {
		const url = this.connection.client.sseUrl('/stats');
		this.status = 'connecting';
		this.lastError = null;
		this.subscription = openSseStream({
			url,
			getAccessToken: () => this.connection.accessToken,
			handlers: {
				onOpen: () => {
					this.status = 'open';
					this.lastError = null;
				},
				onMessage: (data, _event) => this.handleMessage(data),
				onError: (err) => {
					this.status = 'reconnecting';
					this.lastError = err instanceof Error ? err.message : String(err);
				},
				onClose: () => {
					this.status = 'closed';
				}
			}
		});
	}

	private closeStream() {
		this.subscription?.close();
		this.subscription = null;
		this.status = 'idle';
		this.lastError = null;
		this.cpuHistory = emptySeries();
		this.memoryActivePercentHistory = emptySeries();
		this.diskMaxPercentHistory = emptySeries();
		this.diskReadHistory = emptySeries();
		this.diskWriteHistory = emptySeries();
		this.netRxHistory = emptySeries();
		this.netTxHistory = emptySeries();
		this.netTotalHistory = emptySeries();
	}

	private handleMessage(data: string) {
		let event: StatsEvent;
		try {
			event = JSON.parse(data) as StatsEvent;
		} catch {
			return;
		}

		switch (event.type) {
			case 'Cpu':
				this.cpu = event.data;
				pushPoint(this.cpuHistory, event.data.timestamp, event.data.usage_percent);
				break;
			case 'Memory': {
				this.memory = event.data;
				const total = event.data.total_bytes || 1;
				// Match the KPI semantics: "active" = total - available (htop-style),
				// not "used" which counts cache/buffers.
				const active = Math.max(0, total - event.data.available_bytes);
				const pct = (active / total) * 100;
				pushPoint(this.memoryActivePercentHistory, event.data.timestamp, pct);
				break;
			}
			case 'Disk': {
				// Server already filters out container-runtime overlay mounts
				// (/var/lib/docker/, /var/lib/containers/), so what arrives
				// here is the host's real disks. Aggregate without per-mount
				// filtering.
				this.disks = event.data;
				if (event.data.length > 0) {
					const ts = event.data[0].timestamp;
					let maxPct = 0;
					let totalRead = 0;
					let totalWrite = 0;
					for (const d of event.data) {
						if (d.total_bytes > 0) {
							const p = (d.used_bytes / d.total_bytes) * 100;
							if (p > maxPct) maxPct = p;
						}
						totalRead += d.read_bytes_per_sec ?? 0;
						totalWrite += d.write_bytes_per_sec ?? 0;
					}
					pushPoint(this.diskMaxPercentHistory, ts, maxPct);
					pushPoint(this.diskReadHistory, ts, totalRead);
					pushPoint(this.diskWriteHistory, ts, totalWrite);
				}
				break;
			}
			case 'Network': {
				// Server filters veth/br-/docker/tap/vmnet/vboxnet/virbr
				// before broadcasting, so this array is host-NIC plus any
				// tun/wg/tailscale links the operator actually has.
				this.network = event.data;
				if (event.data.length > 0) {
					const ts = event.data[0].timestamp;
					let rx = 0;
					let tx = 0;
					for (const n of event.data) {
						rx += n.rx_bytes_per_sec;
						tx += n.tx_bytes_per_sec;
					}
					pushPoint(this.netRxHistory, ts, rx);
					pushPoint(this.netTxHistory, ts, tx);
					pushPoint(this.netTotalHistory, ts, rx + tx);
				}
				break;
			}
			case 'Pressure':
				this.pressure = event.data;
				break;
			case 'Components':
				this.components = event.data;
				break;
		}
	}
}
