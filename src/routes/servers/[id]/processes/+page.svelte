<script lang="ts">
	import { untrack } from 'svelte';
	import { SvelteMap } from 'svelte/reactivity';
	import { page } from '$app/state';
	import Card from '$lib/components/ui/Card.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Modal from '$lib/components/ui/Modal.svelte';
	import AutoRefreshSelect from '$lib/components/ui/AutoRefreshSelect.svelte';
	import RefreshButton from '$lib/components/ui/RefreshButton.svelte';
	import SegmentedControl from '$lib/components/ui/SegmentedControl.svelte';
	import Skeleton from '$lib/components/ui/Skeleton.svelte';
	import { profiles } from '$lib/stores/profiles.svelte';
	import { connections } from '$lib/stores/connections.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { ApiError } from '$lib/api/error';
	import { fmtBytes, fmtPercent } from '$lib/utils/format';
	import { processRows, processKey, type ProcessSort } from '$lib/utils/processes';
	import { cn } from '$lib/utils/cn';
	import { m } from '$lib/paraglide/messages';
	import type { ProcessInfo } from '$lib/types/api';

	const id = $derived(page.params.id ?? '');
	const profile = $derived(id ? profiles.byId(id) : undefined);
	const conn = $derived(profile ? connections.connect(profile) : null);
	let processes = $state<ProcessInfo[]>([]);
	let loading = $state(false);
	let lastFetched = $state<number | null>(null);
	let error = $state('');
	let q = $state('');
	let sortKey = $state<ProcessSort>('cpu_percent');
	let sortDir = $state<'asc' | 'desc'>('desc');
	let viewMode = $state<'flat' | 'tree'>('flat');
	let autoRefresh = $state(false);
	let visibleCount = $state(100);
	let selected = $state<string | null>(null);
	const expansion = new SvelteMap<string, boolean>();
	let generation = 0;
	let inFlight = false;
	let requestController: AbortController | undefined;
	const result = $derived(
		processRows(processes, q, sortKey, sortDir, viewMode === 'tree', expansion)
	);
	const visible = $derived(result.rows.slice(0, visibleCount));
	const selectedProcess = $derived(processes.find((p) => processKey(p) === selected));

	$effect(() => {
		const current = conn;
		if (!current) return;
		untrack(() =>
			current.ensureSignedIn().catch((e) => {
				if (current === conn && e instanceof ApiError)
					toast.error(m.processes_toast_signin_failed(), { description: e.userMessage });
			})
		);
	});

	async function fetchProcesses() {
		const current = conn;
		if (!current?.isAuthenticated || inFlight) return;
		const request = generation;
		inFlight = true;
		loading = true;
		requestController = new AbortController();
		try {
			const res = await current.client.processes(
				{ snapshot: true },
				{ signal: requestController.signal }
			);
			if (request !== generation || current !== conn) return;
			// Do not present a partial result as a complete tree (e.g. server not updated yet).
			if (res.processes.length !== res.total) throw new Error(m.processes_incomplete());
			processes = res.processes;
			lastFetched = res.timestamp * 1000;
			error = '';
			const keys = new Set(processes.map(processKey));
			for (const key of expansion.keys()) if (!keys.has(key)) expansion.delete(key);
			if (selected && !keys.has(selected)) selected = null;
		} catch (e) {
			if (request !== generation || current !== conn) return;
			error =
				e instanceof ApiError
					? e.userMessage
					: e instanceof Error
						? e.message
						: m.processes_toast_fetch_failed();
		} finally {
			if (request === generation) {
				loading = false;
				inFlight = false;
			}
		}
	}

	$effect(() => {
		const current = conn;
		const auth = current?.isAuthenticated;
		untrack(() => {
			generation++;
			inFlight = false;
			processes = [];
			lastFetched = null;
			error = '';
			loading = false;
			selected = null;
			killTarget = null;
			expansion.clear();
			visibleCount = 100;
			if (auth) void fetchProcesses();
		});
		return () => {
			generation++;
			requestController?.abort();
			inFlight = false;
		};
	});

	$effect(() => {
		if (!autoRefresh || !conn?.isAuthenticated) return;
		const refresh = () => {
			if (!document.hidden && !selected && !killTarget) void fetchProcesses();
		};
		const timer = setInterval(refresh, 5000);
		document.addEventListener('visibilitychange', refresh);
		return () => {
			clearInterval(timer);
			document.removeEventListener('visibilitychange', refresh);
		};
	});

	function changeView(next: 'flat' | 'tree') {
		viewMode = next;
		visibleCount = 100;
	}
	function toggleSort(key: ProcessSort) {
		if (sortKey === key) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
		else {
			sortKey = key;
			sortDir = ['name', 'user', 'state', 'pid'].includes(key) ? 'asc' : 'desc';
		}
		visibleCount = 100;
	}
	function expandAll(expanded: boolean) {
		for (const p of processes) expansion.set(processKey(p), expanded);
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
		if (!killTarget || !conn || killing) return;
		const current = conn;
		const request = generation;
		killing = true;
		const { pid } = killTarget;
		const sig = killSignal;
		try {
			await current.client.killProcess(pid, sig);
			if (request !== generation || current !== conn) return;
			toast.success(m.processes_toast_killed({ pid, signal: sig }));
			killTarget = null;
			selected = null;
			fetchProcesses();
		} catch (e) {
			if (request !== generation || current !== conn) return;
			if (e instanceof ApiError) {
				// A guardrail, not a failure — and permanent for this pid, so close
				// the dialog rather than leave a button that can only fail.
				if (e.isSelfTarget) {
					toast.warning(m.error_self_target_title(), { description: e.userMessage });
					killTarget = null;
				} else {
					toast.error(m.processes_toast_kill_failed(), { description: e.userMessage });
				}
			}
		} finally {
			killing = false;
		}
	}
</script>

{#if profile}
	<div class="px-4 py-6 md:px-8 md:py-8">
		<header class="mb-5 flex flex-wrap items-center justify-between gap-3">
			<div class="flex items-baseline gap-3">
				<h1 class="text-2xl font-semibold tracking-tight">{m.section_processes()}</h1>
				<span class="text-xs text-[var(--color-fg-muted)] tabular-nums"
					>{q.trim() ? result.matches + ' / ' : ''}{processes.length}</span
				>
			</div>
			<div class="flex items-center gap-2">
				<AutoRefreshSelect
					value={autoRefresh ? '5s' : 'off'}
					options={[
						{ value: 'off', label: m.chart_autorefresh_off() },
						{ value: '5s', label: '5s' }
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
							<p class="text-md font-medium">
								{sig === 15 ? m.processes_kill_signal_term() : m.processes_kill_signal_kill()}
							</p>
							<p class="mt-0.5 text-xs text-[var(--color-fg-muted)]">
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
			<Card padding="lg"
				><p class="text-sm text-[var(--color-fg-muted)]">{m.processes_signin_required()}</p></Card
			>
		{:else}
			<div class="mb-3 flex flex-wrap items-center gap-2">
				<Input
					placeholder={m.processes_filter_placeholder()}
					bind:value={q}
					oninput={() => (visibleCount = 100)}
					class="min-w-48 flex-1 text-sm"
				/>
				<SegmentedControl
					value={viewMode}
					options={[
						{ value: 'flat', label: m.processes_view_flat() },
						{ value: 'tree', label: m.processes_view_tree() }
					]}
					onSelect={changeView}
					ariaLabel={m.processes_aria_view_mode()}
				/>
				{#if viewMode === 'tree'}
					<Button variant="ghost" size="sm" onclick={() => expandAll(true)} disabled={!!q.trim()}
						>{m.processes_action_expand_all()}</Button
					>
					<Button variant="ghost" size="sm" onclick={() => expandAll(false)} disabled={!!q.trim()}
						>{m.processes_action_collapse_all()}</Button
					>
				{/if}
			</div>
			{#if error}<p role="alert" class="mb-3 text-sm text-[var(--color-danger)]">{error}</p>{/if}
			<Card padding="none" class="overflow-hidden">
				<div class="max-h-[max(18rem,calc(100dvh-19rem))] overflow-auto">
					<table
						class={cn(
							'w-full table-fixed text-sm',
							viewMode === 'tree' ? 'min-w-[32rem]' : 'min-w-[20rem]'
						)}
					>
						<thead
							class="sticky top-0 z-10 bg-[var(--color-surface-2)] text-xs text-[var(--color-fg-muted)]"
						>
							<tr>
								{@render th('name', m.processes_table_name(), '')}
								{@render th('cpu_percent', 'CPU', 'w-20 text-right')}
								{@render th('memory_bytes', m.processes_table_memory(), 'w-24 text-right')}
								{@render th('pid', 'PID', 'hidden w-20 text-right sm:table-cell')}
								{@render th('user', m.processes_table_user(), 'hidden w-28 lg:table-cell')}
								{@render th('state', m.processes_table_state(), 'hidden w-24 md:table-cell')}
							</tr>
						</thead>
						<tbody>
							{#if loading && lastFetched === null}
								{#each { length: 8 } as _, i (i)}<tr
										><td colspan="6" class="px-3 py-3"><Skeleton class="h-4 w-full" /></td></tr
									>{/each}
							{:else}
								{#each visible as row (processKey(row.process))}
									{@const p = row.process}
									<tr
										class="border-t border-[var(--color-border)] hover:bg-[var(--color-surface-2)]/50"
									>
										<td class="py-2 pr-2 pl-3">
											<div
												class="flex min-w-0 items-center gap-1"
												style:padding-left={viewMode === 'tree'
													? Math.min(row.depth, 8) * 12 + 'px'
													: '0'}
											>
												{#if viewMode === 'tree'}
													{#if row.hasChildren}<button
															type="button"
															class="grid size-7 shrink-0 place-items-center rounded text-[var(--color-fg-muted)] hover:bg-[var(--color-surface-2)]"
															aria-expanded={row.expanded}
															aria-label={row.expanded
																? m.processes_aria_collapse()
																: m.processes_aria_expand()}
															disabled={!!q.trim()}
															onclick={() => expansion.set(processKey(p), !row.expanded)}
															><svg
																width="12"
																height="12"
																viewBox="0 0 24 24"
																fill="none"
																stroke="currentColor"
																stroke-width="2"
																class={row.expanded ? 'rotate-90' : ''}
																><path d="m9 18 6-6-6-6" /></svg
															></button
														>
													{:else}<span
															aria-hidden="true"
															class="grid size-7 shrink-0 place-items-center text-[var(--color-fg-faint)]"
															>·</span
														>{/if}
												{/if}
												<button
													type="button"
													class={cn(
														'min-w-0 flex-1 rounded text-left hover:text-[var(--color-accent)]',
														!row.match && 'opacity-50'
													)}
													onclick={() => (selected = processKey(p))}
												>
													<span class="block truncate font-medium">{p.name}</span>
													<span class="text-2xs block text-[var(--color-fg-muted)] sm:hidden"
														>{p.pid}</span
													>
												</button>
											</div>
										</td>
										<td class="px-3 py-2 text-right font-mono text-xs tabular-nums"
											>{fmtPercent(p.cpu_percent, 1)}</td
										>
										<td class="px-3 py-2 text-right font-mono text-xs tabular-nums"
											>{fmtBytes(p.memory_bytes)}</td
										>
										<td
											class="hidden px-3 py-2 text-right font-mono text-xs text-[var(--color-fg-muted)] sm:table-cell"
											>{p.pid}</td
										>
										<td
											class="hidden truncate px-3 py-2 text-xs text-[var(--color-fg-muted)] lg:table-cell"
											>{p.user ?? '—'}</td
										>
										<td
											class={cn(
												'hidden px-3 py-2 text-xs md:table-cell',
												p.state === 'zombie' || p.state === 'stopped'
													? 'text-[var(--color-warning)]'
													: 'text-[var(--color-fg-muted)]'
											)}>{p.state}</td
										>
									</tr>
								{/each}
								{#if !result.rows.length}<tr
										><td
											colspan="6"
											class="px-3 py-10 text-center text-sm text-[var(--color-fg-muted)]"
											>{error ? m.processes_toast_fetch_failed() : m.processes_empty_state()}</td
										></tr
									>{/if}
							{/if}
						</tbody>
					</table>
					{#if visibleCount < result.rows.length}<div
							class="border-t border-[var(--color-border)] p-3 text-center"
						>
							<Button variant="ghost" size="sm" onclick={() => (visibleCount += 100)}
								>{m.processes_load_more()} ({result.rows.length - visible.length})</Button
							>
						</div>{/if}
				</div>
			</Card>
			{#if lastFetched}<p class="mt-2 text-xs text-[var(--color-fg-subtle)]">
					{m.processes_updated({ time: new Date(lastFetched).toLocaleTimeString() })}
				</p>{/if}
		{/if}
	</div>
{/if}

<Modal
	open={!!selectedProcess && !killTarget}
	onClose={() => (selected = null)}
	title={selectedProcess?.name ?? ''}
	width="lg"
>
	{#if selectedProcess}
		{@const p = selectedProcess}
		<div class="grid grid-cols-2 gap-x-6 gap-y-4 text-sm sm:grid-cols-3">
			{@render detail('PID', String(p.pid))}
			{@render detail(m.processes_parent(), p.parent_pid === null ? '—' : String(p.parent_pid))}
			{@render detail(m.processes_table_user(), p.user ?? '—')}
			{@render detail('CPU', fmtPercent(p.cpu_percent, 1))}
			{@render detail(m.processes_table_memory(), fmtBytes(p.memory_bytes))}
			{@render detail(m.processes_table_threads(), String(p.threads ?? '—'))}
			{@render detail(m.processes_table_state(), p.state)}
			{@render detail(
				m.processes_started(),
				p.started_at ? new Date(p.started_at * 1000).toLocaleString() : '—'
			)}
		</div>
		<div class="mt-5 space-y-4">
			{@render detail(m.processes_command(), p.cmd.join(' ') || '—')}
			{@render detail(m.processes_executable(), p.exe ?? '—')}
			{@render detail(m.processes_directory(), p.cwd ?? '—')}
		</div>
	{/if}
	{#snippet footer()}
		<Button variant="ghost" size="sm" onclick={() => (selected = null)}
			>{m.processes_close()}</Button
		>
		{#if selectedProcess}<Button
				variant="danger"
				size="sm"
				onclick={() => {
					if (selectedProcess) openKillModal(selectedProcess.pid, selectedProcess.name);
				}}>{m.processes_kill_title()}</Button
			>{/if}
	{/snippet}
</Modal>

{#snippet detail(label: string, value: string)}
	<div class="min-w-0">
		<div class="mb-1 text-xs text-[var(--color-fg-muted)]">{label}</div>
		<div class="font-mono text-xs break-all whitespace-pre-wrap select-text">{value}</div>
	</div>
{/snippet}

{#snippet th(key: ProcessSort, label: string, className: string)}
	<th
		class={cn('px-3 py-3 text-left font-medium', className)}
		aria-sort={sortKey === key ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
	>
		<button
			type="button"
			class="inline-flex items-center gap-1 hover:text-[var(--color-fg)]"
			onclick={() => toggleSort(key)}
			>{label}<span class="inline-block w-2"
				>{sortKey === key ? (sortDir === 'asc' ? '↑' : '↓') : ''}</span
			></button
		>
	</th>
{/snippet}
