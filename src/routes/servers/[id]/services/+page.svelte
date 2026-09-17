<script lang="ts">
	import { useServer } from '$lib/server-scope';
	import { tabParam } from '$lib/utils/tab';
	import DataTable from '$lib/components/ui/DataTable.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import ErrorState from '$lib/components/ui/ErrorState.svelte';
	import IconButton from '$lib/components/ui/IconButton.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import RefreshButton from '$lib/components/ui/RefreshButton.svelte';
	import Select from '$lib/components/ui/Select.svelte';
	import Switch from '$lib/components/ui/Switch.svelte';
	import Tabs from '$lib/components/layout/Tabs.svelte';
	import LogStream from '$lib/components/common/LogStream.svelte';
	import ServiceStateBadge from '$lib/components/services/ServiceStateBadge.svelte';
	import IconPlay from '~icons/lucide/play';
	import IconSquare from '~icons/lucide/square';
	import IconRotateCcw from '~icons/lucide/rotate-ccw';
	import IconRefreshCw from '~icons/lucide/refresh-cw';
	import IconPlus from '~icons/lucide/plus';
	import IconMinus from '~icons/lucide/minus';
	import { toast } from '$lib/stores/toast.svelte';
	import { confirm } from '$lib/stores/confirm.svelte';
	import { ApiError } from '$lib/api/error';
	import { fmtRelative } from '$lib/utils/format';
	import { cn } from '$lib/utils/cn';
	import { m } from '$lib/paraglide/messages';
	import type {
		CronJobDto,
		ServiceBackend,
		ServiceDto,
		ServiceState,
		TimerDto
	} from '$lib/types/api';

	let { conn } = $derived(useServer());

	const tabs = tabParam(['services', 'timers', 'cron'] as const, 'services');
	let tab = $derived(tabs.current);

	let services = $state<ServiceDto[]>([]);
	let serviceBackend = $state<ServiceBackend | null>(null);
	let servicesLoading = $state(false);
	let servicesError = $state<ApiError | null>(null);
	let stateFilter = $state<ServiceState | 'all'>('all');
	let q = $state('');
	let acting = $state<string | null>(null);
	let expanded = $state<string | null>(null);

	let timers = $state<TimerDto[]>([]);
	let timersLoading = $state(false);
	let timersError = $state<ApiError | null>(null);

	let cronJobs = $state<CronJobDto[]>([]);
	let cronLoading = $state(false);
	let cronError = $state<ApiError | null>(null);

	async function fetchServices() {
		if (!conn.isAuthenticated) return;
		servicesLoading = true;
		servicesError = null;
		try {
			const res = await conn.client.listServices(
				stateFilter === 'all' ? {} : { state: stateFilter }
			);
			services = res.services;
			serviceBackend = res.services[0]?.backend ?? null;
		} catch (e) {
			if (e instanceof ApiError) servicesError = e;
		} finally {
			servicesLoading = false;
		}
	}

	async function fetchTimers() {
		if (!conn.isAuthenticated) return;
		timersLoading = true;
		timersError = null;
		try {
			const res = await conn.client.listTimers();
			timers = res.timers;
		} catch (e) {
			if (e instanceof ApiError) timersError = e;
		} finally {
			timersLoading = false;
		}
	}

	async function fetchCron() {
		if (!conn.isAuthenticated) return;
		cronLoading = true;
		cronError = null;
		try {
			const res = await conn.client.listCronJobs();
			cronJobs = res.jobs;
		} catch (e) {
			if (e instanceof ApiError) cronError = e;
		} finally {
			cronLoading = false;
		}
	}

	function fetchCurrent() {
		if (tab === 'services') void fetchServices();
		else if (tab === 'timers') void fetchTimers();
		else void fetchCron();
	}

	$effect(() => {
		if (!conn.isAuthenticated) return;
		void stateFilter;
		fetchCurrent();
	});

	// Pre-fetch inactive tabs once so badge counts show without the user clicking into each.
	let countsPrimed = $state(false);
	$effect(() => {
		if (!conn.isAuthenticated || countsPrimed) return;
		countsPrimed = true;
		if (tab !== 'timers') void fetchTimers();
		if (tab !== 'cron') void fetchCron();
	});

	let needle = $derived(q.trim().toLowerCase());

	let filteredServices = $derived.by(() => {
		const list = needle
			? services.filter(
					(s) =>
						s.name.toLowerCase().includes(needle) ||
						(s.description ?? '').toLowerCase().includes(needle)
				)
			: services;
		const priority = (s: ServiceDto) => (s.state === 'failed' ? 0 : s.state === 'running' ? 1 : 2);
		return [...list].sort((a, b) => priority(a) - priority(b) || a.name.localeCompare(b.name));
	});

	let filteredTimers = $derived.by(() => {
		const list = needle
			? timers.filter(
					(t) =>
						t.name.toLowerCase().includes(needle) ||
						(t.service ?? '').toLowerCase().includes(needle)
				)
			: timers;
		return [...list].sort((a, b) => {
			if (a.next_run === null && b.next_run === null) return a.name.localeCompare(b.name);
			if (a.next_run === null) return 1;
			if (b.next_run === null) return -1;
			return a.next_run - b.next_run;
		});
	});

	let filteredCron = $derived(
		needle
			? cronJobs.filter(
					(j) =>
						j.command.toLowerCase().includes(needle) ||
						j.schedule.toLowerCase().includes(needle) ||
						(j.user ?? '').toLowerCase().includes(needle)
				)
			: cronJobs
	);

	async function withAction<T>(
		key: string,
		successMsg: string,
		fn: () => Promise<T>
	): Promise<void> {
		acting = key;
		try {
			await fn();
			toast.success(successMsg);
			await fetchServices();
		} catch (e) {
			if (e instanceof ApiError) {
				// Refusing to stop the agent's own unit is a guardrail, not a failure.
				if (e.isSelfTarget) {
					toast.warning(m.error_self_target_title(), { description: e.userMessage });
				} else {
					toast.error(m.services_toast_action_failed(), { description: e.userMessage });
				}
			}
		} finally {
			acting = null;
		}
	}

	function doStart(s: ServiceDto) {
		void withAction(`start:${s.name}`, m.services_toast_started({ name: s.name }), () =>
			conn.client.startService(s.name)
		);
	}
	function doStop(s: ServiceDto) {
		void withAction(`stop:${s.name}`, m.services_toast_stopped({ name: s.name }), () =>
			conn.client.stopService(s.name)
		);
	}
	function doRestart(s: ServiceDto) {
		void withAction(`restart:${s.name}`, m.services_toast_restarted({ name: s.name }), () =>
			conn.client.restartService(s.name)
		);
	}
	function doReload(s: ServiceDto) {
		void withAction(`reload:${s.name}`, m.services_toast_reloaded({ name: s.name }), () =>
			conn.client.reloadService(s.name)
		);
	}
	function doEnable(s: ServiceDto) {
		void withAction(`enable:${s.name}`, m.services_toast_enabled_at_boot({ name: s.name }), () =>
			conn.client.enableService(s.name)
		);
	}
	async function doDisable(s: ServiceDto) {
		const ok = await confirm({
			title: m.services_confirm_disable_title({ name: s.name }),
			description: m.services_confirm_disable_description(),
			confirmLabel: m.services_action_disable(),
			variant: 'warning'
		});
		if (!ok) return;
		void withAction(`disable:${s.name}`, m.services_toast_disabled({ name: s.name }), () =>
			conn.client.disableService(s.name)
		);
	}

	async function toggleTimer(t: TimerDto) {
		const desiredEnable = !(t.enabled_at_boot === true);
		const action = desiredEnable
			? () => conn.client.enableTimer(t.name)
			: () => conn.client.disableTimer(t.name);
		try {
			await action();
			toast.success(
				desiredEnable
					? m.services_toast_timer_enabled({ name: t.name })
					: m.services_toast_timer_disabled({ name: t.name })
			);
			await fetchTimers();
		} catch (e) {
			if (e instanceof ApiError)
				toast.error(m.services_toast_action_failed(), { description: e.userMessage });
		}
	}

	function toggleExpand(name: string) {
		expanded = expanded === name ? null : name;
	}

	let canStreamLogs = $derived(serviceBackend === 'systemd');

	const tabsConfig = $derived([
		{ key: 'services' as const, label: m.section_services(), count: services.length },
		{ key: 'timers' as const, label: m.services_tab_timers(), count: timers.length },
		{ key: 'cron' as const, label: m.services_tab_cron(), count: cronJobs.length }
	]);

	const stateOptions: (ServiceState | 'all')[] = [
		'all',
		'running',
		'failed',
		'stopped',
		'starting',
		'stopping',
		'reloading',
		'paused',
		'unknown'
	];

	function stateLabel(opt: ServiceState | 'all'): string {
		switch (opt) {
			case 'all':
				return m.services_state_all();
			case 'running':
				return m.services_state_running();
			case 'failed':
				return m.services_state_failed();
			case 'stopped':
				return m.services_state_stopped();
			case 'starting':
				return m.services_state_starting();
			case 'stopping':
				return m.services_state_stopping();
			case 'reloading':
				return m.services_state_reloading();
			case 'paused':
				return m.services_state_paused();
			case 'unknown':
				return m.services_state_unknown();
		}
	}

	function fmtNextRun(ts: number | null): string {
		if (ts === null) return '—';
		const diff = ts - Date.now() / 1000;
		if (diff < 0) return fmtRelative(ts);
		if (diff < 60) return m.services_next_run_in_seconds({ value: Math.round(diff) });
		if (diff < 3600) return m.services_next_run_in_minutes({ value: Math.round(diff / 60) });
		if (diff < 86400) return m.services_next_run_in_hours({ value: Math.round(diff / 3600) });
		return m.services_next_run_in_days({ value: Math.round(diff / 86400) });
	}
</script>

{#snippet serviceActions(s: ServiceDto)}
	{@const running = s.state === 'running' || s.state === 'reloading'}
	{@const busy = acting !== null}
	{#if running}
		<IconButton
			size="sm"
			label={m.services_action_stop()}
			onclick={() => doStop(s)}
			disabled={busy}
			loading={acting === `stop:${s.name}`}
		>
			<IconSquare class="size-[13px]" stroke-width="2" />
		</IconButton>
		<IconButton
			size="sm"
			label={m.services_action_restart()}
			onclick={() => doRestart(s)}
			disabled={busy}
			loading={acting === `restart:${s.name}`}
		>
			<IconRotateCcw class="size-[13px]" stroke-width="2" />
		</IconButton>
		<IconButton
			size="sm"
			label={m.services_action_reload()}
			onclick={() => doReload(s)}
			disabled={busy}
			loading={acting === `reload:${s.name}`}
		>
			<IconRefreshCw class="size-[13px]" stroke-width="2" />
		</IconButton>
	{:else}
		<IconButton
			size="sm"
			label={m.services_action_start()}
			onclick={() => doStart(s)}
			disabled={busy}
			loading={acting === `start:${s.name}`}
		>
			<IconPlay class="size-[13px]" stroke-width="2" />
		</IconButton>
	{/if}
	{#if s.enabled_at_boot === true}
		<IconButton
			size="sm"
			label={m.services_action_disable_at_boot()}
			onclick={() => doDisable(s)}
			disabled={busy}
			loading={acting === `disable:${s.name}`}
		>
			<IconMinus class="size-[13px]" stroke-width="2" />
		</IconButton>
	{:else if s.enabled_at_boot === false}
		<IconButton
			size="sm"
			label={m.services_action_enable_at_boot()}
			onclick={() => doEnable(s)}
			disabled={busy}
			loading={acting === `enable:${s.name}`}
		>
			<IconPlus class="size-[13px]" stroke-width="2" />
		</IconButton>
	{/if}
{/snippet}

{#snippet bootCell(enabled: boolean | null)}
	{#if enabled === null}
		—
	{:else if enabled}
		<span class="text-[var(--color-success)]">{m.services_boot_enabled()}</span>
	{:else}
		<span class="text-[var(--color-fg-subtle)]">{m.services_boot_disabled()}</span>
	{/if}
{/snippet}

{#snippet logsPanel(s: ServiceDto)}
	<div class="mb-3 flex items-baseline justify-between gap-3 text-xs">
		<div class="font-mono text-[var(--color-fg-subtle)]">
			{m.services_raw_state_label()}
			<span class="text-[var(--color-fg-muted)]">{s.raw_state}</span>
		</div>
		<button
			type="button"
			onclick={() => toggleExpand(s.name)}
			class="text-2xs tracking-wide text-[var(--color-fg-subtle)] hover:text-[var(--color-fg)]"
		>
			{m.services_action_collapse()}
		</button>
	</div>
	{#if canStreamLogs && conn}
		<LogStream {conn} path={`/services/${s.name}/logs`} initialTail={100} />
	{:else}
		<p class="text-xs text-[var(--color-fg-muted)]">
			{m.services_logs_journalctl_only_prefix()}
			<span class="font-mono text-[var(--color-fg)]">{s.backend}</span>.
		</p>
	{/if}
{/snippet}

<div class="px-4 py-6 md:px-8 md:py-8">
	<PageHeader
		title={m.section_services()}
		subtitle={m.services_page_subtitle({
			backend: serviceBackend ?? 'systemd / OpenRC / Windows'
		})}
	/>

	<div class="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
		<div class="overflow-x-auto">
			<Tabs tabs={tabsConfig} value={tab} onSelect={tabs.set} />
		</div>
		<div class="flex items-center gap-2">
			{#if tab === 'services'}
				<Select bind:value={stateFilter} class="shrink-0">
					{#each stateOptions as opt (opt)}
						<option value={opt}>{stateLabel(opt)}</option>
					{/each}
				</Select>
			{/if}
			<Input
				placeholder={tab === 'cron'
					? m.services_filter_cron_placeholder()
					: m.services_filter_placeholder()}
				bind:value={q}
				class="w-full sm:w-48"
			/>
			<RefreshButton
				onclick={fetchCurrent}
				loading={servicesLoading || timersLoading || cronLoading}
				label={m.services_action_refresh()}
				class="size-9"
			/>
		</div>
	</div>

	{#if tab === 'services'}
		{@render servicesTab()}
	{:else if tab === 'timers'}
		{@render timersTab()}
	{:else}
		{@render cronTab()}
	{/if}
</div>

{#snippet servicesTab()}
	{#if servicesError}
		<ErrorState error={servicesError} onRetry={fetchServices} />
	{:else if services.length === 0 && !servicesLoading}
		<EmptyState description={m.services_empty_services()} />
	{:else}
		<DataTable
			loading={servicesLoading && services.length === 0}
			empty={filteredServices.length === 0 ? m.services_no_services_match() : undefined}
		>
			{#snippet head()}
				<th>{m.services_table_name()}</th>
				<th>{m.services_table_state()}</th>
				<th>{m.services_table_at_boot()}</th>
				<th class="text-right">{m.services_table_actions()}</th>
			{/snippet}
			{#each filteredServices as s (s.name)}
				<tr class={cn(s.state === 'failed' && 'danger')}>
					<td>
						<button
							type="button"
							onclick={() => toggleExpand(s.name)}
							aria-expanded={expanded === s.name}
							class="flex flex-col text-left"
						>
							<span class="font-mono text-xs font-medium break-all text-[var(--color-fg)]">
								{s.name}
							</span>
							{#if s.description}
								<span class="text-2xs mt-0.5 text-[var(--color-fg-muted)]" title={s.description}>
									{s.description.length > 60 ? s.description.slice(0, 60) + '…' : s.description}
								</span>
							{/if}
						</button>
					</td>
					<td data-label={m.services_table_state()}><ServiceStateBadge state={s.state} /></td>
					<td
						data-label={m.services_table_at_boot()}
						class="text-2xs font-mono text-[var(--color-fg-muted)]"
					>
						{@render bootCell(s.enabled_at_boot)}
					</td>
					<td class="actions">
						<div class="flex items-center gap-1.5 md:justify-end">
							{@render serviceActions(s)}
						</div>
					</td>
				</tr>
				{#if expanded === s.name}
					<tr class="detail">
						<td colspan="4" class="px-4 py-4 md:px-5">{@render logsPanel(s)}</td>
					</tr>
				{/if}
			{/each}
		</DataTable>
	{/if}
{/snippet}

{#snippet timersTab()}
	{#if timersError}
		<ErrorState error={timersError} onRetry={fetchTimers} />
	{:else if timers.length === 0 && !timersLoading}
		<EmptyState description={m.services_empty_timers()} />
	{:else}
		<DataTable
			loading={timersLoading && timers.length === 0}
			empty={filteredTimers.length === 0 ? m.services_no_timers_match() : undefined}
		>
			{#snippet head()}
				<th>{m.services_table_timer()}</th>
				<th>{m.services_table_service()}</th>
				<th>{m.services_table_state()}</th>
				<th>{m.services_table_next()}</th>
				<th>{m.services_table_last()}</th>
				<th class="text-right">{m.services_table_boot()}</th>
			{/snippet}
			{#each filteredTimers as t (t.name)}
				<tr>
					<td>
						<div class="flex flex-col">
							<span class="font-mono text-xs break-all text-[var(--color-fg)]">{t.name}</span>
							{#if t.description}
								<span class="text-2xs mt-0.5 text-[var(--color-fg-muted)]">{t.description}</span>
							{/if}
						</div>
					</td>
					<td
						data-label={m.services_table_service()}
						class="text-2xs font-mono break-all text-[var(--color-fg-muted)]"
					>
						{t.service ?? '—'}
					</td>
					<td data-label={m.services_table_state()}><ServiceStateBadge state={t.state} /></td>
					<td
						data-label={m.services_table_next()}
						class="text-2xs font-mono text-[var(--color-fg-muted)]"
					>
						{fmtNextRun(t.next_run)}
					</td>
					<td
						data-label={m.services_table_last()}
						class="text-2xs font-mono text-[var(--color-fg-muted)]"
					>
						{t.last_run ? fmtRelative(t.last_run) : '—'}
					</td>
					<td data-label={m.services_table_boot()} class="md:text-right">
						<Switch
							checked={t.enabled_at_boot === true}
							onchange={() => toggleTimer(t)}
							label={t.enabled_at_boot === true
								? m.services_action_disable_at_boot()
								: m.services_action_enable_at_boot()}
						/>
					</td>
				</tr>
			{/each}
		</DataTable>
	{/if}
{/snippet}

{#snippet cronTab()}
	{#if cronError}
		<ErrorState error={cronError} onRetry={fetchCron} />
	{:else if cronJobs.length === 0 && !cronLoading}
		<EmptyState description={m.services_empty_cron()} />
	{:else}
		<DataTable
			loading={cronLoading && cronJobs.length === 0}
			empty={filteredCron.length === 0 ? m.services_no_cron_match() : undefined}
		>
			{#snippet head()}
				<th>{m.services_table_schedule()}</th>
				<th>{m.services_table_user()}</th>
				<th>{m.services_table_command()}</th>
				<th>{m.services_table_source()}</th>
			{/snippet}
			{#each filteredCron as j, i (i)}
				<tr>
					<td class="text-2xs font-mono text-[var(--color-fg)]">{j.schedule}</td>
					<td
						data-label={m.services_table_user()}
						class="text-2xs font-mono text-[var(--color-fg-muted)]"
					>
						{j.user ?? '—'}
					</td>
					<!-- md:max-w-0 lets the column absorb the slack instead of sizing to
					     its longest command; on a card the command wraps in full. -->
					<td class="md:w-full md:max-w-0">
						<code
							class="text-2xs block font-mono break-all text-[var(--color-fg)] md:truncate"
							title={j.command}
						>
							{j.command}
						</code>
					</td>
					<td
						data-label={m.services_table_source()}
						class="text-2xs font-mono text-[var(--color-fg-subtle)]"
					>
						{j.source}
					</td>
				</tr>
			{/each}
		</DataTable>
	{/if}
{/snippet}
