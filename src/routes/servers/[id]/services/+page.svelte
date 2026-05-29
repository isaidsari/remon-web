<script lang="ts">
	import { untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import Card from '$lib/components/ui/Card.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Tabs from '$lib/components/layout/Tabs.svelte';
	import Banner from '$lib/components/ui/Banner.svelte';
	import LogStream from '$lib/components/common/LogStream.svelte';
	import ServiceStateBadge from '$lib/components/services/ServiceStateBadge.svelte';
	import { profiles } from '$lib/stores/profiles.svelte';
	import { connections } from '$lib/stores/connections.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { confirm } from '$lib/stores/confirm.svelte';
	import { ApiError } from '$lib/api/error';
	import Skeleton from '$lib/components/ui/Skeleton.svelte';
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

	let id = $derived(page.params.id ?? '');
	let profile = $derived(id ? profiles.byId(id) : undefined);
	let conn = $derived(profile ? connections.connect(profile) : null);

	$effect(() => {
		if (!conn) return;
		untrack(() => {
			conn.ensureSignedIn().catch((e) => {
				if (e instanceof ApiError)
					toast.error(m.services_toast_sign_in_failed(), { description: e.userMessage });
			});
		});
	});

	type TabKey = 'services' | 'timers' | 'cron';
	let tab = $derived<TabKey>(
		(['services', 'timers', 'cron'] as const).includes(
			(page.url.searchParams.get('tab') ?? 'services') as TabKey
		)
			? ((page.url.searchParams.get('tab') ?? 'services') as TabKey)
			: 'services'
	);

	function setTab(t: TabKey) {
		const url = new URL(page.url);
		url.searchParams.set('tab', t);
		goto(url, { replaceState: true, keepFocus: true });
	}

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
		if (!conn?.isAuthenticated) return;
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
		if (!conn?.isAuthenticated) return;
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
		if (!conn?.isAuthenticated) return;
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

	$effect(() => {
		if (!conn?.isAuthenticated) return;
		void stateFilter;
		if (tab === 'services') void fetchServices();
		else if (tab === 'timers') void fetchTimers();
		else if (tab === 'cron') void fetchCron();
	});

	// Pre-fetch inactive tabs once so badge counts show without the user clicking into each.
	let countsPrimed = $state(false);
	$effect(() => {
		if (!conn?.isAuthenticated || countsPrimed) return;
		countsPrimed = true;
		if (tab !== 'timers') void fetchTimers();
		if (tab !== 'cron') void fetchCron();
	});

	let filteredServices = $derived.by(() => {
		const needle = q.trim().toLowerCase();
		const list = needle
			? services.filter(
					(s) =>
						s.name.toLowerCase().includes(needle) ||
						(s.description ?? '').toLowerCase().includes(needle)
				)
			: services;
		return [...list].sort((a, b) => {
			const aPriority = a.state === 'failed' ? 0 : a.state === 'running' ? 1 : 2;
			const bPriority = b.state === 'failed' ? 0 : b.state === 'running' ? 1 : 2;
			if (aPriority !== bPriority) return aPriority - bPriority;
			return a.name.localeCompare(b.name);
		});
	});

	let filteredTimers = $derived.by(() => {
		const needle = q.trim().toLowerCase();
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
			if (e instanceof ApiError)
				toast.error(m.services_toast_action_failed(), { description: e.userMessage });
		} finally {
			acting = null;
		}
	}

	function doStart(s: ServiceDto) {
		void withAction(`start:${s.name}`, m.services_toast_started({ name: s.name }), () =>
			conn!.client.startService(s.name)
		);
	}
	function doStop(s: ServiceDto) {
		void withAction(`stop:${s.name}`, m.services_toast_stopped({ name: s.name }), () =>
			conn!.client.stopService(s.name)
		);
	}
	function doRestart(s: ServiceDto) {
		void withAction(`restart:${s.name}`, m.services_toast_restarted({ name: s.name }), () =>
			conn!.client.restartService(s.name)
		);
	}
	function doReload(s: ServiceDto) {
		void withAction(`reload:${s.name}`, m.services_toast_reloaded({ name: s.name }), () =>
			conn!.client.reloadService(s.name)
		);
	}
	async function doEnable(s: ServiceDto) {
		void withAction(`enable:${s.name}`, m.services_toast_enabled_at_boot({ name: s.name }), () =>
			conn!.client.enableService(s.name)
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
			conn!.client.disableService(s.name)
		);
	}

	async function toggleTimer(t: TimerDto) {
		const desiredEnable = !(t.enabled_at_boot === true);
		const action = desiredEnable
			? () => conn!.client.enableTimer(t.name)
			: () => conn!.client.disableTimer(t.name);
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

{#snippet iconBtn(
	label: string,
	onclick: () => void,
	disabled: boolean,
	busy: boolean,
	path: string,
	danger?: boolean
)}
	<button
		type="button"
		{onclick}
		{disabled}
		title={label}
		aria-label={label}
		class={cn(
			'grid h-7 w-7 shrink-0 place-items-center rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] transition disabled:cursor-not-allowed disabled:opacity-30',
			'hover:border-[var(--color-border-strong)]',
			danger && 'hover:border-[var(--color-danger)]/50 hover:text-[var(--color-danger)]',
			!danger && 'hover:text-[var(--color-fg)]',
			'text-[var(--color-fg-muted)]'
		)}
	>
		{#if busy}
			<span
				class="h-3 w-3 animate-spin rounded-full border-2 border-current border-r-transparent"
				aria-hidden="true"
			></span>
		{:else}
			<svg
				width="13"
				height="13"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="1.9"
				stroke-linecap="round"
				stroke-linejoin="round"
			>
				<path d={path} />
			</svg>
		{/if}
	</button>
{/snippet}

{#if profile}
	<div class="px-4 py-6 md:px-8 md:py-8">
		<header class="mb-6">
			<h1 class="text-[24px] font-semibold tracking-tight">{m.section_services()}</h1>
			<p class="mt-1.5 max-w-md text-[14px] leading-relaxed text-[var(--color-fg-muted)]">
				{m.services_page_subtitle({ backend: serviceBackend ?? 'systemd / OpenRC / Windows' })}
			</p>
		</header>

		{#if !conn?.isAuthenticated}
			<Card padding="lg" class="border-[var(--color-warning)]/30">
				<p class="text-sm text-[var(--color-fg-muted)]">
					{m.services_sign_in_prompt()}
				</p>
			</Card>
		{:else}
			<div class="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
				<div class="overflow-x-auto">
					<Tabs tabs={tabsConfig} value={tab} onSelect={setTab} />
				</div>
				<div class="flex items-center gap-2">
					{#if tab === 'services'}
						<select
							bind:value={stateFilter}
							class="h-9 rounded-[var(--radius-input)] border border-[var(--color-border)] bg-[var(--color-bg-soft)] px-3 text-sm text-[var(--color-fg)] focus:outline-none focus:ring-2 focus:ring-[var(--color-ring)]"
						>
							{#each stateOptions as opt (opt)}
								<option value={opt}>{stateLabel(opt)}</option>
							{/each}
						</select>
					{/if}
					<Input
						placeholder={tab === 'cron'
							? m.services_filter_cron_placeholder()
							: m.services_filter_placeholder()}
						bind:value={q}
						class="w-full text-sm sm:w-48"
					/>
					<button
						type="button"
						onclick={() => {
							if (tab === 'services') fetchServices();
							else if (tab === 'timers') fetchTimers();
							else fetchCron();
						}}
						disabled={servicesLoading || timersLoading || cronLoading}
						class="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius-input)] border border-[var(--color-border)] bg-[var(--color-bg-soft)] text-[var(--color-fg-muted)] transition hover:bg-[var(--color-surface-2)] hover:text-[var(--color-fg)] disabled:opacity-50"
						title={m.services_action_refresh()}
						aria-label={m.services_action_refresh()}
					>
						<svg
							xmlns="http://www.w3.org/2000/svg"
							class="size-[15px]"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
						>
							<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
							<path d="M21 3v5h-5" />
							<path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
							<path d="M8 16H3v5" />
						</svg>
					</button>
				</div>
			</div>

			{#if tab === 'services'}
				{@render servicesTab()}
			{:else if tab === 'timers'}
				{@render timersTab()}
			{:else}
				{@render cronTab()}
			{/if}
		{/if}
	</div>
{/if}

{#snippet servicesTab()}
	{#if servicesError}
		{@render errorBanner(servicesError, fetchServices)}
	{:else if services.length === 0 && !servicesLoading}
		{@render emptyState(m.services_empty_services())}
	{:else}
		<Card padding="none" class="overflow-hidden">
			<div class="max-h-[calc(100vh-22rem)] overflow-auto">
				<table class="w-full text-sm">
					<thead
						class="sticky top-0 z-10 bg-[var(--color-surface-2)] text-xs tracking-wide text-[var(--color-fg-muted)]"
					>
						<tr>
							<th class="px-3 py-2.5 text-left font-medium">{m.services_table_name()}</th>
							<th class="px-3 py-2.5 text-left font-medium">{m.services_table_state()}</th>
							<th class="px-3 py-2.5 text-left font-medium">{m.services_table_at_boot()}</th>
							<th class="px-3 py-2.5 text-right font-medium">{m.services_table_actions()}</th>
						</tr>
					</thead>
					<tbody>
						{#if servicesLoading && services.length === 0}
							{#each { length: 8 } as _, i (i)}
								<tr class="border-t border-[var(--color-border)]">
									<td class="px-3 py-2.5"><Skeleton class="h-3 w-40" /></td>
									<td class="px-3 py-2.5"><Skeleton class="h-5 w-20" rounded="full" /></td>
									<td class="px-3 py-2.5"><Skeleton class="h-3 w-16" /></td>
									<td class="px-3 py-2.5"><Skeleton class="ml-auto h-7 w-20" /></td>
								</tr>
							{/each}
						{:else}
							{#each filteredServices as s (s.name)}
								{@const running = s.state === 'running' || s.state === 'reloading'}
								{@const failed = s.state === 'failed'}
								{@const enabled = s.enabled_at_boot === true}
								<tr
									class={cn(
										'border-t border-[var(--color-border)] transition hover:bg-[var(--color-surface-2)]/40',
										failed && 'bg-[var(--color-danger)]/5'
									)}
								>
									<td class="px-3 py-2.5">
										<button
											type="button"
											onclick={() => toggleExpand(s.name)}
											class="flex flex-col text-left"
										>
											<span class="font-mono text-[12px] font-medium text-[var(--color-fg)]"
												>{s.name}</span
											>
											{#if s.description}
												<span
													class="mt-0.5 text-[11px] text-[var(--color-fg-muted)]"
													title={s.description}
												>
													{s.description.length > 60
														? s.description.slice(0, 60) + '…'
														: s.description}
												</span>
											{/if}
										</button>
									</td>
									<td class="px-3 py-2.5">
										<ServiceStateBadge state={s.state} />
									</td>
									<td class="px-3 py-2.5 font-mono text-[11px] text-[var(--color-fg-muted)]">
										{#if s.enabled_at_boot === null}
											—
										{:else if enabled}
											<span class="text-[var(--color-success)]">{m.services_boot_enabled()}</span>
										{:else}
											<span class="text-[var(--color-fg-subtle)]">{m.services_boot_disabled()}</span
											>
										{/if}
									</td>
									<td class="px-3 py-2.5">
										<div class="flex items-center justify-end gap-1.5">
											{#if running}
												{@render iconBtn(
													m.services_action_stop(),
													() => doStop(s),
													acting !== null,
													acting === `stop:${s.name}`,
													'M6 6h12v12H6z'
												)}
												{@render iconBtn(
													m.services_action_restart(),
													() => doRestart(s),
													acting !== null,
													acting === `restart:${s.name}`,
													'M3 12a9 9 0 0 1 15-6.7M21 12a9 9 0 0 1-15 6.7M21 3v6h-6M3 21v-6h6'
												)}
												{@render iconBtn(
													m.services_action_reload(),
													() => doReload(s),
													acting !== null,
													acting === `reload:${s.name}`,
													'M21 2v6h-6M3 12a9 9 0 0 1 15-6.7L21 8'
												)}
											{:else}
												{@render iconBtn(
													m.services_action_start(),
													() => doStart(s),
													acting !== null,
													acting === `start:${s.name}`,
													'M7 4v16l13-8L7 4z'
												)}
											{/if}
											{#if s.enabled_at_boot !== null}
												{#if enabled}
													{@render iconBtn(
														m.services_action_disable_at_boot(),
														() => doDisable(s),
														acting !== null,
														acting === `disable:${s.name}`,
														'M5 12h14'
													)}
												{:else}
													{@render iconBtn(
														m.services_action_enable_at_boot(),
														() => doEnable(s),
														acting !== null,
														acting === `enable:${s.name}`,
														'M12 5v14M5 12h14'
													)}
												{/if}
											{/if}
										</div>
									</td>
								</tr>
								{#if expanded === s.name}
									<tr class="border-t border-[var(--color-border)] bg-[var(--color-bg-soft)]/40">
										<td colspan="4" class="px-5 py-4">
											<div class="mb-3 flex items-baseline justify-between gap-3 text-xs">
												<div class="font-mono text-[var(--color-fg-subtle)]">
													{m.services_raw_state_label()}
													<span class="text-[var(--color-fg-muted)]">{s.raw_state}</span>
												</div>
												<button
													type="button"
													onclick={() => toggleExpand(s.name)}
													class="text-[11px] tracking-wide text-[var(--color-fg-subtle)] hover:text-[var(--color-fg)]"
												>
													{m.services_action_collapse()}
												</button>
											</div>
											{#if canStreamLogs && conn}
												<LogStream {conn} path={`/services/${s.name}/logs`} initialTail={100} />
											{:else}
												<p class="text-[12px] text-[var(--color-fg-muted)]">
													{m.services_logs_journalctl_only_prefix()}
													<span class="font-mono text-[var(--color-fg)]">{s.backend}</span>.
												</p>
											{/if}
										</td>
									</tr>
								{/if}
							{/each}
							{#if filteredServices.length === 0}
								<tr>
									<td
										colspan="4"
										class="px-3 py-8 text-center text-sm text-[var(--color-fg-subtle)]"
									>
										{m.services_no_services_match()}
									</td>
								</tr>
							{/if}
						{/if}
					</tbody>
				</table>
			</div>
		</Card>
	{/if}
{/snippet}

{#snippet timersTab()}
	{#if timersError}
		{@render errorBanner(timersError, fetchTimers)}
	{:else if timers.length === 0 && !timersLoading}
		{@render emptyState(m.services_empty_timers())}
	{:else}
		<Card padding="none" class="overflow-hidden">
			<div class="max-h-[calc(100vh-22rem)] overflow-auto">
				<table class="w-full text-sm">
					<thead
						class="sticky top-0 z-10 bg-[var(--color-surface-2)] text-xs tracking-wide text-[var(--color-fg-muted)]"
					>
						<tr>
							<th class="px-3 py-2.5 text-left font-medium">{m.services_table_timer()}</th>
							<th class="px-3 py-2.5 text-left font-medium">{m.services_table_service()}</th>
							<th class="px-3 py-2.5 text-left font-medium">{m.services_table_state()}</th>
							<th class="px-3 py-2.5 text-left font-medium">{m.services_table_next()}</th>
							<th class="px-3 py-2.5 text-left font-medium">{m.services_table_last()}</th>
							<th class="px-3 py-2.5 text-right font-medium">{m.services_table_boot()}</th>
						</tr>
					</thead>
					<tbody>
						{#if timersLoading && timers.length === 0}
							{#each { length: 6 } as _, i (i)}
								<tr class="border-t border-[var(--color-border)]">
									<td class="px-3 py-2.5"><Skeleton class="h-3 w-36" /></td>
									<td class="px-3 py-2.5"><Skeleton class="h-3 w-28" /></td>
									<td class="px-3 py-2.5"><Skeleton class="h-5 w-16" rounded="full" /></td>
									<td class="px-3 py-2.5"><Skeleton class="h-3 w-24" /></td>
									<td class="px-3 py-2.5"><Skeleton class="h-3 w-20" /></td>
									<td class="px-3 py-2.5"><Skeleton class="ml-auto h-5 w-16" rounded="full" /></td>
								</tr>
							{/each}
						{:else}
							{#each filteredTimers as t (t.name)}
								{@const enabled = t.enabled_at_boot === true}
								<tr
									class="border-t border-[var(--color-border)] transition hover:bg-[var(--color-surface-2)]/40"
								>
									<td class="px-3 py-2.5">
										<div class="flex flex-col">
											<span class="font-mono text-[12px] text-[var(--color-fg)]">{t.name}</span>
											{#if t.description}
												<span class="mt-0.5 text-[11px] text-[var(--color-fg-muted)]"
													>{t.description}</span
												>
											{/if}
										</div>
									</td>
									<td class="px-3 py-2.5 font-mono text-[11px] text-[var(--color-fg-muted)]">
										{t.service ?? '—'}
									</td>
									<td class="px-3 py-2.5">
										<ServiceStateBadge state={t.state} />
									</td>
									<td class="px-3 py-2.5 font-mono text-[11px] text-[var(--color-fg-muted)]">
										{fmtNextRun(t.next_run)}
									</td>
									<td class="px-3 py-2.5 font-mono text-[11px] text-[var(--color-fg-muted)]">
										{t.last_run ? fmtRelative(t.last_run) : '—'}
									</td>
									<td class="px-3 py-2.5">
										<div class="flex items-center justify-end">
											<button
												type="button"
												onclick={() => toggleTimer(t)}
												class={cn(
													'rounded-full border px-2.5 py-0.5 font-mono text-[10px] tracking-wide transition',
													enabled
														? 'border-[var(--color-success)]/40 bg-[var(--color-success)]/15 text-[var(--color-success)] hover:bg-[var(--color-success)]/25'
														: 'border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-fg-subtle)] hover:border-[var(--color-border-strong)]'
												)}
											>
												{enabled ? m.services_boot_enabled() : m.services_boot_disabled()}
											</button>
										</div>
									</td>
								</tr>
							{/each}
							{#if filteredTimers.length === 0}
								<tr>
									<td
										colspan="6"
										class="px-3 py-8 text-center text-sm text-[var(--color-fg-subtle)]"
									>
										{m.services_no_timers_match()}
									</td>
								</tr>
							{/if}
						{/if}
					</tbody>
				</table>
			</div>
		</Card>
	{/if}
{/snippet}

{#snippet cronTab()}
	{#if cronError}
		{@render errorBanner(cronError, fetchCron)}
	{:else if cronJobs.length === 0 && !cronLoading}
		{@render emptyState(m.services_empty_cron())}
	{:else}
		{@const filtered = q.trim()
			? cronJobs.filter(
					(j) =>
						j.command.toLowerCase().includes(q.toLowerCase()) ||
						j.schedule.toLowerCase().includes(q.toLowerCase()) ||
						(j.user ?? '').toLowerCase().includes(q.toLowerCase())
				)
			: cronJobs}
		<Card padding="none" class="overflow-hidden">
			<div class="max-h-[calc(100vh-22rem)] overflow-auto">
				<table class="w-full text-sm">
					<thead
						class="sticky top-0 z-10 bg-[var(--color-surface-2)] text-xs tracking-wide text-[var(--color-fg-muted)]"
					>
						<tr>
							<th class="px-3 py-2.5 text-left font-medium">{m.services_table_schedule()}</th>
							<th class="px-3 py-2.5 text-left font-medium">{m.services_table_user()}</th>
							<th class="px-3 py-2.5 text-left font-medium">{m.services_table_command()}</th>
							<th class="px-3 py-2.5 text-left font-medium">{m.services_table_source()}</th>
						</tr>
					</thead>
					<tbody>
						{#if cronLoading && cronJobs.length === 0}
							{#each { length: 6 } as _, i (i)}
								<tr class="border-t border-[var(--color-border)]">
									<td class="px-3 py-2.5"><Skeleton class="h-3 w-24" /></td>
									<td class="px-3 py-2.5"><Skeleton class="h-3 w-16" /></td>
									<td class="px-3 py-2.5"><Skeleton class="h-3 w-52" /></td>
									<td class="px-3 py-2.5"><Skeleton class="h-3 w-20" /></td>
								</tr>
							{/each}
						{:else}
							{#each filtered as j, i (i)}
								<tr
									class="border-t border-[var(--color-border)] transition hover:bg-[var(--color-surface-2)]/40"
								>
									<td class="px-3 py-2.5 font-mono text-[11px] text-[var(--color-fg)]"
										>{j.schedule}</td
									>
									<td class="px-3 py-2.5 font-mono text-[11px] text-[var(--color-fg-muted)]">
										{j.user ?? '—'}
									</td>
									<td class="px-3 py-2.5">
										<span
											class="block truncate font-mono text-[11px] text-[var(--color-fg)]"
											title={j.command}
										>
											{j.command}
										</span>
									</td>
									<td class="px-3 py-2.5 font-mono text-[11px] text-[var(--color-fg-subtle)]">
										{j.source}
									</td>
								</tr>
							{/each}
							{#if filtered.length === 0}
								<tr>
									<td
										colspan="4"
										class="px-3 py-8 text-center text-sm text-[var(--color-fg-subtle)]"
									>
										{m.services_no_cron_match()}
									</td>
								</tr>
							{/if}
						{/if}
					</tbody>
				</table>
			</div>
		</Card>
	{/if}
{/snippet}

{#snippet errorBanner(err: ApiError, retry: () => void)}
	{#if err.isNotSupported}
		<Card padding="lg" class="border-[var(--color-info)]/30">
			<p class="font-medium text-[var(--color-fg)]">{m.services_error_not_supported_title()}</p>
			<p class="mt-1 text-sm text-[var(--color-fg-muted)]">{err.userMessage}</p>
		</Card>
	{:else if err.isForbidden}
		<Banner variant="warning" title={m.services_error_forbidden_title()}>
			{err.userMessage}
			{m.services_error_forbidden_hint()}
		</Banner>
	{:else}
		<Banner variant="danger" title={m.services_error_failed_to_fetch()}>
			{err.userMessage}
			{#snippet actions()}
				<Button variant="secondary" size="sm" onclick={retry}>{m.common_retry()}</Button>
			{/snippet}
		</Banner>
	{/if}
{/snippet}

{#snippet emptyState(message: string)}
	<Card padding="lg">
		<p class="text-sm text-[var(--color-fg-subtle)]">{message}</p>
	</Card>
{/snippet}
