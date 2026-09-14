import type { ProcessInfo } from '$lib/types/api';

export type ProcessSort =
	'pid' | 'name' | 'user' | 'cpu_percent' | 'memory_bytes' | 'state' | 'threads';
export const processKey = (p: ProcessInfo) => `${p.pid}:${p.started_at ?? p.name}`;

export function matchesProcess(p: ProcessInfo, query: string): boolean {
	const needle = query.trim().toLowerCase();
	return [p.name, p.user ?? '', String(p.pid), p.cmd.join(' ')].some((s) =>
		s.toLowerCase().includes(needle)
	);
}

export interface ProcessRow {
	process: ProcessInfo;
	depth: number;
	hasChildren: boolean;
	expanded: boolean;
	match: boolean;
}

/** Build from one complete snapshot. A broken parent link becomes a root;
 * cycles are broken once, so every process remains reachable. No recursive
 * traversal: deeply nested processes must not overflow the browser stack. */
export function processRows(
	processes: ProcessInfo[],
	query: string,
	sort: ProcessSort,
	direction: 'asc' | 'desc',
	tree: boolean,
	expansion: ReadonlyMap<string, boolean>
): { rows: ProcessRow[]; matches: number } {
	const compare = (a: ProcessInfo, b: ProcessInfo) => {
		const fallback = sort === 'user' ? '' : 0;
		const av = a[sort] ?? fallback,
			bv = b[sort] ?? fallback;
		const result =
			typeof av === 'string' && typeof bv === 'string'
				? av.localeCompare(bv)
				: Number(av) - Number(bv);
		return (direction === 'asc' ? result : -result) || a.pid - b.pid;
	};
	const matching = processes.filter((p) => matchesProcess(p, query));
	if (!tree)
		return {
			matches: matching.length,
			rows: matching
				.sort(compare)
				.map((process) => ({ process, depth: 0, hasChildren: false, expanded: false, match: true }))
		};
	const byPid = new Map(processes.map((p) => [p.pid, p]));
	const parents = new Map<number, number>();
	for (const p of processes) {
		if (p.parent_pid !== null && p.parent_pid !== p.pid && byPid.has(p.parent_pid))
			parents.set(p.pid, p.parent_pid);
	}
	const visited = new Set<number>();
	for (const p of processes) {
		const path = new Set<number>();
		let pid: number | undefined = p.pid;
		while (pid !== undefined && !visited.has(pid)) {
			if (path.has(pid)) {
				parents.delete(pid);
				break;
			}
			path.add(pid);
			pid = parents.get(pid);
		}
		for (const id of path) visited.add(id);
	}
	const matchIds = new Set(matching.map((p) => p.pid));
	const included = new Set<number>();
	for (const p of matching) {
		let pid: number | undefined = p.pid;
		while (pid !== undefined && !included.has(pid)) {
			included.add(pid);
			pid = parents.get(pid);
		}
	}
	const children = new Map<number | undefined, ProcessInfo[]>();
	for (const p of processes) {
		if (!included.has(p.pid)) continue;
		const parent = parents.get(p.pid);
		const siblings = children.get(parent) ?? [];
		siblings.push(p);
		children.set(parent, siblings);
	}
	for (const siblings of children.values()) siblings.sort(compare);
	const stack = (children.get(undefined) ?? []).map((process) => ({ process, depth: 0 })).reverse();
	const rows: ProcessRow[] = [];
	while (stack.length) {
		const { process, depth } = stack.pop()!;
		const descendants = children.get(process.pid) ?? [];
		const expanded = query.trim() !== '' || (expansion.get(processKey(process)) ?? depth === 0);
		rows.push({
			process,
			depth,
			expanded,
			hasChildren: descendants.length > 0,
			match: matchIds.has(process.pid)
		});
		if (expanded)
			for (let i = descendants.length - 1; i >= 0; i--)
				stack.push({ process: descendants[i], depth: depth + 1 });
	}
	return { rows, matches: matching.length };
}
