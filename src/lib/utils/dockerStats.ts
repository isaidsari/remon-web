export interface DerivedStats {
	cpuPercent: number | null;
	memUsedBytes: number | null;
	memLimitBytes: number | null;
	memPercent: number | null;
	netRxBps: number | null;
	netTxBps: number | null;
	blkReadBps: number | null;
	blkWriteBps: number | null;
	pids: number | null;
}

interface RawCpu {
	cpu_usage?: { total_usage?: number };
	system_cpu_usage?: number;
	online_cpus?: number;
}

interface RawNetwork {
	rx_bytes?: number;
	tx_bytes?: number;
}

interface RawBlkio {
	io_service_bytes_recursive?: { op?: string; value?: number }[];
}

export interface RawStats {
	cpu_stats?: RawCpu;
	precpu_stats?: RawCpu;
	memory_stats?: { usage?: number; limit?: number };
	networks?: Record<string, RawNetwork>;
	blkio_stats?: RawBlkio;
	pids_stats?: { current?: number };
}

function num(x: unknown): number | null {
	return typeof x === 'number' && Number.isFinite(x) ? x : null;
}

function cpuPercent(curr: RawCpu | undefined, prev: RawCpu | undefined): number | null {
	if (!curr || !prev) return null;
	const cpuDelta = (curr.cpu_usage?.total_usage ?? 0) - (prev.cpu_usage?.total_usage ?? 0);
	const sysDelta = (curr.system_cpu_usage ?? 0) - (prev.system_cpu_usage ?? 0);
	const onlineCpus = curr.online_cpus ?? 0;
	if (sysDelta <= 0 || cpuDelta < 0 || onlineCpus <= 0) return null;
	// Cap at 100% per online core so a tiny sysDelta can't yield an absurd percentage.
	return Math.min((cpuDelta / sysDelta) * onlineCpus * 100, onlineCpus * 100);
}

function netTotals(net: Record<string, RawNetwork> | undefined): { rx: number; tx: number } {
	let rx = 0;
	let tx = 0;
	if (!net) return { rx, tx };
	for (const v of Object.values(net)) {
		rx += v.rx_bytes ?? 0;
		tx += v.tx_bytes ?? 0;
	}
	return { rx, tx };
}

function blkTotals(b: RawBlkio | undefined): { read: number; write: number } {
	let read = 0;
	let write = 0;
	const arr = b?.io_service_bytes_recursive;
	if (!Array.isArray(arr)) return { read, write };
	for (const entry of arr) {
		const op = entry.op?.toLowerCase();
		const v = entry.value ?? 0;
		if (op === 'read') read += v;
		else if (op === 'write') write += v;
	}
	return { read, write };
}

export function deriveStats(
	curr: RawStats | null,
	prev: RawStats | null,
	deltaSecs: number
): DerivedStats {
	const c = curr ?? ({} as RawStats);
	const p = prev ?? ({} as RawStats);
	const usable = deltaSecs > 0 && prev != null;

	const memUsed = num(c.memory_stats?.usage);
	const memLimit = num(c.memory_stats?.limit);
	const memPct = memUsed !== null && memLimit && memLimit > 0 ? (memUsed / memLimit) * 100 : null;

	const cpuPct = cpuPercent(c.cpu_stats, c.precpu_stats);

	const cn = netTotals(c.networks);
	const pn = netTotals(p.networks);
	const netRx = usable ? Math.max(0, (cn.rx - pn.rx) / deltaSecs) : null;
	const netTx = usable ? Math.max(0, (cn.tx - pn.tx) / deltaSecs) : null;

	const cb = blkTotals(c.blkio_stats);
	const pb = blkTotals(p.blkio_stats);
	const blkRead = usable ? Math.max(0, (cb.read - pb.read) / deltaSecs) : null;
	const blkWrite = usable ? Math.max(0, (cb.write - pb.write) / deltaSecs) : null;

	const pids = num(c.pids_stats?.current);

	return {
		cpuPercent: cpuPct,
		memUsedBytes: memUsed,
		memLimitBytes: memLimit,
		memPercent: memPct,
		netRxBps: netRx,
		netTxBps: netTx,
		blkReadBps: blkRead,
		blkWriteBps: blkWrite,
		pids
	};
}
