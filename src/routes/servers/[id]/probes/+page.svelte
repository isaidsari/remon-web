<script lang="ts">
	import { untrack } from 'svelte';
	import { page } from '$app/state';
	import Card from '$lib/components/ui/Card.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Banner from '$lib/components/ui/Banner.svelte';
	import ProbeStatusBadge from '$lib/components/probes/ProbeStatusBadge.svelte';
	import HistoryChart, { type Series } from '$lib/components/charts/HistoryChart.svelte';
	import { profiles } from '$lib/stores/profiles.svelte';
	import { connections } from '$lib/stores/connections.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { ApiError } from '$lib/api/error';
	import { fmtNumber, fmtRelative } from '$lib/utils/format';
	import { cn } from '$lib/utils/cn';
	import { m } from '$lib/paraglide/messages';
	import type { ProbeDetail, ProbeListEntry, ProbeMetric, ProbeMetricHistoryResponse, ProbeRunDto } from '$lib/types/api';

	let id = $derived(page.params.id ?? '');
	let profile = $derived(id ? profiles.byId(id) : undefined);
	let conn = $derived(profile ? connections.connect(profile) : null);

	$effect(() => {
		if (!conn) return;
		untrack(() => {
			conn.ensureSignedIn().catch((e) => {
				if (e instanceof ApiError) toast.error(m.probes_toast_signin_failed(), { description: e.userMessage });
			});
		});
	});

	let probes = $state<ProbeListEntry[]>([]);
	let loading = $state(false);
	let error = $state<ApiError | null>(null);
	let lastFetched = $state<number | null>(null);

	let expanded = $state<string | null>(null);
	let detailCache = $state<Record<string, ProbeDetail | { error: string }>>({});
	let historyCache = $state<Record<string, ProbeRunDto[] | { error: string }>>({});
	let historyHasMore = $state<Record<string, boolean>>({});
	let historyLoadingMoreMap = $state<Record<string, boolean>>({});
	const HISTORY_PAGE = 50;
	let detailLoading = $state<Record<string, boolean>>({});
	let historyLoading = $state<Record<string, boolean>>({});

	let metricHistoryCache = $state<Record<string, ProbeMetricHistoryResponse | { error: string }>>({});
	let metricHistoryLoading = $state<Record<string, boolean>>({});

	async function ensureMetricHistory(probe: string, metric: string) {
		const key = `${probe}::${metric}`;
		if (metricHistoryCache[key] || metricHistoryLoading[key]) return;
		metricHistoryLoading[key] = true;
		try {
			const res = await conn!.client.getProbeMetricHistory(probe, metric, { limit: 200 });
			metricHistoryCache[key] = res;
		} catch {
			metricHistoryCache[key] = { error: 'No data available.' };
		} finally {
			metricHistoryLoading[key] = false;
		}
	}

	let reloading = $state(false);
	let autoRefresh = $state(false);

	async function fetchList() {
		if (!conn?.isAuthenticated) return;
		loading = true;
		error = null;
		try {
			const res = await conn.client.listProbes();
			probes = res.probes;
			lastFetched = Date.now();
		} catch (e) {
			if (e instanceof ApiError) error = e;
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		if (conn?.isAuthenticated) fetchList();
	});

	$effect(() => {
		if (!autoRefresh || !conn?.isAuthenticated) return;
		const t = setInterval(fetchList, 10_000);
		return () => clearInterval(t);
	});

	async function ensureDetail(name: string) {
		if (detailCache[name]) return;
		detailLoading[name] = true;
		try {
			const res = await conn!.client.getProbe(name);
			detailCache[name] = res;
		} catch (e) {
			detailCache[name] = { error: e instanceof ApiError ? e.userMessage : String(e) };
		} finally {
			detailLoading[name] = false;
		}
	}

	async function ensureHistory(name: string) {
		if (historyCache[name]) return;
		historyLoading[name] = true;
		try {
			const res = await conn!.client.getProbeHistory(name, HISTORY_PAGE);
			historyCache[name] = res.runs;
			historyHasMore[name] = res.runs.length === HISTORY_PAGE;
		} catch (e) {
			historyCache[name] = { error: e instanceof ApiError ? e.userMessage : String(e) };
		} finally {
			historyLoading[name] = false;
		}
	}

	async function loadMoreHistory(name: string) {
		const current = historyCache[name];
		if (!current || isError(current) || historyLoadingMoreMap[name]) return;
		historyLoadingMoreMap[name] = true;
		try {
			const res = await conn!.client.getProbeHistory(name, HISTORY_PAGE, current.length);
			historyCache[name] = [...current, ...res.runs];
			historyHasMore[name] = res.runs.length === HISTORY_PAGE;
		} catch (e) {
			if (e instanceof ApiError) toast.error(e.userMessage);
		} finally {
			historyLoadingMoreMap[name] = false;
		}
	}

	function toggleExpand(name: string) {
		if (expanded === name) {
			expanded = null;
			return;
		}
		expanded = name;
		void ensureDetail(name);
	}

	async function reload() {
		reloading = true;
		try {
			const res = await conn!.client.reloadProbes();
			toast.success(
				m.probes_toast_reload_summary({
					loaded: res.loaded.length,
					disabled: res.skipped_disabled.length,
					platform: res.skipped_platform.length,
					failed: res.failed.length
				}),
				{ duration: 6000 }
			);
			if (res.failed.length > 0) {
				toast.error(m.probes_toast_validate_failed(), {
					description: res.failed.map((f) => `${f.path}: ${f.error}`).join('\n')
				});
			}
			detailCache = {};
			historyCache = {};
			metricHistoryCache = {};
			await fetchList();
		} catch (e) {
			if (e instanceof ApiError) toast.error(m.probes_toast_reload_failed(), { description: e.userMessage });
		} finally {
			reloading = false;
		}
	}

	function fmtDuration(ms: number): string {
		if (!Number.isFinite(ms)) return '—';
		if (ms < 1000) return `${ms}ms`;
		return `${(ms / 1000).toFixed(2)}s`;
	}

	function isError<T>(x: T | { error: string }): x is { error: string } {
		return !!x && typeof x === 'object' && 'error' in (x as object);
	}
</script>

{#if profile}
	<div class="px-4 py-6 md:px-8 md:py-8">
		<header class="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
			<div>
				<h1 class="flex items-baseline gap-2.5 text-[24px] font-semibold tracking-tight">
					{m.section_probes()}
					<span
						class="rounded-md bg-[var(--color-surface-2)] px-2 py-0.5 font-mono text-[12px] font-medium text-[var(--color-fg-muted)] shadow-[inset_0_0_0_1px_var(--color-border)]"
					>
						{probes.length}
					</span>
				</h1>
				<p class="mt-1.5 max-w-md text-[13px] text-[var(--color-fg-muted)]">
					{m.probes_page_description()}
					{#if lastFetched}
						<span class="ml-2 text-[12px] text-[var(--color-fg-subtle)]">
							{m.probes_updated_at({ time: new Date(lastFetched).toLocaleTimeString() })}
						</span>
					{/if}
				</p>
			</div>
			<div class="flex flex-wrap items-center gap-2">
				<label class="flex items-center gap-1.5 text-[12px] text-[var(--color-fg-muted)]">
					<input
						type="checkbox"
						bind:checked={autoRefresh}
						class="accent-[var(--color-accent)]"
					/>
					{m.probes_auto_refresh()}
				</label>
				<Button variant="secondary" size="sm" onclick={fetchList} loading={loading}>
					{m.probes_refresh()}
				</Button>
				<Button variant="primary" size="sm" onclick={reload} loading={reloading}>
					{m.probes_reload_manifests()}
				</Button>
			</div>
		</header>

		{#if !conn?.isAuthenticated}
			<Card padding="lg" class="border-[var(--color-warning)]/30">
				<p class="text-sm text-[var(--color-fg-muted)]">
					{m.probes_signin_required()}
				</p>
			</Card>
		{:else if error}
			<Banner variant="danger" title={m.probes_fetch_failed_title()}>
				{error.userMessage}
				{#snippet actions()}
					<Button variant="secondary" size="sm" onclick={fetchList}>{m.probes_retry()}</Button>
				{/snippet}
			</Banner>
		{:else if probes.length === 0 && !loading}
			<Card padding="lg">
				<p class="text-sm text-[var(--color-fg-subtle)]">
					{m.probes_empty_prefix()}
					<span class="font-mono text-[var(--color-fg-muted)]">configs/probes/</span>
					{m.probes_empty_suffix()}
				</p>
			</Card>
		{:else}
			<Card padding="none" class="overflow-hidden">
				<div class="max-h-[calc(100vh-22rem)] overflow-auto">
					<table class="w-full text-sm">
						<thead
							class="sticky top-0 z-10 bg-[var(--color-surface-2)] text-[11px] font-medium tracking-[0.06em] text-[var(--color-fg-muted)]"
						>
							<tr>
								<th class="px-3 py-2.5 text-left font-medium">{m.probes_table_status()}</th>
								<th class="px-3 py-2.5 text-left font-medium">{m.probes_table_name()}</th>
								<th class="px-3 py-2.5 text-left font-medium">{m.probes_table_schedule()}</th>
								<th class="px-3 py-2.5 text-left font-medium">{m.probes_table_last_run()}</th>
								<th class="px-3 py-2.5 text-left font-medium">{m.probes_table_message()}</th>
								<th class="px-3 py-2.5 text-right font-medium">{m.probes_table_boot()}</th>
							</tr>
						</thead>
						<tbody>
							{#each probes as p (p.name)}
								{@const isOpen = expanded === p.name}
								{@const detail = detailCache[p.name]}
								<tr
									class={cn(
										'cursor-pointer border-t border-[var(--color-border)] transition-colors hover:bg-[var(--color-surface-2)]/50',
										p.last_parse_ok === false && 'bg-[var(--color-danger-bg)]/40',
										!p.enabled && 'opacity-60'
									)}
									onclick={() => toggleExpand(p.name)}
								>
									<td class="px-3 py-2.5">
										<ProbeStatusBadge parseOk={p.last_parse_ok} />
									</td>
									<td class="px-3 py-2.5">
										<div class="flex flex-col">
											<span class="font-mono text-[12px] font-medium text-[var(--color-fg)]"
												>{p.name}</span
											>
											{#if p.description}
												<span class="mt-0.5 truncate text-[11px] text-[var(--color-fg-muted)]">
													{p.description}
												</span>
											{/if}
										</div>
									</td>
									<td class="px-3 py-2.5 font-mono text-[11px] text-[var(--color-fg-muted)]">
										{p.schedule}
									</td>
									<td class="px-3 py-2.5 font-mono text-[11px] text-[var(--color-fg-muted)]">
										{p.last_run_at ? fmtRelative(p.last_run_at) : '—'}
									</td>
									<td class="px-3 py-2.5">
										{#if p.last_message}
											<span
												class="block max-w-[40ch] truncate text-[12px] text-[var(--color-fg-muted)]"
												title={p.last_message}
											>
												{p.last_message}
											</span>
										{:else}
											<span class="text-[var(--color-fg-faint)]">—</span>
										{/if}
									</td>
									<td class="px-3 py-2.5 text-right">
										{#if p.enabled}
											<span
												class="text-[11px] tracking-wide text-[var(--color-success)]"
												>{m.probes_enabled()}</span
											>
										{:else}
											<span
												class="text-[11px] tracking-wide text-[var(--color-fg-subtle)]"
												>{m.probes_disabled()}</span
											>
										{/if}
									</td>
								</tr>
								{#if isOpen}
									<tr class="border-t border-[var(--color-border)] bg-[var(--color-bg-soft)]/50">
										<td colspan="6" class="px-5 py-4">
											{#if detailLoading[p.name]}
												<p class="text-[12px] text-[var(--color-fg-subtle)]">
													{m.probes_loading_detail()}
												</p>
											{:else if detail && isError(detail)}
												<p class="text-[12px] text-[var(--color-danger)]">
													{detail.error}
												</p>
											{:else if detail}
												{@render detailPanel(detail, p.name)}
											{/if}
										</td>
									</tr>
								{/if}
							{/each}
						</tbody>
					</table>
				</div>
			</Card>
		{/if}
	</div>
{/if}

{#snippet detailPanel(d: ProbeDetail, name: string)}
	<div class="grid grid-cols-1 gap-5 lg:grid-cols-[280px_1fr]">
		<dl class="flex flex-col gap-3 text-[12px]">
			<div class="flex flex-col">
				<dt class="font-mono text-[11px] font-medium tracking-[0.08em] text-[var(--color-fg-muted)]">
					{m.probes_detail_schedule()}
				</dt>
				<dd class="mt-0.5 font-mono text-[var(--color-fg)]">{d.schedule}</dd>
			</div>
			<div class="flex flex-col">
				<dt class="font-mono text-[11px] font-medium tracking-[0.08em] text-[var(--color-fg-muted)]">
					{m.probes_detail_timeout()}
				</dt>
				<dd class="mt-0.5 font-mono text-[var(--color-fg)]">{d.timeout_ms} ms</dd>
			</div>
			{#if d.platforms.length > 0}
				<div class="flex flex-col">
					<dt class="font-mono text-[11px] font-medium tracking-[0.08em] text-[var(--color-fg-muted)]">
						{m.probes_detail_platforms()}
					</dt>
					<dd class="mt-0.5 flex flex-wrap gap-1">
						{#each d.platforms as p}
							<span
								class="rounded bg-[var(--color-surface-2)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--color-fg-muted)]"
							>
								{p}
							</span>
						{/each}
					</dd>
				</div>
			{/if}
			<div class="flex flex-col">
				<dt class="font-mono text-[11px] font-medium tracking-[0.08em] text-[var(--color-fg-muted)]">
					{m.probes_detail_command()}
				</dt>
				<dd
					class="mt-0.5 rounded bg-[var(--color-surface-2)] px-2 py-1.5 font-mono text-[11px] text-[var(--color-fg)] shadow-[inset_0_0_0_1px_var(--color-border)]"
				>
					{d.command.join(' ')}
				</dd>
			</div>
		</dl>

		<div class="flex flex-col gap-4">
			{#if d.last_run}
				{@render runPanel(d.last_run, d.last_metrics)}
			{:else}
				<p class="text-[12px] text-[var(--color-fg-subtle)]">
					{m.probes_no_run_yet()}
				</p>
			{/if}

			{#if d.last_metrics.length > 0}
				{@render metricHistoryPanel(name, d.last_metrics)}
			{/if}

			{@render historyPanel(name)}
		</div>
	</div>
{/snippet}

{#snippet runPanel(run: ProbeRunDto, metrics: ProbeMetric[])}
	<div class="rounded-md bg-[var(--color-surface)] p-3 shadow-[inset_0_0_0_1px_var(--color-border)]">
		<div class="mb-3 flex items-center justify-between">
			<div class="flex items-center gap-2">
				<ProbeStatusBadge parseOk={run.parse_ok} />
				<span class="font-mono text-[11px] text-[var(--color-fg-muted)]">
					{fmtRelative(run.timestamp)}
				</span>
			</div>
			<div class="flex items-center gap-3 font-mono text-[11px] text-[var(--color-fg-muted)]">
				<span>{m.probes_run_took({ duration: fmtDuration(run.duration_ms) })}</span>
				{#if run.exit_code !== null}
					<span class={run.exit_code === 0 ? '' : 'text-[var(--color-danger)]'}>
						{m.probes_run_exit({ code: run.exit_code })}
					</span>
				{:else}
					<span class="text-[var(--color-warning)]">{m.probes_run_no_exit()}</span>
				{/if}
			</div>
		</div>
		{#if run.message}
			<p class="mb-3 text-[12px] text-[var(--color-fg-muted)]">{run.message}</p>
		{/if}
		{#if metrics.length > 0}
			<div class="hairline-grid grid-cols-2 overflow-hidden rounded shadow-[inset_0_0_0_1px_var(--color-border)] sm:grid-cols-3">
				{#each metrics as m, i (m.name + i)}
					<div class="flex flex-col gap-1 bg-[var(--color-surface)] px-3 py-2">
						<span class="font-mono text-[11px] font-medium tracking-[0.08em] text-[var(--color-fg-muted)]">
							{m.name}
						</span>
						<span class="font-mono text-[13px] tabular-nums text-[var(--color-fg)]">
							{fmtNumber(m.value, 2)}{#if m.unit}<span class="ml-1 text-[11px] text-[var(--color-fg-subtle)]">{m.unit}</span>{/if}
						</span>
						{#if m.labels && Object.keys(m.labels).length > 0}
							<span class="truncate font-mono text-[11px] text-[var(--color-fg-subtle)]">
								{Object.entries(m.labels)
									.map(([k, v]) => `${k}=${v}`)
									.join(' · ')}
							</span>
						{/if}
					</div>
				{/each}
			</div>
		{/if}
	</div>
{/snippet}

{#snippet historyPanel(name: string)}
	{@const history = historyCache[name]}
	<details
		class="rounded-md bg-[var(--color-surface)] shadow-[inset_0_0_0_1px_var(--color-border)]"
		ontoggle={(e) => {
			if ((e.currentTarget as HTMLDetailsElement).open) ensureHistory(name);
		}}
	>
		<summary
			class="cursor-pointer px-3 py-2 font-mono text-[10px] tracking-[0.12em] text-[var(--color-fg-muted)] select-none hover:text-[var(--color-fg)]"
		>
			{m.probes_history_summary()}
		</summary>
		<div class="border-t border-[var(--color-border)] px-3 py-2">
			{#if historyLoading[name]}
				<p class="font-mono text-[11px] text-[var(--color-fg-subtle)]">{m.probes_loading_history()}</p>
			{:else if history && isError(history)}
				<p class="font-mono text-[11px] text-[var(--color-danger)]">{history.error}</p>
			{:else if history && history.length === 0}
				<p class="text-[12px] text-[var(--color-fg-muted)]">
					{m.probes_no_history()}
				</p>
			{:else if history}
				<div class="max-h-72 overflow-auto">
					<table class="w-full text-[11px]">
						<thead class="text-[11px] font-medium tracking-[0.06em] text-[var(--color-fg-muted)]">
							<tr>
								<th class="py-1 text-left font-medium">{m.probes_history_col_when()}</th>
								<th class="py-1 text-left font-medium">{m.probes_history_col_parse()}</th>
								<th class="py-1 text-right font-medium">{m.probes_history_col_duration()}</th>
								<th class="py-1 text-right font-medium">{m.probes_history_col_exit()}</th>
								<th class="py-1 text-left font-medium">{m.probes_history_col_message()}</th>
							</tr>
						</thead>
						<tbody class="font-mono">
							{#each history as r, i (r.timestamp + ':' + i)}
								<tr class="border-t border-[var(--color-border)]">
									<td class="py-1 text-[var(--color-fg-muted)]">
										{new Date(r.timestamp * 1000).toLocaleString()}
									</td>
									<td class="py-1">
										<ProbeStatusBadge parseOk={r.parse_ok} />
									</td>
									<td class="py-1 text-right text-[var(--color-fg-muted)]">
										{fmtDuration(r.duration_ms)}
									</td>
									<td
										class={cn(
											'py-1 text-right',
											r.exit_code === 0
												? 'text-[var(--color-fg-muted)]'
												: 'text-[var(--color-danger)]'
										)}
									>
										{r.exit_code ?? '—'}
									</td>
									<td class="py-1">
										<span class="block max-w-[36ch] truncate text-[var(--color-fg-muted)]">
											{r.message ?? '—'}
										</span>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
				{#if historyHasMore[name]}
					<div class="mt-2 text-center">
						<button
							type="button"
							onclick={() => loadMoreHistory(name)}
							disabled={historyLoadingMoreMap[name]}
							class="text-[11px] text-[var(--color-fg-muted)] transition hover:text-[var(--color-fg)] disabled:opacity-50"
						>
							{historyLoadingMoreMap[name] ? m.alerts_events_loading_more() : m.probes_history_load_more()}
						</button>
					</div>
				{/if}
			{/if}
		</div>
	</details>
{/snippet}

{#snippet metricHistoryPanel(probeName: string, metrics: ProbeMetric[])}
	{@const COLORS = ['#818cf8', '#34d399', '#fb923c', '#f472b6', '#60a5fa', '#a78bfa']}
	<details
		class="rounded-md bg-[var(--color-surface)] shadow-[inset_0_0_0_1px_var(--color-border)]"
		ontoggle={(e) => {
			if ((e.currentTarget as HTMLDetailsElement).open) {
				for (const metric of metrics) {
					void ensureMetricHistory(probeName, metric.name);
				}
			}
		}}
	>
		<summary
			class="cursor-pointer px-3 py-2 font-mono text-[10px] tracking-[0.12em] text-[var(--color-fg-muted)] select-none hover:text-[var(--color-fg)]"
		>
			METRIC HISTORY
		</summary>
		<div class="flex flex-col gap-4 border-t border-[var(--color-border)] px-3 py-3">
			{#each metrics as metric, i (metric.name)}
				{@const key = `${probeName}::${metric.name}`}
				{@const entry = metricHistoryCache[key]}
				{@const loading = metricHistoryLoading[key]}
				{@const color = COLORS[i % COLORS.length]}
				<div class="flex flex-col gap-1.5">
					<div class="flex items-baseline gap-2">
						<span class="font-mono text-[11px] font-medium tracking-[0.08em] text-[var(--color-fg-muted)]">
							{metric.name}
						</span>
						{#if metric.unit}
							<span class="font-mono text-[10px] text-[var(--color-fg-subtle)]">{metric.unit}</span>
						{/if}
					</div>
					{#if loading}
						<div class="h-[100px] animate-pulse rounded bg-[var(--color-surface-2)]"></div>
					{:else if !entry}
						<div class="h-[100px] rounded bg-[var(--color-surface-2)]"></div>
					{:else if isError(entry)}
						<p class="py-2 text-[11px] text-[var(--color-fg-subtle)]">{entry.error}</p>
					{:else if entry.points.length === 0}
						<p class="py-2 text-[11px] text-[var(--color-fg-subtle)]">No data yet.</p>
					{:else}
						{@const series: Series[] = [{
							name: metric.name,
							data: {
								xs: entry.points.map((pt) => pt.timestamp),
								ys: entry.points.map((pt) => pt.value)
							},
							color,
							fill: true
						}]}
						<HistoryChart {series} height={100} yMin={0} />
					{/if}
				</div>
			{/each}
		</div>
	</details>
{/snippet}
