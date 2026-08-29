<script lang="ts">
	import { untrack } from 'svelte';
	import { page } from '$app/state';
	import Card from '$lib/components/ui/Card.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Field from '$lib/components/ui/Field.svelte';
	import Banner from '$lib/components/ui/Banner.svelte';
	import Modal from '$lib/components/ui/Modal.svelte';
	import AutoRefreshSelect from '$lib/components/ui/AutoRefreshSelect.svelte';
	import RefreshButton from '$lib/components/ui/RefreshButton.svelte';
	import ActionRunStatusBadge from '$lib/components/actions/ActionRunStatusBadge.svelte';
	import ActionModeBadge from '$lib/components/actions/ActionModeBadge.svelte';
	import { profiles } from '$lib/stores/profiles.svelte';
	import { connections } from '$lib/stores/connections.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { confirm } from '$lib/stores/confirm.svelte';
	import { ApiError } from '$lib/api/error';
	import { fmtDuration, fmtRelative } from '$lib/utils/format';
	import { cn } from '$lib/utils/cn';
	import { m } from '$lib/paraglide/messages';
	import IconPlus from '~icons/lucide/plus';
	import IconPlay from '~icons/lucide/play';
	import IconTrash from '~icons/lucide/trash-2';
	import IconPencil from '~icons/lucide/pencil';
	import IconRotateCw from '~icons/lucide/rotate-cw';
	import type {
		ActionBindingDto,
		ActionCatalogResponse,
		ActionKind,
		ActionMode,
		ActionOnEvent,
		ActionRunDto,
		ActionVerb,
		AlertRuleDto,
		CreateActionBindingRequest
	} from '$lib/types/api';

	let id = $derived(page.params.id ?? '');
	let profile = $derived(id ? profiles.byId(id) : undefined);
	let conn = $derived(profile ? connections.connect(profile) : null);

	$effect(() => {
		if (!conn) return;
		untrack(() => {
			conn.ensureSignedIn().catch((e) => {
				if (e instanceof ApiError)
					toast.error(m.actions_toast_signin_failed(), { description: e.userMessage });
			});
		});
	});

	const RUNS_PAGE = 100;

	let catalog = $state<ActionCatalogResponse | null>(null);
	let bindings = $state<ActionBindingDto[]>([]);
	let runs = $state<ActionRunDto[]>([]);
	let rules = $state<AlertRuleDto[]>([]);
	let loading = $state(false);
	let error = $state<ApiError | null>(null);
	/** Daemon predates the action engine — a missing route, not a failure. */
	let unsupported = $state(false);
	let lastFetched = $state<number | null>(null);
	let autoRefresh = $state(false);

	// Coarse clock for the proposal countdowns; TTLs are minutes-granular.
	let now = $state(Math.floor(Date.now() / 1000));
	$effect(() => {
		const t = setInterval(() => (now = Math.floor(Date.now() / 1000)), 15_000);
		return () => clearInterval(t);
	});

	let ruleName = $derived.by(() => {
		const byId = new Map<number, string>();
		for (const r of rules) byId.set(r.id, r.name);
		return byId;
	});

	let pending = $derived(runs.filter((r) => r.status === 'pending'));
	let history = $derived(runs.filter((r) => r.status !== 'pending'));
	// Only the script names — the catalogue's service/container rows carry a
	// null target because their target is chosen per binding.
	let scripts = $derived(
		(catalog?.entries ?? [])
			.filter((e) => e.kind === 'script')
			.map((e) => e.target)
			.filter((t): t is string => t !== null)
	);

	async function fetchAll(bust = false) {
		if (!conn?.isAuthenticated) return;
		loading = true;
		error = null;
		try {
			const client = conn.client;
			const opts = bust ? { bypassCache: true } : {};
			const [cat, binds, runList, ruleList] = await Promise.all([
				client.request<ActionCatalogResponse>('/actions', opts),
				client.request<{ bindings: ActionBindingDto[] }>('/actions/bindings', opts),
				client.request<{ runs: ActionRunDto[] }>('/actions/runs', {
					...opts,
					query: { limit: RUNS_PAGE }
				}),
				client.request<{ rules: AlertRuleDto[] }>('/alerts', opts)
			]);
			catalog = cat;
			bindings = binds.bindings;
			runs = runList.runs;
			rules = ruleList.rules;
			unsupported = false;
			lastFetched = Date.now();
			now = Math.floor(Date.now() / 1000);
		} catch (e) {
			// A 404 on `/actions` means an older daemon, which is worth saying
			// plainly rather than rendering as a broken page.
			if (e instanceof ApiError && e.status === 404) unsupported = true;
			else if (e instanceof ApiError) error = e;
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		if (conn?.isAuthenticated) fetchAll();
	});

	$effect(() => {
		if (!autoRefresh || !conn?.isAuthenticated) return;
		const t = setInterval(() => fetchAll(true), 10_000);
		return () => clearInterval(t);
	});

	// ===== proposals =====

	let busyRun = $state<number | null>(null);

	async function confirmRun(run: ActionRunDto) {
		const ok = await confirm({
			title: m.actions_confirm_title(),
			description: m.actions_confirm_desc({ summary: describeRun(run), rule: run.rule_name }),
			confirmLabel: m.actions_confirm_run(),
			variant: 'warning'
		});
		if (!ok || !conn?.isAuthenticated) return;
		busyRun = run.id;
		try {
			const done = await conn.client.confirmActionRun(run.id);
			if (done.status === 'succeeded') toast.success(m.actions_toast_ran({ s: describeRun(run) }));
			else
				toast.error(m.actions_toast_run_failed({ s: describeRun(run) }), {
					description: done.message ?? undefined
				});
			await fetchAll(true);
		} catch (e) {
			if (e instanceof ApiError)
				toast.error(m.actions_toast_confirm_failed(), { description: e.userMessage });
		} finally {
			busyRun = null;
		}
	}

	async function dismissRun(run: ActionRunDto) {
		if (!conn?.isAuthenticated) return;
		busyRun = run.id;
		try {
			await conn.client.dismissActionRun(run.id);
			toast.success(m.actions_toast_dismissed());
			await fetchAll(true);
		} catch (e) {
			if (e instanceof ApiError)
				toast.error(m.actions_toast_dismiss_failed(), { description: e.userMessage });
		} finally {
			busyRun = null;
		}
	}

	function describeRun(run: ActionRunDto): string {
		return run.verb ? `${run.verb} ${run.kind} ${run.target}` : `run ${run.kind} ${run.target}`;
	}

	function labelSetText(labelSet: string): string {
		const s = labelSet.trim();
		return s === '' || s === '{}' ? '' : s;
	}

	// ===== bindings =====

	let busyBinding = $state<number | null>(null);

	async function runNow(b: ActionBindingDto) {
		const ok = await confirm({
			title: m.actions_run_now_title(),
			description: m.actions_run_now_desc({ summary: b.summary }),
			confirmLabel: m.actions_run_now(),
			variant: 'warning'
		});
		if (!ok || !conn?.isAuthenticated) return;
		busyBinding = b.id;
		try {
			const run = await conn.client.runActionBinding(b.id);
			if (run.status === 'succeeded') toast.success(m.actions_toast_ran({ s: b.summary }));
			else
				toast.error(m.actions_toast_run_failed({ s: b.summary }), {
					description: run.message ?? undefined
				});
			await fetchAll(true);
		} catch (e) {
			if (e instanceof ApiError)
				toast.error(m.actions_toast_run_failed({ s: b.summary }), { description: e.userMessage });
		} finally {
			busyBinding = null;
		}
	}

	/** Toggling `enabled` is a full replace, so send the whole binding back. */
	async function setEnabled(b: ActionBindingDto, enabled: boolean) {
		if (!conn?.isAuthenticated) return;
		busyBinding = b.id;
		try {
			await conn.client.updateActionBinding(b.id, { ...toRequest(b), enabled });
			await fetchAll(true);
		} catch (e) {
			if (e instanceof ApiError)
				toast.error(m.actions_toast_save_failed(), { description: e.userMessage });
		} finally {
			busyBinding = null;
		}
	}

	async function removeBinding(b: ActionBindingDto) {
		const ok = await confirm({
			title: m.actions_delete_title(),
			description: m.actions_delete_desc({ summary: b.summary }),
			confirmLabel: m.actions_delete(),
			variant: 'danger'
		});
		if (!ok || !conn?.isAuthenticated) return;
		try {
			await conn.client.deleteActionBinding(b.id);
			toast.success(m.actions_toast_deleted());
			await fetchAll(true);
		} catch (e) {
			if (e instanceof ApiError)
				toast.error(m.actions_toast_delete_failed(), { description: e.userMessage });
		}
	}

	async function reloadScripts() {
		if (!conn?.isAuthenticated) return;
		try {
			const res = await conn.client.reloadActions();
			if (res.failed.length > 0)
				toast.warning(
					m.actions_toast_reloaded({ n: res.loaded.length, failed: res.failed.length }),
					{ description: res.failed.map((f) => `${f.path}: ${f.error}`).join('\n') }
				);
			else toast.success(m.actions_toast_reloaded_ok({ n: res.loaded.length }));
			await fetchAll(true);
		} catch (e) {
			if (e instanceof ApiError)
				toast.error(m.actions_toast_reload_failed(), { description: e.userMessage });
		}
	}

	function toRequest(b: ActionBindingDto): CreateActionBindingRequest {
		return {
			kind: b.kind,
			target: b.target,
			verb: b.verb,
			on_event: b.on_event,
			mode: b.mode,
			enabled: b.enabled,
			cooldown_secs: b.cooldown_secs,
			max_runs_per_hour: b.max_runs_per_hour,
			failure_limit: b.failure_limit
		};
	}

	// ===== editor =====

	let editorOpen = $state(false);
	let editing = $state<ActionBindingDto | null>(null);
	let fRule = $state('');
	let fKind = $state<ActionKind>('script');
	let fTarget = $state('');
	let fVerb = $state<ActionVerb>('restart');
	let fOnEvent = $state<ActionOnEvent>('fired');
	let fMode = $state<ActionMode>('manual');
	let fEnabled = $state(true);
	let fCooldown = $state('300');
	let fMaxRuns = $state('3');
	let fFailureLimit = $state('3');
	let saving = $state(false);

	function openCreate() {
		editing = null;
		fRule = rules[0] ? String(rules[0].id) : '';
		fKind = scripts.length > 0 ? 'script' : 'service';
		fTarget = fKind === 'script' ? (scripts[0] ?? '') : '';
		fVerb = 'restart';
		fOnEvent = 'fired';
		// The safe default, and the same one the daemon applies.
		fMode = 'manual';
		fEnabled = true;
		fCooldown = '300';
		fMaxRuns = '3';
		fFailureLimit = '3';
		editorOpen = true;
	}

	function openEdit(b: ActionBindingDto) {
		editing = b;
		fRule = String(b.rule_id);
		fKind = b.kind;
		fTarget = b.target;
		fVerb = b.verb ?? 'restart';
		fOnEvent = b.on_event;
		fMode = b.mode;
		fEnabled = b.enabled;
		fCooldown = String(b.cooldown_secs);
		fMaxRuns = String(b.max_runs_per_hour);
		fFailureLimit = String(b.failure_limit);
		editorOpen = true;
	}

	// Switching kind invalidates the target: a script name is not a unit name.
	function onKindChange(next: ActionKind) {
		if (next === fKind) return;
		fKind = next;
		fTarget = next === 'script' ? (scripts[0] ?? '') : '';
		if (next === 'container' && fVerb === 'reload') fVerb = 'restart';
	}

	let verbOptions = $derived<ActionVerb[]>(
		fKind === 'container' ? ['start', 'stop', 'restart'] : ['start', 'stop', 'restart', 'reload']
	);

	function parsedInt(v: string): number | null {
		const n = Number(v.trim());
		return Number.isInteger(n) ? n : null;
	}
	let cooldownSecs = $derived(parsedInt(fCooldown));
	let maxRuns = $derived(parsedInt(fMaxRuns));
	let failureLimit = $derived(parsedInt(fFailureLimit));
	let editorValid = $derived(
		fRule !== '' &&
			fTarget.trim().length > 0 &&
			cooldownSecs !== null &&
			cooldownSecs >= 0 &&
			maxRuns !== null &&
			maxRuns >= 1 &&
			failureLimit !== null &&
			failureLimit >= 1
	);

	async function saveEditor() {
		if (!conn?.isAuthenticated || !editorValid) return;
		saving = true;
		const req: CreateActionBindingRequest = {
			kind: fKind,
			target: fTarget.trim(),
			verb: fKind === 'script' ? null : fVerb,
			on_event: fOnEvent,
			mode: fMode,
			enabled: fEnabled,
			cooldown_secs: cooldownSecs!,
			max_runs_per_hour: maxRuns!,
			failure_limit: failureLimit!
		};
		try {
			if (editing) await conn.client.updateActionBinding(editing.id, req);
			else await conn.client.createActionBinding(Number(fRule), req);
			toast.success(editing ? m.actions_toast_saved() : m.actions_toast_created());
			editorOpen = false;
			await fetchAll(true);
		} catch (e) {
			if (e instanceof ApiError)
				toast.error(m.actions_toast_save_failed(), { description: e.userMessage });
		} finally {
			saving = false;
		}
	}

	const inputCls =
		'h-9 w-full rounded-[var(--radius-input)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-[13px] text-[var(--color-fg)] focus:border-[var(--color-accent)] focus:outline-none';
</script>

{#if profile}
	<div class="px-4 py-6 md:px-8 md:py-8">
		<header class="mb-4 flex flex-col gap-3 sm:mb-6 sm:flex-row sm:items-end sm:justify-between">
			<div>
				<h1
					class="flex items-baseline gap-2.5 text-[22px] font-semibold tracking-tight sm:text-[24px]"
				>
					{m.section_actions()}
					<span
						class="rounded-md bg-[var(--color-surface-2)] px-2 py-0.5 font-mono text-[12px] font-medium text-[var(--color-fg-muted)] shadow-[inset_0_0_0_1px_var(--color-border)]"
					>
						{bindings.length}
					</span>
				</h1>
				<p class="mt-1.5 max-w-lg text-[13px] text-[var(--color-fg-muted)]">
					{m.actions_page_description()}
					{#if lastFetched}
						<span class="ml-2 text-[12px] text-[var(--color-fg-subtle)]">
							{m.actions_updated_at({ time: new Date(lastFetched).toLocaleTimeString() })}
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
				<RefreshButton onclick={() => fetchAll(true)} {loading} label={m.actions_refresh()} />
				<Button variant="secondary" size="sm" onclick={reloadScripts} disabled={unsupported}>
					<IconRotateCw class="size-[14px]" stroke-width="2.25" />
					{m.actions_reload_scripts()}
				</Button>
				<Button
					variant="primary"
					size="sm"
					onclick={openCreate}
					disabled={unsupported || rules.length === 0}
				>
					<IconPlus class="size-[14px]" stroke-width="2.25" />
					{m.actions_new_binding()}
				</Button>
			</div>
		</header>

		{#if !conn?.isAuthenticated}
			<Card padding="lg" class="border-[var(--color-warning)]/30">
				<p class="text-sm text-[var(--color-fg-muted)]">{m.actions_signin_required()}</p>
			</Card>
		{:else if unsupported}
			<Banner variant="info" title={m.actions_unsupported_title()}>
				{m.actions_unsupported_body()}
			</Banner>
		{:else if error}
			<Banner variant="danger" title={m.actions_fetch_failed_title()}>
				{error.userMessage}
				{#snippet actions()}
					<Button variant="secondary" size="sm" onclick={() => fetchAll(true)}>
						{m.actions_retry()}
					</Button>
				{/snippet}
			</Banner>
		{:else}
			{#if catalog && !catalog.enabled}
				<Banner variant="warning" title={m.actions_engine_off_title()} class="mb-4">
					{m.actions_engine_off_body()}
				</Banner>
			{/if}

			<!-- Proposals first: they are the only thing on this page waiting on
			     a person, and they expire. -->
			{#if pending.length > 0}
				<section class="mb-6">
					<h2 class="mb-2 text-[13px] font-semibold tracking-tight">
						{m.actions_pending_heading({ n: pending.length })}
					</h2>
					<div class="flex flex-col gap-2">
						{#each pending as run (run.id)}
							<Card
								padding="sm"
								class="shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--color-warning)_35%,transparent)]"
							>
								<div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
									<div class="min-w-0">
										<div class="flex flex-wrap items-center gap-2">
											<ActionRunStatusBadge status={run.status} />
											<span class="font-mono text-[13px] font-medium">{describeRun(run)}</span>
										</div>
										<p class="mt-1 text-[12px] text-[var(--color-fg-muted)]">
											{m.actions_pending_because({ rule: run.rule_name })}
											{#if labelSetText(run.label_set)}
												<span class="font-mono text-[var(--color-fg-subtle)]">
													{labelSetText(run.label_set)}
												</span>
											{/if}
										</p>
										{#if run.expires_at}
											<p class="mt-0.5 text-[11px] text-[var(--color-fg-subtle)]">
												{run.expires_at > now
													? m.actions_expires_in({ d: fmtDuration(run.expires_at - now) })
													: m.actions_expired_hint()}
											</p>
										{/if}
									</div>
									<div class="flex shrink-0 gap-2">
										<Button
											variant="secondary"
											size="sm"
											onclick={() => dismissRun(run)}
											disabled={busyRun === run.id}
										>
											{m.actions_dismiss()}
										</Button>
										<Button
											variant="primary"
											size="sm"
											onclick={() => confirmRun(run)}
											loading={busyRun === run.id}
										>
											{m.actions_confirm_run()}
										</Button>
									</div>
								</div>
							</Card>
						{/each}
					</div>
				</section>
			{/if}

			<section class="mb-6">
				<h2 class="mb-2 text-[13px] font-semibold tracking-tight">
					{m.actions_bindings_heading()}
				</h2>
				{#if bindings.length === 0}
					<Card padding="lg">
						<p class="text-sm text-[var(--color-fg-subtle)]">
							{rules.length === 0 ? m.actions_empty_no_rules() : m.actions_empty()}
						</p>
					</Card>
				{:else}
					<Card padding="none" class="overflow-hidden">
						<div class="overflow-auto">
							<table class="w-full text-sm">
								<thead
									class="bg-[var(--color-surface-2)] text-[11px] font-medium tracking-[0.06em] text-[var(--color-fg-muted)]"
								>
									<tr>
										<th class="px-3 py-2.5 text-left font-medium">{m.actions_table_action()}</th>
										<th class="px-3 py-2.5 text-left font-medium">{m.actions_table_rule()}</th>
										<th class="hidden px-3 py-2.5 text-left font-medium sm:table-cell">
											{m.actions_table_mode()}
										</th>
										<th class="hidden px-3 py-2.5 text-left font-medium md:table-cell">
											{m.actions_table_guardrails()}
										</th>
										<th class="w-px px-3 py-2.5" aria-hidden="true"></th>
									</tr>
								</thead>
								<tbody>
									{#each bindings as b (b.id)}
										<tr
											class={cn(
												'border-t border-[var(--color-border)]',
												!b.enabled && 'opacity-60',
												b.disabled_reason && 'bg-[var(--color-danger-bg)]/40'
											)}
										>
											<td class="px-3 py-2.5">
												<div class="flex flex-col gap-1">
													<span class="font-mono text-[12px] font-medium">{b.summary}</span>
													<span class="text-[11px] text-[var(--color-fg-subtle)]">
														{b.on_event === 'both'
															? m.actions_on_both()
															: b.on_event === 'resolved'
																? m.actions_on_resolved()
																: m.actions_on_fired()}
													</span>
													<!-- Mode and guardrails have their own columns, but both hide
													     on narrow screens and nothing else restates them. -->
													<div class="flex flex-wrap items-center gap-1.5 sm:hidden">
														<ActionModeBadge mode={b.mode} autoAllowed={catalog?.auto ?? true} />
														<span class="font-mono text-[10px] text-[var(--color-fg-subtle)]">
															{fmtDuration(b.cooldown_secs)} · {b.max_runs_per_hour}/h
														</span>
													</div>
													{#if b.disabled_reason}
														<span class="text-[11px] text-[var(--color-danger)]">
															{m.actions_disarmed({ reason: b.disabled_reason })}
														</span>
													{/if}
												</div>
											</td>
											<td class="px-3 py-2.5 text-[12px] text-[var(--color-fg-muted)]">
												{ruleName.get(b.rule_id) ?? `#${b.rule_id}`}
											</td>
											<td class="hidden px-3 py-2.5 sm:table-cell">
												<ActionModeBadge mode={b.mode} autoAllowed={catalog?.auto ?? true} />
											</td>
											<td
												class="hidden px-3 py-2.5 font-mono text-[11px] text-[var(--color-fg-muted)] md:table-cell"
											>
												{m.actions_guardrails_summary({
													cooldown: fmtDuration(b.cooldown_secs),
													rate: b.max_runs_per_hour,
													failures: b.failure_limit
												})}
											</td>
											<td class="px-3 py-2.5">
												<div class="flex items-center justify-end gap-1">
													<label class="mr-1 flex cursor-pointer items-center gap-1.5 text-[11px]">
														<input
															type="checkbox"
															checked={b.enabled}
															disabled={busyBinding === b.id}
															onchange={(e) => setEnabled(b, e.currentTarget.checked)}
															class="accent-[var(--color-accent)]"
														/>
														<span class="text-[var(--color-fg-subtle)]">
															{m.actions_enabled_toggle()}
														</span>
													</label>
													<Button
														variant="ghost"
														size="icon"
														onclick={() => runNow(b)}
														disabled={busyBinding === b.id}
														aria-label={m.actions_run_now()}
														title={m.actions_run_now()}
													>
														<IconPlay class="size-[14px]" />
													</Button>
													<Button
														variant="ghost"
														size="icon"
														onclick={() => openEdit(b)}
														aria-label={m.actions_edit()}
														title={m.actions_edit()}
													>
														<IconPencil class="size-[14px]" />
													</Button>
													<Button
														variant="ghost"
														size="icon"
														onclick={() => removeBinding(b)}
														aria-label={m.actions_delete()}
														title={m.actions_delete()}
													>
														<IconTrash class="size-[14px]" />
													</Button>
												</div>
											</td>
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
					</Card>
				{/if}
			</section>

			<section>
				<h2 class="mb-2 text-[13px] font-semibold tracking-tight">{m.actions_runs_heading()}</h2>
				{#if history.length === 0}
					<Card padding="lg">
						<p class="text-sm text-[var(--color-fg-subtle)]">{m.actions_runs_empty()}</p>
					</Card>
				{:else}
					<Card padding="none" class="overflow-hidden">
						<div class="max-h-[max(18rem,calc(100dvh-24rem))] overflow-auto">
							<table class="w-full text-sm">
								<thead
									class="sticky top-0 z-10 bg-[var(--color-surface-2)] text-[11px] font-medium tracking-[0.06em] text-[var(--color-fg-muted)]"
								>
									<tr>
										<th class="px-3 py-2.5 text-left font-medium">{m.actions_table_status()}</th>
										<th class="px-3 py-2.5 text-left font-medium">{m.actions_table_action()}</th>
										<th class="hidden px-3 py-2.5 text-left font-medium sm:table-cell">
											{m.actions_table_rule()}
										</th>
										<th class="px-3 py-2.5 text-left font-medium">{m.actions_table_when()}</th>
									</tr>
								</thead>
								<tbody>
									{#each history as run (run.id)}
										<tr class="border-t border-[var(--color-border)] align-top">
											<td class="px-3 py-2.5"><ActionRunStatusBadge status={run.status} /></td>
											<td class="px-3 py-2.5">
												<div class="flex flex-col gap-0.5">
													<span class="font-mono text-[12px]">{describeRun(run)}</span>
													{#if run.message}
														<!-- On a `skipped` row this is the guardrail that stopped
														     it, which is the whole reason the row exists. -->
														<span class="max-w-[60ch] text-[11px] text-[var(--color-fg-subtle)]">
															{run.message}
														</span>
													{/if}
													<span class="text-[11px] text-[var(--color-fg-subtle)] sm:hidden">
														{run.rule_name}
													</span>
												</div>
											</td>
											<td
												class="hidden px-3 py-2.5 text-[12px] text-[var(--color-fg-muted)] sm:table-cell"
											>
												{run.rule_name}
												{#if labelSetText(run.label_set)}
													<span class="block font-mono text-[10px] text-[var(--color-fg-subtle)]">
														{labelSetText(run.label_set)}
													</span>
												{/if}
											</td>
											<td
												class="px-3 py-2.5 text-[12px] whitespace-nowrap text-[var(--color-fg-muted)]"
											>
												{fmtRelative(run.created_at)}
												{#if run.duration_ms !== null}
													<span class="block font-mono text-[10px] text-[var(--color-fg-subtle)]">
														{run.duration_ms} ms
													</span>
												{/if}
											</td>
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
					</Card>
				{/if}
			</section>
		{/if}
	</div>

	<Modal
		open={editorOpen}
		onClose={() => (editorOpen = false)}
		title={editing ? m.actions_editor_edit_title() : m.actions_editor_new_title()}
		description={m.actions_editor_description()}
		width="lg"
	>
		<div class="flex flex-col gap-4">
			<Field label={m.actions_field_rule()} required>
				{#if editing}
					<p class="text-[13px] text-[var(--color-fg-muted)]">
						{ruleName.get(editing.rule_id) ?? `#${editing.rule_id}`}
					</p>
				{:else}
					<select bind:value={fRule} class={inputCls}>
						{#each rules as r (r.id)}
							<option value={String(r.id)}>{r.name}</option>
						{/each}
					</select>
				{/if}
			</Field>

			<div class="grid gap-4 sm:grid-cols-2">
				<Field label={m.actions_field_kind()} required>
					<select
						value={fKind}
						onchange={(e) => onKindChange(e.currentTarget.value as ActionKind)}
						class={inputCls}
					>
						<option value="script">{m.actions_kind_script()}</option>
						<option value="service">{m.actions_kind_service()}</option>
						<option value="container">{m.actions_kind_container()}</option>
					</select>
				</Field>

				<Field
					label={m.actions_field_target()}
					required
					hint={fKind === 'script' ? m.actions_target_hint_script() : m.actions_target_hint_unit()}
				>
					{#if fKind === 'script'}
						{#if scripts.length === 0}
							<p class="text-[12px] text-[var(--color-fg-subtle)]">{m.actions_no_scripts()}</p>
						{:else}
							<select bind:value={fTarget} class={inputCls}>
								{#each scripts as s (s)}
									<option value={s}>{s}</option>
								{/each}
							</select>
						{/if}
					{:else}
						<Input bind:value={fTarget} placeholder="nginx.service" />
					{/if}
				</Field>
			</div>

			{#if fKind !== 'script'}
				<Field label={m.actions_field_verb()} required>
					<select bind:value={fVerb} class={inputCls}>
						{#each verbOptions as v (v)}
							<option value={v}>{v}</option>
						{/each}
					</select>
				</Field>
			{/if}

			<div class="grid gap-4 sm:grid-cols-2">
				<Field label={m.actions_field_on_event()} hint={m.actions_on_event_hint()}>
					<select bind:value={fOnEvent} class={inputCls}>
						<option value="fired">{m.actions_on_fired()}</option>
						<option value="resolved">{m.actions_on_resolved()}</option>
						<option value="both">{m.actions_on_both()}</option>
					</select>
				</Field>

				<Field
					label={m.actions_field_mode()}
					hint={fMode === 'auto' && catalog && !catalog.auto
						? m.actions_mode_auto_blocked_hint()
						: m.actions_mode_hint()}
				>
					<select bind:value={fMode} class={inputCls}>
						<option value="manual">{m.actions_mode_manual_option()}</option>
						<option value="dry_run">{m.actions_mode_dry_run_option()}</option>
						<option value="auto">{m.actions_mode_auto_option()}</option>
					</select>
				</Field>
			</div>

			<div class="grid gap-4 sm:grid-cols-3">
				<Field label={m.actions_field_cooldown()} hint={m.actions_cooldown_hint()}>
					<Input bind:value={fCooldown} inputmode="numeric" invalid={cooldownSecs === null} />
				</Field>
				<Field label={m.actions_field_max_runs()} hint={m.actions_max_runs_hint()}>
					<Input bind:value={fMaxRuns} inputmode="numeric" invalid={maxRuns === null} />
				</Field>
				<Field label={m.actions_field_failure_limit()} hint={m.actions_failure_limit_hint()}>
					<Input bind:value={fFailureLimit} inputmode="numeric" invalid={failureLimit === null} />
				</Field>
			</div>

			<label class="flex cursor-pointer items-center gap-2 text-sm">
				<input type="checkbox" bind:checked={fEnabled} class="accent-[var(--color-accent)]" />
				{m.actions_field_enabled()}
			</label>
		</div>

		{#snippet footer()}
			<Button variant="secondary" onclick={() => (editorOpen = false)}>
				{m.common_cancel()}
			</Button>
			<Button variant="primary" onclick={saveEditor} disabled={!editorValid} loading={saving}>
				{editing ? m.actions_save() : m.actions_create()}
			</Button>
		{/snippet}
	</Modal>
{/if}
