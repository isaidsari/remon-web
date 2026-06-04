<script lang="ts">
	import { untrack } from 'svelte';
	import { page } from '$app/state';
	import Card from '$lib/components/ui/Card.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Banner from '$lib/components/ui/Banner.svelte';
	import AutoRefreshSelect from '$lib/components/ui/AutoRefreshSelect.svelte';
	import RefreshButton from '$lib/components/ui/RefreshButton.svelte';
	import ProbeStatusBadge from '$lib/components/probes/ProbeStatusBadge.svelte';
	import HistoryChart, { type Series } from '$lib/components/charts/HistoryChart.svelte';
	import { profiles } from '$lib/stores/profiles.svelte';
	import { connections } from '$lib/stores/connections.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { ApiError } from '$lib/api/error';
	import { fmtBytes, fmtNumber, fmtPercent, fmtRelative } from '$lib/utils/format';
	import { formatLabelKey as formatLabelKeyBase } from '$lib/utils/probeMetrics';
	import { cn } from '$lib/utils/cn';
	import { m } from '$lib/paraglide/messages';
	import IconChevronDown from '~icons/lucide/chevron-down';
	import type {
		ProbeDetail,
		ProbeListEntry,
		ProbeMetric,
		ProbeMetricHistoryResponse,
		ProbeMetricPoint,
		ProbeRunDto
	} from '$lib/types/api';

	let id = $derived(page.params.id ?? '');
	let profile = $derived(id ? profiles.byId(id) : undefined);
	let conn = $derived(profile ? connections.connect(profile) : null);

	$effect(() => {
		if (!conn) return;
		untrack(() => {
			conn.ensureSignedIn().catch((e) => {
				if (e instanceof ApiError)
					toast.error(m.probes_toast_signin_failed(), { description: e.userMessage });
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

	let metricHistoryCache = $state<Record<string, ProbeMetricHistoryResponse | { error: string }>>(
		{}
	);
	let metricHistoryLoading = $state<Record<string, boolean>>({});
	// Per-metric selected label set key. Keyed by `${probe}::${metric}`.
	let metricSelectedLabel = $state<Record<string, string>>({});

	let q = $state('');
	let reloading = $state(false);
	let autoRefresh = $state(false);

	let filteredProbes = $derived.by(() => {
		const needle = q.trim().toLowerCase();
		if (!needle) return probes;
		return probes.filter(
			(p) =>
				p.name.toLowerCase().includes(needle) ||
				(p.description?.toLowerCase().includes(needle) ?? false)
		);
	});

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

	async function ensureMetricHistory(probe: string, metric: string) {
		const key = `${probe}::${metric}`;
		if (metricHistoryCache[key] || metricHistoryLoading[key]) return;
		metricHistoryLoading[key] = true;
		try {
			const res = await conn!.client.getProbeMetricHistory(probe, metric, { limit: 500 });
			metricHistoryCache[key] = res;
		} catch {
			metricHistoryCache[key] = { error: m.probes_metric_unavailable() };
		} finally {
			metricHistoryLoading[key] = false;
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
			metricSelectedLabel = {};
			await fetchList();
		} catch (e) {
			if (e instanceof ApiError)
				toast.error(m.probes_toast_reload_failed(), { description: e.userMessage });
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

	// Canonical JSON for label set — must match server-side key shape so the
	// dropdown selection survives across refetches even if the server emits
	// labels with the same keys in different insertion orders.
	function labelKey(labels: Record<string, string>): string {
		const keys = Object.keys(labels).sort();
		const obj: Record<string, string> = {};
		for (const k of keys) obj[k] = labels[k];
		return JSON.stringify(obj);
	}

	// Localized wrapper over the shared formatter; blank label-set renders as "none".
	function formatLabelKey(key: string): string {
		return formatLabelKeyBase(key) || m.probes_metric_labels_none();
	}

	// Unit-aware value formatting. The probe API gives us free-form unit
	// strings; we special-case the common ones and fall back to "number unit"
	// for everything else so unknown units still render readably.
	function normalizeUnit(unit: string | null | undefined): string {
		return (unit ?? '').trim().toLowerCase();
	}

	// Integer counts render without trailing ".00" — `3 bans` reads better
	// than `3.00 bans`. Floats keep two decimals.
	function fmtScalar(value: number): string {
		return Number.isInteger(value) ? value.toString() : fmtNumber(value, 2);
	}

	function formatMetricValue(value: number, unit: string | null | undefined): string {
		if (!Number.isFinite(value)) return '—';
		switch (normalizeUnit(unit)) {
			case 'bytes':
			case 'byte':
			case 'b':
				return fmtBytes(value);
			case 'percent':
			case 'pct':
			case '%':
				return fmtPercent(value);
			case '':
				return fmtScalar(value);
			default:
				// Pass arbitrary units through unchanged: `42 bans`, `127 scrapes`,
				// `3 connections`. The probe is the source of truth for what the
				// number means; we just spell it.
				return `${fmtScalar(value)} ${unit}`;
		}
	}

	// Returned to HistoryChart so axis ticks + tooltip values respect the unit.
	function chartFormatterFor(unit: string | null | undefined): (v: number | null) => string {
		return (v) => (v === null || !Number.isFinite(v) ? '' : formatMetricValue(v, unit));
	}

	type MetricGroup = {
		name: string;
		unit: string | null;
		entries: ProbeMetric[];
	};

	// Bucket a flat metric list (one row per name × label-set) into one
	// group per metric name. Lets the run panel render a single header per
	// metric with the label rows underneath, instead of N×M flat cards.
	function groupMetricsByName(metrics: ProbeMetric[]): MetricGroup[] {
		const map = new Map<string, MetricGroup>();
		for (const metric of metrics) {
			let g = map.get(metric.name);
			if (!g) {
				g = { name: metric.name, unit: metric.unit ?? null, entries: [] };
				map.set(metric.name, g);
			}
			g.entries.push(metric);
		}
		return Array.from(map.values());
	}

	function formatLabels(labels: Record<string, string> | undefined): string {
		if (!labels) return '';
		const entries = Object.entries(labels);
		if (entries.length === 0) return '';
		return entries.map(([k, v]) => `${k}=${v}`).join(' · ');
	}

	type LabelGroup = { key: string; points: ProbeMetricPoint[] };

	// Group the raw point list into one stream per label set so multi-mount /
	// multi-host probes don't get drawn as a single jagged line.
	function groupPointsByLabel(points: ProbeMetricPoint[]): LabelGroup[] {
		const groups = new Map<string, ProbeMetricPoint[]>();
		for (const p of points) {
			const k = labelKey(p.labels ?? {});
			let arr = groups.get(k);
			if (!arr) {
				arr = [];
				groups.set(k, arr);
			}
			arr.push(p);
		}
		const result: LabelGroup[] = [];
		for (const [key, pts] of groups) result.push({ key, points: pts });
		// Stable ordering: most-populated group first, then by key for determinism.
		result.sort((a, b) => b.points.length - a.points.length || a.key.localeCompare(b.key));
		return result;
	}
</script>

{#if profile}
	<div class="px-4 py-6 md:px-8 md:py-8">
		<header class="mb-4 flex flex-col gap-3 sm:mb-6 sm:flex-row sm:items-end sm:justify-between">
			<div>
				<h1
					class="flex items-baseline gap-2.5 text-[22px] font-semibold tracking-tight sm:text-[24px]"
				>
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
				<AutoRefreshSelect
					value={autoRefresh ? '10s' : 'off'}
					options={[
						{ value: 'off', label: m.chart_autorefresh_off() },
						{ value: '10s', label: '10s' }
					]}
					onChange={(next) => (autoRefresh = next !== 'off')}
					class="w-[8.5rem]"
				/>
				<RefreshButton onclick={fetchList} {loading} label={m.probes_refresh()} />
				<Button variant="primary" size="sm" onclick={reload} loading={reloading}>
					{m.probes_reload_manifests()}
				</Button>
			</div>
		</header>

		{#if !conn?.isAuthenticated}
			<Card padding="lg" class="border-[var(--color-warning)]/30">
				<p class="text-sm text-[var(--color-fg-muted)]">{m.probes_signin_required()}</p>
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
			{#if probes.length > 0}
				<div class="mb-3 flex">
					<Input
						placeholder={m.probes_filter_placeholder()}
						bind:value={q}
						class="w-full text-sm sm:max-w-xs"
					/>
				</div>
			{/if}

			<!-- Desktop / tablet: dense table -->
			<Card padding="none" class="hidden overflow-hidden md:block">
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
								<th class="w-8 px-2 py-2.5" aria-hidden="true"></th>
							</tr>
						</thead>
						<tbody>
							{#each filteredProbes as p (p.name)}
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
									<td class="px-3 py-2.5"><ProbeStatusBadge parseOk={p.last_parse_ok} /></td>
									<td class="px-3 py-2.5">
										<div class="flex flex-col">
											<span class="font-mono text-[12px] font-medium text-[var(--color-fg)]"
												>{p.name}</span
											>
											{#if p.description}
												<span class="mt-0.5 truncate text-[11px] text-[var(--color-fg-muted)]"
													>{p.description}</span
												>
											{/if}
										</div>
									</td>
									<td class="px-3 py-2.5 font-mono text-[11px] text-[var(--color-fg-muted)]"
										>{p.schedule}</td
									>
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
											<span class="text-[11px] tracking-wide text-[var(--color-success)]"
												>{m.probes_enabled()}</span
											>
										{:else}
											<span class="text-[11px] tracking-wide text-[var(--color-fg-subtle)]"
												>{m.probes_disabled()}</span
											>
										{/if}
									</td>
									<td class="px-2 py-2.5 text-right">
										<IconChevronDown
											class={cn(
												'inline size-3.5 text-[var(--color-fg-subtle)] transition-transform duration-[var(--dur-fast)]',
												isOpen && 'rotate-180'
											)}
											stroke-width="2"
										/>
									</td>
								</tr>
								{#if isOpen}
									<tr class="border-t border-[var(--color-border)] bg-[var(--color-bg-soft)]/50">
										<td colspan="7" class="px-5 py-4">
											{#if detailLoading[p.name]}
												<p class="text-[12px] text-[var(--color-fg-subtle)]">
													{m.probes_loading_detail()}
												</p>
											{:else if detail && isError(detail)}
												<p class="text-[12px] text-[var(--color-danger)]">{detail.error}</p>
											{:else if detail}
												{@render detailPanel(detail, p.name)}
											{/if}
										</td>
									</tr>
								{/if}
							{/each}
							{#if filteredProbes.length === 0 && probes.length > 0}
								<tr>
									<td
										colspan="7"
										class="px-3 py-10 text-center text-[13px] text-[var(--color-fg-subtle)]"
									>
										{m.probes_empty_filter()}
									</td>
								</tr>
							{/if}
						</tbody>
					</table>
				</div>
			</Card>

			<!-- Mobile: stacked cards -->
			<div class="flex flex-col gap-2 md:hidden">
				{#each filteredProbes as p (p.name)}
					{@const isOpen = expanded === p.name}
					{@const detail = detailCache[p.name]}
					<Card
						padding="none"
						class={cn(
							'overflow-hidden transition-colors',
							p.last_parse_ok === false && 'border-[var(--color-danger)]/40',
							!p.enabled && 'opacity-70'
						)}
					>
						<button
							type="button"
							onclick={() => toggleExpand(p.name)}
							aria-expanded={isOpen}
							aria-label={isOpen ? m.probes_card_collapse() : m.probes_card_expand()}
							class="flex w-full flex-col gap-2 px-3.5 py-3 text-left transition-colors hover:bg-[var(--color-surface-2)]/40"
						>
							<div class="flex items-start justify-between gap-2">
								<div class="flex min-w-0 flex-1 flex-col">
									<div class="flex flex-wrap items-center gap-2">
										<span
											class="font-mono text-[13px] font-medium text-[var(--color-fg)] break-all"
										>
											{p.name}
										</span>
										<ProbeStatusBadge parseOk={p.last_parse_ok} />
										{#if !p.enabled}
											<span
												class="rounded bg-[var(--color-surface-2)] px-1.5 py-0.5 font-mono text-[10px] tracking-wide text-[var(--color-fg-subtle)]"
											>
												{m.probes_disabled()}
											</span>
										{/if}
									</div>
									{#if p.description}
										<span class="mt-1 text-[12px] leading-snug text-[var(--color-fg-muted)]"
											>{p.description}</span
										>
									{/if}
								</div>
								<IconChevronDown
									class={cn(
										'mt-0.5 size-4 shrink-0 text-[var(--color-fg-subtle)] transition-transform duration-[var(--dur-fast)]',
										isOpen && 'rotate-180'
									)}
									stroke-width="2"
								/>
							</div>
							<dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px]">
								<dt class="text-[var(--color-fg-subtle)]">{m.probes_card_schedule_label()}</dt>
								<dd class="font-mono text-[var(--color-fg-muted)] break-all">{p.schedule}</dd>
								<dt class="text-[var(--color-fg-subtle)]">{m.probes_card_last_run_label()}</dt>
								<dd class="font-mono text-[var(--color-fg-muted)]">
									{p.last_run_at ? fmtRelative(p.last_run_at) : '—'}
								</dd>
								{#if p.last_message}
									<dt class="text-[var(--color-fg-subtle)]">{m.probes_table_message()}</dt>
									<dd class="text-[var(--color-fg-muted)] break-words">{p.last_message}</dd>
								{/if}
							</dl>
						</button>
						{#if isOpen}
							<div
								class="border-t border-[var(--color-border)] bg-[var(--color-bg-soft)]/40 px-3.5 py-3"
							>
								{#if detailLoading[p.name]}
									<p class="text-[12px] text-[var(--color-fg-subtle)]">
										{m.probes_loading_detail()}
									</p>
								{:else if detail && isError(detail)}
									<p class="text-[12px] text-[var(--color-danger)]">{detail.error}</p>
								{:else if detail}
									{@render detailPanel(detail, p.name)}
								{/if}
							</div>
						{/if}
					</Card>
				{/each}
				{#if filteredProbes.length === 0 && probes.length > 0}
					<Card padding="lg" class="text-center">
						<p class="text-[13px] text-[var(--color-fg-subtle)]">{m.probes_empty_filter()}</p>
					</Card>
				{/if}
			</div>
		{/if}
	</div>
{/if}

{#snippet detailPanel(d: ProbeDetail, name: string)}
	<div class="grid grid-cols-1 gap-5 lg:grid-cols-[280px_1fr]">
		<dl class="flex flex-col gap-3 text-[12px]">
			<div class="flex flex-col">
				<dt
					class="font-mono text-[11px] font-medium tracking-[0.08em] text-[var(--color-fg-muted)]"
				>
					{m.probes_detail_schedule()}
				</dt>
				<dd class="mt-0.5 font-mono text-[var(--color-fg)] break-all">{d.schedule}</dd>
			</div>
			<div class="flex flex-col">
				<dt
					class="font-mono text-[11px] font-medium tracking-[0.08em] text-[var(--color-fg-muted)]"
				>
					{m.probes_detail_timeout()}
				</dt>
				<dd class="mt-0.5 font-mono text-[var(--color-fg)]">{d.timeout_ms} ms</dd>
			</div>
			{#if d.platforms.length > 0}
				<div class="flex flex-col">
					<dt
						class="font-mono text-[11px] font-medium tracking-[0.08em] text-[var(--color-fg-muted)]"
					>
						{m.probes_detail_platforms()}
					</dt>
					<dd class="mt-0.5 flex flex-wrap gap-1">
						{#each d.platforms as p (p)}
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
				<dt
					class="font-mono text-[11px] font-medium tracking-[0.08em] text-[var(--color-fg-muted)]"
				>
					{m.probes_detail_command()}
				</dt>
				<dd
					class="mt-0.5 rounded bg-[var(--color-surface-2)] px-2 py-1.5 font-mono text-[11px] leading-relaxed text-[var(--color-fg)] break-all whitespace-pre-wrap shadow-[inset_0_0_0_1px_var(--color-border)]"
				>
					{d.command.join(' ')}
				</dd>
			</div>
		</dl>

		<div class="flex flex-col gap-4">
			{#if d.last_run}
				{@render runPanel(d.last_run, d.last_metrics)}
			{:else}
				<p class="text-[12px] text-[var(--color-fg-subtle)]">{m.probes_no_run_yet()}</p>
			{/if}

			{#if d.last_metrics.length > 0}
				{@render metricHistoryPanel(name, d.last_metrics)}
			{/if}

			{@render historyPanel(name)}
		</div>
	</div>
{/snippet}

{#snippet runPanel(run: ProbeRunDto, metrics: ProbeMetric[])}
	<div
		class="rounded-md bg-[var(--color-surface)] p-3 shadow-[inset_0_0_0_1px_var(--color-border)]"
	>
		<div class="mb-3 flex flex-wrap items-center justify-between gap-2">
			<div class="flex items-center gap-2">
				<ProbeStatusBadge parseOk={run.parse_ok} />
				<span class="font-mono text-[11px] text-[var(--color-fg-muted)]"
					>{fmtRelative(run.timestamp)}</span
				>
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
			<p class="mb-3 text-[12px] break-words text-[var(--color-fg-muted)]">{run.message}</p>
		{/if}
		{#if metrics.length > 0}
			{@const groups = groupMetricsByName(metrics)}
			<div class="flex flex-col gap-2">
				{#each groups as g (g.name)}
					{@const singleUnlabelled =
						g.entries.length === 1 && Object.keys(g.entries[0].labels ?? {}).length === 0}
					<div class="rounded border border-[var(--color-border)] bg-[var(--color-surface)]">
						<div class="flex items-baseline justify-between gap-2 px-3 py-1.5">
							<span
								class="font-mono text-[11px] font-medium tracking-[0.08em] text-[var(--color-fg-muted)] break-all"
							>
								{g.name}
							</span>
							{#if g.unit}
								<span class="font-mono text-[10px] text-[var(--color-fg-subtle)]">{g.unit}</span>
							{/if}
						</div>
						{#if singleUnlabelled}
							<div class="px-3 pb-2 font-mono text-[14px] tabular-nums text-[var(--color-fg)]">
								{formatMetricValue(g.entries[0].value, g.unit)}
							</div>
						{:else}
							<dl
								class="divide-y divide-[var(--color-border)] border-t border-[var(--color-border)]"
							>
								<!-- index in key: a script can emit duplicate label-sets, so labelKey alone isn't unique -->
								{#each g.entries as entry, i (labelKey(entry.labels ?? {}) + ':' + i)}
									<div class="flex items-baseline justify-between gap-3 px-3 py-1.5">
										<dt
											class="min-w-0 flex-1 truncate font-mono text-[11px] text-[var(--color-fg-subtle)]"
										>
											{formatLabels(entry.labels) || m.probes_metric_labels_none()}
										</dt>
										<dd class="shrink-0 font-mono text-[13px] tabular-nums text-[var(--color-fg)]">
											{formatMetricValue(entry.value, g.unit)}
										</dd>
									</div>
								{/each}
							</dl>
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
				<p class="font-mono text-[11px] text-[var(--color-fg-subtle)]">
					{m.probes_loading_history()}
				</p>
			{:else if history && isError(history)}
				<p class="font-mono text-[11px] text-[var(--color-danger)]">{history.error}</p>
			{:else if history && history.length === 0}
				<p class="text-[12px] text-[var(--color-fg-muted)]">{m.probes_no_history()}</p>
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
									<td class="py-1 text-[var(--color-fg-muted)]"
										>{new Date(r.timestamp * 1000).toLocaleString()}</td
									>
									<td class="py-1"><ProbeStatusBadge parseOk={r.parse_ok} /></td>
									<td class="py-1 text-right text-[var(--color-fg-muted)]"
										>{fmtDuration(r.duration_ms)}</td
									>
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
										<span class="block max-w-[36ch] truncate text-[var(--color-fg-muted)]"
											>{r.message ?? '—'}</span
										>
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
							{historyLoadingMoreMap[name]
								? m.alerts_events_loading_more()
								: m.probes_history_load_more()}
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
			class="cursor-pointer px-3 py-2 font-mono text-[10px] tracking-[0.12em] text-[var(--color-fg-muted)] uppercase select-none hover:text-[var(--color-fg)]"
		>
			{m.probes_metric_history()}
		</summary>
		<div class="flex flex-col gap-4 border-t border-[var(--color-border)] px-3 py-3">
			{#each metrics as metric, i (metric.name + ':' + i)}
				{@const key = `${probeName}::${metric.name}`}
				{@const entry = metricHistoryCache[key]}
				{@const loading = metricHistoryLoading[key]}
				{@const color = COLORS[i % COLORS.length]}
				{@const groups: LabelGroup[] = entry && !isError(entry) ? groupPointsByLabel(entry.points) : []}
				{@const fallbackKey = groups[0]?.key ?? ''}
				{@const selectedKey = metricSelectedLabel[key] ?? fallbackKey}
				{@const activeGroup = groups.find((g) => g.key === selectedKey) ?? groups[0]}
				<div class="flex flex-col gap-1.5">
					<div class="flex flex-wrap items-baseline justify-between gap-2">
						<div class="flex items-baseline gap-2">
							<span
								class="font-mono text-[11px] font-medium tracking-[0.08em] text-[var(--color-fg-muted)] break-all"
							>
								{metric.name}
							</span>
							{#if metric.unit}
								<span class="font-mono text-[10px] text-[var(--color-fg-subtle)]"
									>{metric.unit}</span
								>
							{/if}
						</div>
						{#if groups.length > 1}
							<select
								value={selectedKey}
								onchange={(e) =>
									(metricSelectedLabel[key] = (e.currentTarget as HTMLSelectElement).value)}
								class="max-w-[60vw] truncate rounded border border-[var(--color-border)] bg-[var(--color-surface-2)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--color-fg-muted)] focus:border-[var(--color-accent)] focus:outline-none sm:max-w-[28ch]"
							>
								{#each groups as g (g.key)}
									<option value={g.key}>{formatLabelKey(g.key)} ({g.points.length})</option>
								{/each}
							</select>
						{:else if groups.length === 1 && groups[0].key !== '{}'}
							<span
								class="max-w-[60vw] truncate font-mono text-[10px] text-[var(--color-fg-subtle)] sm:max-w-[28ch]"
							>
								{formatLabelKey(groups[0].key)} ({groups[0].points.length})
							</span>
						{/if}
					</div>
					{#if loading}
						<div class="h-[100px] animate-pulse rounded bg-[var(--color-surface-2)]"></div>
					{:else if !entry}
						<div class="h-[100px] rounded bg-[var(--color-surface-2)]"></div>
					{:else if isError(entry)}
						<p class="py-2 text-[11px] text-[var(--color-fg-subtle)]">{entry.error}</p>
					{:else if !activeGroup || activeGroup.points.length === 0}
						<p class="py-2 text-[11px] text-[var(--color-fg-subtle)]">
							{m.probes_metric_no_data()}
						</p>
					{:else}
						{@const series: Series[] = [
							{
								name: metric.name,
								data: {
									xs: activeGroup.points.map((pt) => pt.timestamp),
									ys: activeGroup.points.map((pt) => pt.value)
								},
								color,
								fill: true
							}
						]}
						<HistoryChart
							{series}
							height={160}
							yMin={normalizeUnit(metric.unit) === 'percent' ? 0 : undefined}
							yMax={normalizeUnit(metric.unit) === 'percent' ? 100 : undefined}
							valueFormatter={chartFormatterFor(metric.unit)}
						/>
					{/if}
				</div>
			{/each}
		</div>
	</details>
{/snippet}
