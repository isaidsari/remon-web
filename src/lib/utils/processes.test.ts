import { describe, expect, it } from 'bun:test';
import type { ProcessInfo } from '$lib/types/api';
import { matchesProcess, processKey, processRows } from './processes';

const proc = (
	pid: number,
	parent_pid: number | null = null,
	extra: Partial<ProcessInfo> = {}
): ProcessInfo => ({
	pid,
	parent_pid,
	name: `process-${pid}`,
	cmd: [],
	user: null,
	exe: null,
	cwd: null,
	cpu_percent: pid,
	memory_bytes: 1024,
	memory_percent: 0,
	state: 'sleeping',
	started_at: 123,
	threads: 1,
	...extra
});

describe('process browsing', () => {
	it('sorts the complete snapshot before displaying a page, in both directions', () => {
		const snapshot = Array.from({ length: 1200 }, (_, i) => proc(i + 1));
		const ascending = processRows(snapshot, '', 'cpu_percent', 'asc', false, new Map());
		const descending = processRows(snapshot, '', 'cpu_percent', 'desc', false, new Map());
		expect(ascending.rows[0].process.pid).toBe(1);
		expect(descending.rows[0].process.pid).toBe(1200);
		expect(ascending.matches).toBe(1200);
	});
	it('searches name, PID, user and command with the same rules', () => {
		const p = proc(321, null, { name: 'Worker', user: 'Alice', cmd: ['node', '/app/jobs.js'] });
		for (const q of ['worker', '321', 'ALICE', 'jobs.js']) expect(matchesProcess(p, q)).toBe(true);
		expect(matchesProcess(p, 'missing')).toBe(false);
	});
	it('keeps and opens ancestors during search without changing saved expansion', () => {
		const snapshot = [proc(1), proc(2, 1), proc(3, 2, { name: 'worker' }), proc(4, 1)];
		const expansion = new Map([[processKey(snapshot[0]), false]]);
		const result = processRows(snapshot, 'worker', 'pid', 'asc', true, expansion);
		expect(result.rows.map((r) => r.process.pid)).toEqual([1, 2, 3]);
		expect(result.rows.map((r) => r.match)).toEqual([false, false, true]);
		expect(result.matches).toBe(1);
		expect(processRows(snapshot, '', 'pid', 'asc', true, expansion).rows.length).toBe(1);
	});
	it('never changes a process metric when a branch is collapsed', () => {
		const snapshot = [proc(1), proc(2, 1)];
		for (const expanded of [true, false]) {
			const result = processRows(
				snapshot,
				'',
				'cpu_percent',
				'desc',
				true,
				new Map([[processKey(snapshot[0]), expanded]])
			);
			expect(result.rows[0].process.cpu_percent).toBe(1);
		}
	});
	it('keeps orphans, self parents and cycles reachable exactly once', () => {
		const snapshot = [proc(1, 99), proc(2, 2), proc(3, 4), proc(4, 3)];
		const expansion = new Map(snapshot.map((p) => [processKey(p), true]));
		const result = processRows(snapshot, '', 'pid', 'asc', true, expansion);
		expect(result.rows.map((r) => r.process.pid).sort()).toEqual([1, 2, 3, 4]);
	});
	it('handles deep trees without recursion', () => {
		const snapshot = Array.from({ length: 15000 }, (_, i) => proc(i + 1, i || null));
		const result = processRows(snapshot, 'process-15000', 'pid', 'asc', true, new Map());
		expect(result.rows.length).toBe(15000);
	});
	it('does not transfer expansion to a reused PID and sorts missing users deterministically', () => {
		const previous = proc(1);
		const next = proc(1, null, { started_at: 456 });
		expect(processKey(previous)).not.toBe(processKey(next));
		const result = processRows(
			[proc(2, null, { user: 'alice' }), previous],
			'',
			'user',
			'asc',
			false,
			new Map()
		);
		expect(result.rows.map((r) => r.process.pid)).toEqual([1, 2]);
	});
});
