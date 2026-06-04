<script lang="ts">
	import { untrack } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { page } from '$app/state';
	import Card from '$lib/components/ui/Card.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Modal from '$lib/components/ui/Modal.svelte';
	import AutoRefreshSelect from '$lib/components/ui/AutoRefreshSelect.svelte';
	import RefreshButton from '$lib/components/ui/RefreshButton.svelte';
	import SegmentedControl from '$lib/components/ui/SegmentedControl.svelte';
	import { profiles } from '$lib/stores/profiles.svelte';
	import { connections } from '$lib/stores/connections.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { ApiError } from '$lib/api/error';
	import Skeleton from '$lib/components/ui/Skeleton.svelte';
	import { fmtBytes, fmtPercent } from '$lib/utils/format';
	import { cn } from '$lib/utils/cn';
	import { m } from '$lib/paraglide/messages';
	import type { ProcessInfo, ProcessState } from '$lib/types/api';

	type DisplayRow = ProcessInfo & {
		depth: number;
		hasChildren: boolean;
		descendantCount: number;
		/** Sum of CPU% across this node and all descendants. Safe to add
		 *  because each process accumulates its own CPU time independently.
		 *  Memory deliberately omitted — `memory_bytes` is RSS, which counts
		 *  shared pages per-process; summing produces fantastical numbers
		 *  (e.g. 2.7 TB on a 24 GB host). PSS would be the right metric but
		 *  sysinfo doesn't expose it, so we just show self memory. */
		subtreeCpu: number;
	};

	let id = $derived(page.params.id ?? '');
	let profile = $derived(id ? profiles.byId(id) : undefined);
	let conn = $derived(profile ? connections.connect(profile) : null);

	$effect(() => {
		if (!conn) return;
		untrack(() => {
			conn.ensureSignedIn().catch((e) => {
				if (e instanceof ApiError)
					toast.error(m.processes_toast_signin_failed(), { description: e.userMessage });
			});
		});
	});

	let processes = $state<ProcessInfo[]>([]);
	let loading = $state(false);
	let lastFetched = $state<number | null>(null);

	let q = $state('');
	type SortKey = 'pid' | 'name' | 'user' | 'cpu_percent' | 'memory_bytes' | 'state' | 'threads';
	let sortKey = $state<SortKey>('cpu_percent');
	let sortDir = $state<'asc' | 'desc'>('desc');

	let viewMode = $state<'flat' | 'tree'>('flat');
	// collapsed is an exception list (present = collapsed); seeded on first load to hide noise.
	let collapsed = $state(new SvelteSet<number>());
	let initialCollapseDone = $state(false);

	let autoRefresh = $state(false);
	let refreshIntervalSecs = 5;

	let total = $state(0);
	let filteredTotal = $state(0);
	let loadingMore = $state(false);
	let hasMore = $state(false);
	let sentinel = $state<HTMLElement | null>(null);
	let searchTimer: ReturnType<typeof setTimeout> | undefined;

	const PAGE_SIZE = 100;

	function toServerSort(k: SortKey): 'cpu' | 'memory' | 'pid' | 'name' | null {
		switch (k) {
			case 'cpu_percent':
				return 'cpu';
			case 'memory_bytes':
				return 'memory';
			case 'pid':
				return 'pid';
			case 'name':
				return 'name';
			default:
				return null;
		}
	}

	async function fetchProcesses(reset = true) {
		if (!conn?.isAuthenticated) return;

		if (reset) {
			loading = true;
			processes = [];
			hasMore = false;
		} else {
			loadingMore = true;
		}

		try {
			const serverSort = toServerSort(sortKey);
			const isServerPaginated = viewMode === 'flat' && serverSort !== null;

			const query: Record<string, unknown> = {};
			if (q.trim()) query.search = q.trim();

			if (isServerPaginated) {
				query.sort = serverSort;
				query.limit = PAGE_SIZE;
				query.offset = reset ? 0 : processes.length;
			} else {
				query.limit = 1000;
			}

			const res = await conn.client.processes(query);
			processes = reset ? res.processes : [...processes, ...res.processes];
			total = res.total;
			filteredTotal = res.filtered_total;
			hasMore =
				isServerPaginated && processes.length < res.filtered_total && res.processes.length > 0;
			lastFetched = Date.now();
		} catch (e) {
			if (e instanceof ApiError) {
				toast.error(m.processes_toast_fetch_failed(), { description: e.userMessage });
			}
		} finally {
			loading = false;
			loadingMore = false;
		}
	}

	// Re-fetch when auth state, view mode, or sort key changes.
	// sortKey is only tracked in flat mode (conditional read = conditional tracking).
	$effect(() => {
		const auth = conn?.isAuthenticated;
		const mode = viewMode;
		const sort = mode === 'flat' ? sortKey : null;
		void sort;
		if (!auth) return;
		untrack(() => fetchProcesses(true));
	});

	$effect(() => {
		if (!autoRefresh || !conn?.isAuthenticated) return;
		const t = setInterval(fetchProcesses, refreshIntervalSecs * 1000);
		return () => clearInterval(t);
	});

	// IntersectionObserver: load more pages when sentinel scrolls into view.
	$effect(() => {
		const el = sentinel;
		if (!el) return;
		const observer = new IntersectionObserver(
			([entry]) => {
				if (entry.isIntersecting && hasMore && !loadingMore) fetchProcesses(false);
			},
			{ rootMargin: '200px' }
		);
		observer.observe(el);
		return () => observer.disconnect();
	});

	function onSearchInput() {
		if (viewMode !== 'flat') return;
		clearTimeout(searchTimer);
		searchTimer = setTimeout(() => untrack(() => fetchProcesses(true)), 300);
	}

	// Cancel a pending debounced search on unmount.
	$effect(() => () => clearTimeout(searchTimer));

	// One-shot seed: collapse non-root parents so the initial tree isn't a 500-row dump.
	$effect(() => {
		if (initialCollapseDone || processes.length === 0) return;
		untrack(() => {
			const byPid = new Set(processes.map((p) => p.pid));
			// Precompute parent pids so the has-children test is O(1), not O(n²).
			const parentPids = new Set<number>();
			for (const p of processes) if (p.parent_pid != null) parentPids.add(p.parent_pid);
			const seen = new SvelteSet<number>();
			for (const p of processes) {
				const isRoot = p.parent_pid == null || !byPid.has(p.parent_pid);
				const hasChildren = parentPids.has(p.pid);
				if (hasChildren && !isRoot) seen.add(p.pid);
			}
			if (byPid.has(2)) seen.add(2); // kernel thread root — noisy, default closed
			collapsed = seen;
			initialCollapseDone = true;
		});
	});

	function toggleSort(k: SortKey) {
		if (sortKey === k) {
			sortDir = sortDir === 'asc' ? 'desc' : 'asc';
		} else {
			sortKey = k;
			sortDir = k === 'name' || k === 'user' || k === 'state' ? 'asc' : 'desc';
		}
	}

	function compareProcs(a: ProcessInfo, b: ProcessInfo, k: SortKey): number {
		switch (k) {
			case 'pid':
				return a.pid - b.pid;
			case 'name':
				return a.name.localeCompare(b.name);
			case 'user':
				return (a.user ?? '').localeCompare(b.user ?? '');
			case 'cpu_percent':
				return a.cpu_percent - b.cpu_percent;
			case 'memory_bytes':
				return a.memory_bytes - b.memory_bytes;
			case 'state':
				return a.state.localeCompare(b.state);
			case 'threads':
				return (a.threads ?? 0) - (b.threads ?? 0);
		}
	}

	let filtered = $derived.by(() => {
		const needle = q.trim().toLowerCase();
		const list = needle
			? processes.filter(
					(p) =>
						p.name.toLowerCase().includes(needle) ||
						(p.user ?? '').toLowerCase().includes(needle) ||
						String(p.pid).includes(needle)
				)
			: processes;
		const dir = sortDir === 'asc' ? 1 : -1;
		return [...list].sort((a, b) => compareProcs(a, b, sortKey) * dir);
	});

	let displayList = $derived.by<DisplayRow[]>(() => {
		if (viewMode === 'flat') {
			return filtered.map((p) => ({
				...p,
				depth: 0,
				hasChildren: false,
				descendantCount: 0,
				subtreeCpu: p.cpu_percent
			}));
		}

		// Tree + search: keep ancestors of each match (so it stays nested) and
		// ignore the collapsed set so matches are visible.
		const needle = q.trim().toLowerCase();
		const searching = needle.length > 0;
		let working: ProcessInfo[];
		if (searching) {
			const allByPid = new Map<number, ProcessInfo>();
			for (const p of processes) allByPid.set(p.pid, p);
			const matches = (p: ProcessInfo) =>
				p.name.toLowerCase().includes(needle) ||
				(p.user ?? '').toLowerCase().includes(needle) ||
				String(p.pid).includes(needle);
			const included = new Set<number>();
			for (const p of processes) {
				if (!matches(p)) continue;
				// Walk up the ancestor chain, stopping at a shared ancestor.
				let cur: ProcessInfo | undefined = p;
				while (cur && !included.has(cur.pid)) {
					included.add(cur.pid);
					const pp: number | null = cur.parent_pid;
					cur = pp != null && pp !== cur.pid ? allByPid.get(pp) : undefined;
				}
			}
			working = processes.filter((p) => included.has(p.pid));
		} else {
			working = processes;
		}

		const byPid = new Map<number, ProcessInfo>();
		const childrenOf = new Map<number, ProcessInfo[]>();
		for (const p of working) byPid.set(p.pid, p);
		const roots: ProcessInfo[] = [];
		for (const p of working) {
			const pp = p.parent_pid;
			if (pp != null && pp !== p.pid && byPid.has(pp)) {
				const arr = childrenOf.get(pp);
				if (arr) arr.push(p);
				else childrenOf.set(pp, [p]);
			} else {
				roots.push(p);
			}
		}

		const dir = sortDir === 'asc' ? 1 : -1;
		const sortByActive = (arr: ProcessInfo[]) =>
			arr.sort((a, b) => compareProcs(a, b, sortKey) * dir);
		sortByActive(roots);
		for (const arr of childrenOf.values()) sortByActive(arr);

		const rollup = new Map<number, { cpu: number; count: number }>();
		const computeRollup = (p: ProcessInfo): { cpu: number; count: number } => {
			const cached = rollup.get(p.pid);
			if (cached) return cached;
			let cpu = p.cpu_percent;
			let count = 0;
			for (const c of childrenOf.get(p.pid) ?? []) {
				const r = computeRollup(c);
				cpu += r.cpu;
				count += 1 + r.count;
			}
			const result = { cpu, count };
			rollup.set(p.pid, result);
			return result;
		};

		const out: DisplayRow[] = [];
		const visit = (p: ProcessInfo, depth: number) => {
			const children = childrenOf.get(p.pid) ?? [];
			const r = computeRollup(p);
			out.push({
				...p,
				depth,
				hasChildren: children.length > 0,
				descendantCount: r.count,
				subtreeCpu: r.cpu
			});
			if (children.length > 0 && (searching || !collapsed.has(p.pid))) {
				for (const c of children) visit(c, depth + 1);
			}
		};
		for (const r of roots) visit(r, 0);
		return out;
	});

	function toggleCollapse(pid: number) {
		if (collapsed.has(pid)) collapsed.delete(pid);
		else collapsed.add(pid);
	}

	function collapseAll() {
		const childrenSeen = new Set<number>();
		for (const p of processes) {
			if (p.parent_pid != null) childrenSeen.add(p.parent_pid);
		}
		collapsed = new SvelteSet(childrenSeen);
	}

	function expandAll() {
		collapsed = new SvelteSet();
	}

	let killTarget = $state<{ pid: number; name: string } | null>(null);
	let killSignal = $state<9 | 15>(15);
	let killing = $state(false);

	function openKillModal(pid: number, name: string) {
		killTarget = { pid, name };
		killSignal = 15;
	}

	async function confirmKill() {
		// conn can go null if the user navigates away while the modal is open.
		if (!killTarget || !conn) return;
		killing = true;
		const { pid } = killTarget;
		const sig = killSignal;
		try {
			await conn.client.killProcess(pid, sig);
			toast.success(m.processes_toast_killed({ pid, signal: sig }));
			killTarget = null;
			fetchProcesses();
		} catch (e) {
			if (e instanceof ApiError)
				toast.error(m.processes_toast_kill_failed(), { description: e.userMessage });
		} finally {
			killing = false;
		}
	}

	const stateBadge: Record<ProcessState, string> = {
		running: 'bg-[var(--color-success)]/15 text-[var(--color-success)]',
		sleeping: 'bg-[var(--color-info)]/15 text-[var(--color-info)]',
		stopped: 'bg-[var(--color-warning)]/15 text-[var(--color-warning)]',
		zombie: 'bg-[var(--color-danger)]/15 text-[var(--color-danger)]',
		idle: 'bg-[var(--color-fg-subtle)]/15 text-[var(--color-fg-subtle)]',
		unknown: 'bg-[var(--color-fg-subtle)]/15 text-[var(--color-fg-subtle)]'
	};

	function sortIndicator(k: SortKey) {
		if (sortKey !== k) return '';
		return sortDir === 'asc' ? '↑' : '↓';
	}
</script>

{#if profile}
	<div class="px-4 py-6 md:px-8 md:py-8">
		<header class="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
			<div>
				<h1 class="text-[24px] font-semibold tracking-tight">
					{m.section_processes()}
					<span
						class="ml-2 rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-0.5 align-middle font-mono text-[12px] font-medium text-[var(--color-fg-muted)]"
					>
						{total > 0 && filteredTotal < total
							? `${filteredTotal} / ${total}`
							: total || processes.length}
					</span>
				</h1>
				{#if lastFetched}
					<p class="mt-1.5 text-[12px] text-[var(--color-fg-subtle)]">
						{m.processes_updated({ time: new Date(lastFetched).toLocaleTimeString() })}
					</p>
				{/if}
			</div>
			<div class="flex flex-wrap items-center gap-2">
				<SegmentedControl
					value={viewMode}
					options={[
						{ value: 'flat', label: m.processes_view_flat() },
						{ value: 'tree', label: m.processes_view_tree() }
					]}
					onSelect={(next) => (viewMode = next)}
					ariaLabel={m.processes_aria_view_mode()}
				/>
				<AutoRefreshSelect
					value={autoRefresh ? `${refreshIntervalSecs}s` : 'off'}
					options={[
						{ value: 'off', label: m.chart_autorefresh_off() },
						{ value: `${refreshIntervalSecs}s`, label: `${refreshIntervalSecs}s` }
					]}
					onChange={(next) => (autoRefresh = next !== 'off')}
					class="w-[8.5rem]"
				/>
				<RefreshButton
					onclick={() => fetchProcesses()}
					{loading}
					label={m.processes_action_refresh()}
				/>
			</div>
		</header>

		<Modal
			open={killTarget !== null}
			onClose={() => (killTarget = null)}
			title={killTarget ? m.processes_kill_modal_title({ name: killTarget.name }) : ''}
			description={killTarget ? m.processes_kill_modal_description({ pid: killTarget.pid }) : ''}
			width="sm"
		>
			<div class="flex flex-col gap-2">
				{#each [15, 9] as const as sig (sig)}
					<label
						class={cn(
							'flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition',
							killSignal === sig
								? 'border-[var(--color-accent)] bg-[var(--color-accent)]/5'
								: 'border-[var(--color-border)] hover:bg-[var(--color-surface-2)]/50'
						)}
					>
						<input
							type="radio"
							name="kill-signal"
							value={sig}
							bind:group={killSignal}
							class="mt-0.5 accent-[var(--color-accent)]"
						/>
						<div>
							<p class="text-[13px] font-medium">
								{sig === 15 ? m.processes_kill_signal_term() : m.processes_kill_signal_kill()}
							</p>
							<p class="mt-0.5 text-[12px] text-[var(--color-fg-muted)]">
								{sig === 15
									? m.processes_kill_signal_term_hint()
									: m.processes_kill_signal_kill_hint()}
							</p>
						</div>
					</label>
				{/each}
			</div>
			{#snippet footer()}
				<Button variant="ghost" size="sm" onclick={() => (killTarget = null)}>
					{m.processes_kill_cancel()}
				</Button>
				<Button variant="danger" size="sm" onclick={confirmKill} loading={killing}>
					{m.processes_kill_confirm()}
				</Button>
			{/snippet}
		</Modal>

		{#if !conn?.isAuthenticated}
			<Card padding="lg" class="border-[var(--color-warning)]/30">
				<p class="text-sm text-[var(--color-fg-muted)]">
					{m.processes_signin_required()}
				</p>
			</Card>
		{:else}
			<div class="mb-4 flex items-center gap-2">
				<Input
					placeholder={m.processes_filter_placeholder()}
					bind:value={q}
					oninput={onSearchInput}
					class="flex-1 font-mono text-sm"
				/>
				{#if viewMode === 'tree'}
					<button
						type="button"
						onclick={expandAll}
						class="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-xs text-[var(--color-fg-muted)] transition hover:text-[var(--color-fg)]"
					>
						{m.processes_action_expand_all()}
					</button>
					<button
						type="button"
						onclick={collapseAll}
						class="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-xs text-[var(--color-fg-muted)] transition hover:text-[var(--color-fg)]"
					>
						{m.processes_action_collapse_all()}
					</button>
				{/if}
			</div>

			<Card padding="none" class="overflow-hidden">
				<div class="max-h-[calc(100vh-22rem)] overflow-auto">
					<table class="w-full text-sm">
						<thead
							class="sticky top-0 z-10 bg-[var(--color-surface-2)] text-xs tracking-wide text-[var(--color-fg-muted)]"
						>
							<tr>
								{@render th('pid', 'PID', 'right')}
								{@render th('name', m.processes_table_name(), 'left')}
								{@render th('user', m.processes_table_user(), 'left', 'hidden sm:table-cell')}
								{@render th('cpu_percent', 'CPU', 'right')}
								{@render th('memory_bytes', m.processes_table_memory(), 'right')}
								{@render th('state', m.processes_table_state(), 'left', 'hidden md:table-cell')}
								{@render th(
									'threads',
									m.processes_table_threads(),
									'right',
									'hidden md:table-cell'
								)}
								<th class="px-3 py-2.5"></th>
							</tr>
						</thead>
						<tbody>
							{#if loading && processes.length === 0}
								{#each { length: 10 } as _, i (i)}
									<tr class="border-t border-[var(--color-border)]">
										<td class="px-3 py-2.5"><Skeleton class="ml-auto h-3 w-10" /></td>
										<td class="px-3 py-2.5"><Skeleton class="h-3 w-36" /></td>
										<td class="hidden px-3 py-2.5 sm:table-cell"><Skeleton class="h-3 w-16" /></td>
										<td class="px-3 py-2.5"><Skeleton class="ml-auto h-3 w-12" /></td>
										<td class="px-3 py-2.5"><Skeleton class="ml-auto h-3 w-14" /></td>
										<td class="hidden px-3 py-2.5 md:table-cell"
											><Skeleton class="h-5 w-16" rounded="full" /></td
										>
										<td class="hidden px-3 py-2.5 md:table-cell"
											><Skeleton class="ml-auto h-3 w-8" /></td
										>
										<td class="px-3 py-2.5"></td>
									</tr>
								{/each}
							{:else}
								{#each displayList as p (p.pid)}
									{@const isCollapsed = collapsed.has(p.pid)}
									{@const showSubtree = viewMode === 'tree' && p.hasChildren && isCollapsed}
									{@const cpuDisplay = showSubtree ? p.subtreeCpu : p.cpu_percent}
									<tr
										class="border-t border-[var(--color-border)] transition hover:bg-[var(--color-surface-2)]/40"
									>
										<td
											class="px-3 py-2 text-right font-mono tabular-nums text-[var(--color-fg-muted)]"
											>{p.pid}</td
										>
										<td class="px-3 py-2">
											<div
												class="proc-name-cell flex items-start gap-1.5"
												style="--tree-depth: {p.depth}"
											>
												{#if viewMode === 'tree'}
													{#if p.hasChildren}
														<button
															type="button"
															onclick={() => toggleCollapse(p.pid)}
															class="mt-[2px] inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-[var(--color-fg-muted)] transition hover:bg-[var(--color-surface-2)] hover:text-[var(--color-fg)]"
															aria-expanded={!isCollapsed}
															aria-label={isCollapsed
																? m.processes_aria_expand()
																: m.processes_aria_collapse()}
														>
															<svg
																width="12"
																height="12"
																viewBox="0 0 24 24"
																fill="currentColor"
																style="transform: rotate({isCollapsed
																	? 0
																	: 90}deg); transition: transform 100ms ease"
															>
																<path d="M8 5l8 7-8 7z" />
															</svg>
														</button>
													{:else}
														<span
															class="mt-[2px] inline-flex h-5 w-5 shrink-0 items-center justify-center text-[var(--color-fg-subtle)]"
															aria-hidden="true"
														>
															<span class="block h-1 w-1 rounded-full bg-current"></span>
														</span>
													{/if}
												{/if}
												<div class="flex min-w-0 flex-col">
													<span class="font-medium text-[var(--color-fg)]">
														{p.name}
														{#if viewMode === 'tree' && p.hasChildren && isCollapsed}
															<span
																class="ml-1.5 font-mono text-[10px] font-normal text-[var(--color-fg-subtle)]"
																title={m.processes_descendants_hidden({ count: p.descendantCount })}
															>
																+{p.descendantCount}
															</span>
														{/if}
													</span>
													{#if p.cmd && p.cmd.length > 1}
														<span
															class="truncate max-w-[40ch] font-mono text-[11px] text-[var(--color-fg-subtle)]"
															title={p.cmd.join(' ')}
														>
															{p.cmd.slice(1).join(' ') || '—'}
														</span>
													{/if}
												</div>
											</div>
										</td>
										<td class="hidden px-3 py-2 text-[var(--color-fg-muted)] sm:table-cell"
											>{p.user ?? '—'}</td
										>
										<td class="px-3 py-2 text-right font-mono tabular-nums">
											{fmtPercent(cpuDisplay, 1)}
											{#if showSubtree}
												<span
													class="ml-1 text-[10px] text-[var(--color-fg-subtle)]"
													title={m.processes_subtree_total()}>Σ</span
												>
											{/if}
										</td>
										<td class="px-3 py-2 text-right font-mono tabular-nums">
											{fmtBytes(p.memory_bytes)}
										</td>
										<td class="hidden px-3 py-2 md:table-cell">
											<span
												class={cn(
													'inline-flex items-center rounded-full px-2 py-0.5 text-[11px]',
													stateBadge[p.state]
												)}
											>
												{p.state}
											</span>
										</td>
										<td
											class="hidden px-3 py-2 text-right font-mono tabular-nums text-[var(--color-fg-muted)] md:table-cell"
											>{p.threads ?? '—'}</td
										>
										<td class="px-3 py-2 text-right">
											<button
												type="button"
												onclick={() => openKillModal(p.pid, p.name)}
												class="rounded-md p-1.5 text-[var(--color-fg-subtle)] transition hover:bg-[var(--color-danger)]/15 hover:text-[var(--color-danger)]"
												aria-label={m.processes_aria_kill()}
												title={m.processes_kill_title()}
												disabled={killing && killTarget?.pid === p.pid}
											>
												<svg
													width="14"
													height="14"
													viewBox="0 0 24 24"
													fill="none"
													stroke="currentColor"
													stroke-width="2"><path d="M18 6 6 18M6 6l12 12" /></svg
												>
											</button>
										</td>
									</tr>
								{/each}
								{#if displayList.length === 0}
									<tr>
										<td
											colspan="8"
											class="px-3 py-8 text-center text-sm text-[var(--color-fg-subtle)]"
											>{m.processes_empty_state()}</td
										>
									</tr>
								{/if}
							{/if}
						</tbody>
					</table>
					<div bind:this={sentinel} class="h-px"></div>
					{#if loadingMore}
						<div class="py-3 text-center text-xs text-[var(--color-fg-subtle)]">
							{m.processes_load_more()}…
						</div>
					{/if}
				</div>
			</Card>
		{/if}
	</div>
{/if}

{#snippet th(k: SortKey, label: string, align: 'left' | 'right', extraClass = '')}
	<th class={cn('px-3 py-2.5 font-medium', align === 'right' && 'text-right', extraClass)}>
		<button
			type="button"
			onclick={() => toggleSort(k)}
			class="inline-flex items-center gap-1 transition hover:text-[var(--color-fg)]"
		>
			{label}
			<span class="font-mono text-[10px]">{sortIndicator(k)}</span>
		</button>
	</th>
{/snippet}

<style>
	/* Tree-view name cell: indent by depth, with one hairline guide per
	 * ancestor level on the left edge. The repeating gradient draws a 1px
	 * vertical line every 20px, clipped to `depth × 20px` so flat rows
	 * (depth = 0) and root rows render with no visual cost. */
	.proc-name-cell {
		padding-left: calc(var(--tree-depth, 0) * 24px);
		background-image: repeating-linear-gradient(
			to right,
			var(--color-fg-subtle) 0,
			var(--color-fg-subtle) 1px,
			transparent 1px,
			transparent 24px
		);
		background-size: calc(var(--tree-depth, 0) * 24px) 100%;
		background-repeat: no-repeat;
	}
</style>
