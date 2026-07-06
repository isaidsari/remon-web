<script lang="ts">
	import { untrack } from 'svelte';
	import { page } from '$app/state';
	import Card from '$lib/components/ui/Card.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Field from '$lib/components/ui/Field.svelte';
	import Banner from '$lib/components/ui/Banner.svelte';
	import Modal from '$lib/components/ui/Modal.svelte';
	import SegmentedControl from '$lib/components/ui/SegmentedControl.svelte';
	import AutoRefreshSelect from '$lib/components/ui/AutoRefreshSelect.svelte';
	import RefreshButton from '$lib/components/ui/RefreshButton.svelte';
	import HeartbeatStateBadge from '$lib/components/heartbeats/HeartbeatStateBadge.svelte';
	import { profiles } from '$lib/stores/profiles.svelte';
	import { connections } from '$lib/stores/connections.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { confirm } from '$lib/stores/confirm.svelte';
	import { ApiError } from '$lib/api/error';
	import { fmtDuration, fmtRelative } from '$lib/utils/format';
	import { cn } from '$lib/utils/cn';
	import { m } from '$lib/paraglide/messages';
	import IconChevronDown from '~icons/lucide/chevron-down';
	import IconCopy from '~icons/lucide/copy';
	import IconPlus from '~icons/lucide/plus';
	import type { HeartbeatCheckDto, HeartbeatPingDto, UpdateHeartbeatRequest } from '$lib/types/api';

	let id = $derived(page.params.id ?? '');
	let profile = $derived(id ? profiles.byId(id) : undefined);
	let conn = $derived(profile ? connections.connect(profile) : null);

	$effect(() => {
		if (!conn) return;
		untrack(() => {
			conn.ensureSignedIn().catch((e) => {
				if (e instanceof ApiError)
					toast.error(m.heartbeats_toast_signin_failed(), { description: e.userMessage });
			});
		});
	});

	let checks = $state<HeartbeatCheckDto[]>([]);
	let loading = $state(false);
	let error = $state<ApiError | null>(null);
	let lastFetched = $state<number | null>(null);
	let q = $state('');
	let autoRefresh = $state(false);
	let expanded = $state<number | null>(null);

	const PINGS_PAGE = 50;
	let pingsCache = $state<Record<number, HeartbeatPingDto[] | { error: string }>>({});
	let pingsLoading = $state<Record<number, boolean>>({});

	// Coarse clock for countdowns; deadline math is second-granular anyway.
	let now = $state(Math.floor(Date.now() / 1000));
	$effect(() => {
		const t = setInterval(() => (now = Math.floor(Date.now() / 1000)), 15_000);
		return () => clearInterval(t);
	});

	let filtered = $derived.by(() => {
		const needle = q.trim().toLowerCase();
		if (!needle) return checks;
		return checks.filter(
			(c) =>
				c.name.toLowerCase().includes(needle) ||
				(c.description?.toLowerCase().includes(needle) ?? false)
		);
	});

	async function fetchList(bust = false) {
		if (!conn?.isAuthenticated) return;
		loading = true;
		error = null;
		try {
			const res = bust
				? await conn.client.request<{ checks: HeartbeatCheckDto[] }>('/heartbeats', {
						bypassCache: true
					})
				: await conn.client.listHeartbeats();
			checks = res.checks;
			lastFetched = Date.now();
			now = Math.floor(Date.now() / 1000);
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
		const t = setInterval(() => fetchList(true), 10_000);
		return () => clearInterval(t);
	});

	function toggleExpand(checkId: number) {
		expanded = expanded === checkId ? null : checkId;
		if (expanded !== null) void ensurePings(expanded);
	}

	async function ensurePings(checkId: number, bust = false) {
		if (!bust && pingsCache[checkId]) return;
		pingsLoading[checkId] = true;
		try {
			const res = await conn!.client.heartbeatPings(checkId, PINGS_PAGE);
			pingsCache[checkId] = res.pings;
		} catch (e) {
			pingsCache[checkId] = { error: e instanceof ApiError ? e.userMessage : String(e) };
		} finally {
			pingsLoading[checkId] = false;
		}
	}

	/** Post-mutation refresh: bust the client GET cache so state is current. */
	async function refreshAfterMutation(checkId?: number) {
		await fetchList(true);
		if (checkId !== undefined && pingsCache[checkId]) void ensurePings(checkId, true);
	}

	// ===== deadline / pause description =====

	function deadlineText(c: HeartbeatCheckDto): string {
		if (c.state === 'disabled') return '—';
		if (c.state === 'paused') {
			return c.paused_until
				? m.heartbeats_paused_until({ time: new Date(c.paused_until * 1000).toLocaleString() })
				: m.heartbeats_paused_indefinite();
		}
		if (c.state === 'failed') return m.heartbeats_failed_hint();
		const delta = c.deadline_at - now;
		if (delta >= 0) return m.heartbeats_due_in({ d: fmtDuration(delta) });
		return m.heartbeats_overdue_by({ d: fmtDuration(-delta) });
	}

	// ===== create / edit =====

	let editorOpen = $state(false);
	let editing = $state<HeartbeatCheckDto | null>(null);
	let fName = $state('');
	let fDescription = $state('');
	let fPeriod = $state('3600');
	let fGrace = $state('300');
	let fEnabled = $state(true);
	let fCreatePaused = $state(true);
	let saving = $state(false);

	function openCreate() {
		editing = null;
		fName = '';
		fDescription = '';
		fPeriod = '3600';
		fGrace = '300';
		fEnabled = true;
		fCreatePaused = true;
		editorOpen = true;
	}

	function openEdit(c: HeartbeatCheckDto) {
		editing = c;
		fName = c.name;
		fDescription = c.description ?? '';
		fPeriod = String(c.period_secs);
		fGrace = String(c.grace_secs);
		fEnabled = c.enabled;
		editorOpen = true;
	}

	function parsedSecs(v: string): number | null {
		const n = Number(v.trim());
		return Number.isInteger(n) && n >= 0 ? n : null;
	}
	let periodSecs = $derived(parsedSecs(fPeriod));
	let graceSecs = $derived(parsedSecs(fGrace));
	let editorValid = $derived(
		fName.trim().length > 0 && periodSecs !== null && periodSecs >= 10 && graceSecs !== null
	);

	async function saveEditor() {
		if (!conn?.isAuthenticated || !editorValid) return;
		saving = true;
		try {
			if (editing) {
				const req: UpdateHeartbeatRequest = {};
				const desc = fDescription.trim();
				if (fName.trim() !== editing.name) req.name = fName.trim();
				if (desc !== (editing.description ?? '')) req.description = desc === '' ? null : desc;
				if (periodSecs !== editing.period_secs) req.period_secs = periodSecs!;
				if (graceSecs !== editing.grace_secs) req.grace_secs = graceSecs!;
				if (fEnabled !== editing.enabled) req.enabled = fEnabled;
				await conn.client.updateHeartbeat(editing.id, req);
				toast.success(m.heartbeats_saved_toast());
			} else {
				const res = await conn.client.createHeartbeat({
					name: fName.trim(),
					description: fDescription.trim() || undefined,
					period_secs: periodSecs!,
					grace_secs: graceSecs!,
					paused: fCreatePaused
				});
				// The slug exists only in this response — surface it before
				// anything else can go wrong.
				openSlugModal(res.ping_path);
			}
			editorOpen = false;
			await refreshAfterMutation();
		} catch (e) {
			if (e instanceof ApiError)
				toast.error(editing ? m.heartbeats_update_failed() : m.heartbeats_create_failed(), {
					description: e.userMessage
				});
		} finally {
			saving = false;
		}
	}

	// ===== slug reveal (create / rotate) =====

	let slugOpen = $state(false);
	let slugPingPath = $state('');
	let slugUrl = $derived(profile ? `${profile.baseUrl.replace(/\/+$/, '')}${slugPingPath}` : '');

	function openSlugModal(pingPath: string) {
		slugPingPath = pingPath;
		slugOpen = true;
	}

	async function copyText(text: string) {
		try {
			await navigator.clipboard.writeText(text);
			toast.success(m.heartbeats_copied());
		} catch {
			toast.error(m.heartbeats_copy_failed());
		}
	}

	async function rotateSlug(c: HeartbeatCheckDto) {
		const ok = await confirm({
			title: m.heartbeats_rotate_confirm_title(),
			description: m.heartbeats_rotate_confirm_desc({ name: c.name }),
			confirmLabel: m.heartbeats_rotate(),
			variant: 'warning'
		});
		if (!ok || !conn?.isAuthenticated) return;
		try {
			const res = await conn.client.rotateHeartbeatSlug(c.id);
			openSlugModal(res.ping_path);
		} catch (e) {
			if (e instanceof ApiError)
				toast.error(m.heartbeats_rotate_failed(), { description: e.userMessage });
		}
	}

	// ===== pause / resume =====

	type PausePreset = '1h' | '3h' | '24h' | '7d' | 'inf';
	const PAUSE_SECS: Record<Exclude<PausePreset, 'inf'>, number> = {
		'1h': 3600,
		'3h': 3 * 3600,
		'24h': 86_400,
		'7d': 7 * 86_400
	};
	let pauseOpen = $state(false);
	let pauseTarget = $state<HeartbeatCheckDto | null>(null);
	let pausePreset = $state<PausePreset>('1h');
	let pauseReason = $state('');
	let pausing = $state(false);

	function openPause(c: HeartbeatCheckDto) {
		pauseTarget = c;
		pausePreset = '1h';
		pauseReason = '';
		pauseOpen = true;
	}

	async function submitPause() {
		if (!pauseTarget || !conn?.isAuthenticated) return;
		pausing = true;
		try {
			await conn.client.pauseHeartbeat(pauseTarget.id, {
				...(pausePreset !== 'inf' ? { duration_secs: PAUSE_SECS[pausePreset] } : {}),
				...(pauseReason.trim() ? { reason: pauseReason.trim() } : {})
			});
			toast.success(m.heartbeats_paused_toast({ name: pauseTarget.name }));
			pauseOpen = false;
			await refreshAfterMutation(pauseTarget.id);
		} catch (e) {
			if (e instanceof ApiError)
				toast.error(m.heartbeats_pause_failed(), { description: e.userMessage });
		} finally {
			pausing = false;
		}
	}

	async function resume(c: HeartbeatCheckDto) {
		if (!conn?.isAuthenticated) return;
		try {
			await conn.client.resumeHeartbeat(c.id);
			toast.success(m.heartbeats_resumed_toast({ name: c.name }));
			await refreshAfterMutation(c.id);
		} catch (e) {
			if (e instanceof ApiError)
				toast.error(m.heartbeats_resume_failed(), { description: e.userMessage });
		}
	}

	async function remove(c: HeartbeatCheckDto) {
		const ok = await confirm({
			title: m.heartbeats_delete_confirm_title(),
			description: m.heartbeats_delete_confirm_desc({ name: c.name }),
			confirmLabel: m.heartbeats_delete(),
			variant: 'danger'
		});
		if (!ok || !conn?.isAuthenticated) return;
		try {
			await conn.client.deleteHeartbeat(c.id);
			toast.success(m.heartbeats_deleted_toast({ name: c.name }));
			if (expanded === c.id) expanded = null;
			await refreshAfterMutation();
		} catch (e) {
			if (e instanceof ApiError)
				toast.error(m.heartbeats_delete_failed(), { description: e.userMessage });
		}
	}
</script>

{#if profile}
	<div class="px-4 py-6 md:px-8 md:py-8">
		<header class="mb-4 flex flex-col gap-3 sm:mb-6 sm:flex-row sm:items-end sm:justify-between">
			<div>
				<h1
					class="flex items-baseline gap-2.5 text-[22px] font-semibold tracking-tight sm:text-[24px]"
				>
					{m.section_heartbeats()}
					<span
						class="rounded-md bg-[var(--color-surface-2)] px-2 py-0.5 font-mono text-[12px] font-medium text-[var(--color-fg-muted)] shadow-[inset_0_0_0_1px_var(--color-border)]"
					>
						{checks.length}
					</span>
				</h1>
				<p class="mt-1.5 max-w-md text-[13px] text-[var(--color-fg-muted)]">
					{m.heartbeats_page_description()}
					{#if lastFetched}
						<span class="ml-2 text-[12px] text-[var(--color-fg-subtle)]">
							{m.heartbeats_updated_at({ time: new Date(lastFetched).toLocaleTimeString() })}
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
				<RefreshButton onclick={() => fetchList(true)} {loading} label={m.heartbeats_refresh()} />
				<Button variant="primary" size="sm" onclick={openCreate}>
					<IconPlus class="size-[14px]" stroke-width="2.25" />
					{m.heartbeats_new_check()}
				</Button>
			</div>
		</header>

		{#if !conn?.isAuthenticated}
			<Card padding="lg" class="border-[var(--color-warning)]/30">
				<p class="text-sm text-[var(--color-fg-muted)]">{m.heartbeats_signin_required()}</p>
			</Card>
		{:else if error}
			<Banner variant="danger" title={m.heartbeats_fetch_failed_title()}>
				{error.userMessage}
				{#snippet actions()}
					<Button variant="secondary" size="sm" onclick={() => fetchList(true)}>
						{m.heartbeats_retry()}
					</Button>
				{/snippet}
			</Banner>
		{:else if checks.length === 0 && !loading}
			<Card padding="lg">
				<p class="text-sm text-[var(--color-fg-subtle)]">{m.heartbeats_empty()}</p>
			</Card>
		{:else}
			{#if checks.length > 0}
				<div class="mb-3 flex">
					<Input
						placeholder={m.heartbeats_filter_placeholder()}
						bind:value={q}
						class="w-full text-sm sm:max-w-xs"
					/>
				</div>
			{/if}

			<Card padding="none" class="overflow-hidden">
				<div class="max-h-[calc(100vh-20rem)] overflow-auto">
					<table class="w-full text-sm">
						<thead
							class="sticky top-0 z-10 bg-[var(--color-surface-2)] text-[11px] font-medium tracking-[0.06em] text-[var(--color-fg-muted)]"
						>
							<tr>
								<th class="px-3 py-2.5 text-left font-medium">{m.heartbeats_table_state()}</th>
								<th class="px-3 py-2.5 text-left font-medium">{m.heartbeats_table_name()}</th>
								<th class="hidden px-3 py-2.5 text-left font-medium md:table-cell">
									{m.heartbeats_table_period()}
								</th>
								<th class="hidden px-3 py-2.5 text-left font-medium sm:table-cell">
									{m.heartbeats_table_last_ping()}
								</th>
								<th class="hidden px-3 py-2.5 text-left font-medium md:table-cell">
									{m.heartbeats_table_deadline()}
								</th>
								<th class="w-8 px-2 py-2.5" aria-hidden="true"></th>
							</tr>
						</thead>
						<tbody>
							{#each filtered as c (c.id)}
								{@const isOpen = expanded === c.id}
								<tr
									class={cn(
										'cursor-pointer border-t border-[var(--color-border)] transition-colors hover:bg-[var(--color-surface-2)]/50',
										(c.state === 'down' || c.state === 'failed') &&
											'bg-[var(--color-danger-bg)]/40',
										!c.enabled && 'opacity-60'
									)}
									onclick={() => toggleExpand(c.id)}
								>
									<td class="px-3 py-2.5"><HeartbeatStateBadge state={c.state} /></td>
									<td class="px-3 py-2.5">
										<div class="flex flex-col">
											<span class="font-mono text-[12px] font-medium text-[var(--color-fg)]">
												{c.name}
											</span>
											{#if c.description}
												<span
													class="max-w-[28ch] truncate text-[11px] text-[var(--color-fg-subtle)]"
												>
													{c.description}
												</span>
											{/if}
										</div>
									</td>
									<td
										class="hidden px-3 py-2.5 font-mono text-[12px] text-[var(--color-fg-muted)] md:table-cell"
									>
										{fmtDuration(c.period_secs)}
										<span class="text-[var(--color-fg-subtle)]">
											+ {fmtDuration(c.grace_secs)}
										</span>
									</td>
									<td
										class="hidden px-3 py-2.5 text-[12px] text-[var(--color-fg-muted)] sm:table-cell"
									>
										{c.last_ping_at ? fmtRelative(c.last_ping_at) : m.heartbeats_never_pinged()}
									</td>
									<td
										class="hidden px-3 py-2.5 text-[12px] text-[var(--color-fg-muted)] md:table-cell"
									>
										{deadlineText(c)}
									</td>
									<td class="px-2 py-2.5 text-[var(--color-fg-subtle)]">
										<IconChevronDown
											class={cn('size-4 transition-transform', isOpen && 'rotate-180')}
										/>
									</td>
								</tr>
								{#if isOpen}
									{@const pings = pingsCache[c.id]}
									<tr class="border-t border-[var(--color-border)] bg-[var(--color-surface)]/60">
										<td colspan="6" class="px-4 py-4">
											<div class="flex flex-col gap-4">
												<div
													class="grid grid-cols-2 gap-x-6 gap-y-2 text-[12px] text-[var(--color-fg-muted)] sm:grid-cols-3 lg:grid-cols-4"
												>
													<div>
														<span
															class="block text-[10px] uppercase tracking-wide text-[var(--color-fg-subtle)]"
														>
															{m.heartbeats_meta_last_fail()}
														</span>
														{c.last_fail_at ? fmtRelative(c.last_fail_at) : '—'}
													</div>
													<div>
														<span
															class="block text-[10px] uppercase tracking-wide text-[var(--color-fg-subtle)]"
														>
															{m.heartbeats_meta_created()}
														</span>
														{fmtRelative(c.created_at)}
													</div>
													{#if c.paused}
														<div>
															<span
																class="block text-[10px] uppercase tracking-wide text-[var(--color-fg-subtle)]"
															>
																{m.heartbeats_meta_pause()}
															</span>
															{c.pause_origin ?? '—'}
															{#if c.pause_reason}
																· {c.pause_reason}
															{/if}
														</div>
													{/if}
												</div>

												<div class="flex flex-wrap items-center gap-2">
													{#if c.paused}
														<Button variant="secondary" size="sm" onclick={() => resume(c)}>
															{m.heartbeats_action_resume()}
														</Button>
													{:else}
														<Button variant="secondary" size="sm" onclick={() => openPause(c)}>
															{m.heartbeats_action_pause()}
														</Button>
													{/if}
													<Button variant="secondary" size="sm" onclick={() => openEdit(c)}>
														{m.heartbeats_action_edit()}
													</Button>
													<Button variant="secondary" size="sm" onclick={() => rotateSlug(c)}>
														{m.heartbeats_action_rotate()}
													</Button>
													<Button variant="ghost" size="sm" onclick={() => remove(c)}>
														<span class="text-[var(--color-danger)]">{m.heartbeats_delete()}</span>
													</Button>
												</div>

												<div>
													<h3
														class="mb-2 text-[11px] font-medium uppercase tracking-wide text-[var(--color-fg-subtle)]"
													>
														{m.heartbeats_pings_title()}
													</h3>
													{#if pingsLoading[c.id]}
														<p class="text-[12px] text-[var(--color-fg-subtle)]">…</p>
													{:else if pings && 'error' in pings}
														<p class="text-[12px] text-[var(--color-danger)]">{pings.error}</p>
													{:else if pings && pings.length === 0}
														<p class="text-[12px] text-[var(--color-fg-subtle)]">
															{m.heartbeats_pings_empty()}
														</p>
													{:else if pings}
														<div class="overflow-x-auto">
															<table class="w-full text-[12px]">
																<thead
																	class="text-left text-[10px] uppercase tracking-wide text-[var(--color-fg-subtle)]"
																>
																	<tr>
																		<th class="py-1 pr-4 font-medium">{m.heartbeats_ping_kind()}</th
																		>
																		<th class="py-1 pr-4 font-medium">{m.heartbeats_ping_time()}</th
																		>
																		<th class="py-1 pr-4 font-medium">{m.heartbeats_ping_exit()}</th
																		>
																		<th class="py-1 pr-4 font-medium"
																			>{m.heartbeats_ping_source()}</th
																		>
																		<th class="py-1 font-medium">{m.heartbeats_ping_body()}</th>
																	</tr>
																</thead>
																<tbody class="text-[var(--color-fg-muted)]">
																	{#each pings as p, i (i)}
																		<tr class="border-t border-[var(--color-border)]/60">
																			<td class="py-1.5 pr-4">
																				<span
																					class={cn(
																						'font-mono text-[11px]',
																						p.kind === 'success' && 'text-[var(--color-success)]',
																						p.kind === 'fail' && 'text-[var(--color-danger)]',
																						(p.kind === 'pause' || p.kind === 'resume') &&
																							'text-[var(--color-info)]'
																					)}
																				>
																					{p.kind}
																				</span>
																			</td>
																			<td class="py-1.5 pr-4 whitespace-nowrap">
																				{fmtRelative(p.received_at)}
																			</td>
																			<td class="py-1.5 pr-4 font-mono">
																				{p.exit_code ?? '—'}
																			</td>
																			<td class="py-1.5 pr-4 font-mono text-[11px]">
																				{p.source_ip ?? '—'}
																			</td>
																			<td
																				class="max-w-[36ch] truncate py-1.5 font-mono text-[11px]"
																				title={p.body ?? ''}
																			>
																				{p.body ?? '—'}
																			</td>
																		</tr>
																	{/each}
																</tbody>
															</table>
														</div>
													{/if}
												</div>
											</div>
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

	<!-- create / edit -->
	<Modal
		open={editorOpen}
		onClose={() => (editorOpen = false)}
		title={editing ? m.heartbeats_edit_title() : m.heartbeats_create_title()}
		width="md"
	>
		<div class="flex flex-col gap-4">
			<Field label={m.heartbeats_field_name()} required hint={m.heartbeats_field_name_hint()}>
				<Input bind:value={fName} placeholder="db-backup" disabled={saving} />
			</Field>
			<Field label={m.heartbeats_field_description()}>
				<Input bind:value={fDescription} disabled={saving} />
			</Field>
			<div class="grid grid-cols-2 gap-3">
				<Field
					label={m.heartbeats_field_period()}
					required
					hint={periodSecs !== null ? fmtDuration(periodSecs) : undefined}
					error={fPeriod && (periodSecs === null || periodSecs < 10)
						? m.heartbeats_field_period_error()
						: null}
				>
					<Input bind:value={fPeriod} inputmode="numeric" disabled={saving} />
				</Field>
				<Field
					label={m.heartbeats_field_grace()}
					hint={graceSecs !== null ? fmtDuration(graceSecs) : undefined}
				>
					<Input bind:value={fGrace} inputmode="numeric" disabled={saving} />
				</Field>
			</div>
			{#if editing}
				<label class="flex items-center gap-2 text-[13px] text-[var(--color-fg-muted)]">
					<input
						type="checkbox"
						bind:checked={fEnabled}
						disabled={saving}
						class="accent-[var(--color-accent)]"
					/>
					{m.heartbeats_field_enabled()}
				</label>
			{:else}
				<label class="flex items-start gap-2 text-[13px] text-[var(--color-fg-muted)]">
					<input
						type="checkbox"
						bind:checked={fCreatePaused}
						disabled={saving}
						class="mt-0.5 accent-[var(--color-accent)]"
					/>
					<span>
						{m.heartbeats_field_create_paused()}
						<span class="block text-[11px] text-[var(--color-fg-subtle)]">
							{m.heartbeats_field_create_paused_hint()}
						</span>
					</span>
				</label>
			{/if}
		</div>
		{#snippet footer()}
			<div class="flex justify-end gap-2">
				<Button variant="secondary" size="sm" onclick={() => (editorOpen = false)}>
					{m.heartbeats_cancel()}
				</Button>
				<Button
					variant="primary"
					size="sm"
					onclick={saveEditor}
					loading={saving}
					disabled={!editorValid}
				>
					{editing ? m.heartbeats_save() : m.heartbeats_create()}
				</Button>
			</div>
		{/snippet}
	</Modal>

	<!-- slug reveal: create / rotate -->
	<Modal
		open={slugOpen}
		onClose={() => (slugOpen = false)}
		title={m.heartbeats_slug_title()}
		width="lg"
		closeOnBackdrop={false}
	>
		<div class="flex flex-col gap-4">
			<Banner variant="warning" title={m.heartbeats_slug_warning_title()}>
				{m.heartbeats_slug_warning()}
			</Banner>
			<Field label={m.heartbeats_slug_ping_url()}>
				<div class="flex items-center gap-2">
					<code
						class="min-w-0 flex-1 truncate rounded-[var(--radius-input)] bg-[var(--color-surface-2)] px-3 py-2 font-mono text-[12px] shadow-[inset_0_0_0_1px_var(--color-border)]"
					>
						{slugUrl}
					</code>
					<Button variant="secondary" size="sm" onclick={() => copyText(slugUrl)}>
						<IconCopy class="size-[13px]" />
						{m.heartbeats_copy()}
					</Button>
				</div>
			</Field>
			<Field label={m.heartbeats_slug_curl_label()} hint={m.heartbeats_slug_curl_hint()}>
				<div class="flex items-center gap-2">
					<code
						class="min-w-0 flex-1 truncate rounded-[var(--radius-input)] bg-[var(--color-surface-2)] px-3 py-2 font-mono text-[12px] text-[var(--color-fg-muted)] shadow-[inset_0_0_0_1px_var(--color-border)]"
					>
						curl -fsS {slugUrl}
					</code>
					<Button variant="secondary" size="sm" onclick={() => copyText(`curl -fsS ${slugUrl}`)}>
						<IconCopy class="size-[13px]" />
						{m.heartbeats_copy()}
					</Button>
				</div>
			</Field>
		</div>
		{#snippet footer()}
			<div class="flex justify-end">
				<Button variant="primary" size="sm" onclick={() => (slugOpen = false)}>
					{m.heartbeats_slug_done()}
				</Button>
			</div>
		{/snippet}
	</Modal>

	<!-- operator pause -->
	<Modal
		open={pauseOpen}
		onClose={() => (pauseOpen = false)}
		title={m.heartbeats_pause_title({ name: pauseTarget?.name ?? '' })}
		description={m.heartbeats_pause_description()}
		width="md"
	>
		<div class="flex flex-col gap-4">
			<Field label={m.heartbeats_pause_for()}>
				<SegmentedControl
					value={pausePreset}
					options={[
						{ value: '1h', label: '1h' },
						{ value: '3h', label: '3h' },
						{ value: '24h', label: '24h' },
						{ value: '7d', label: '7d' },
						{ value: 'inf', label: m.heartbeats_pause_indefinite() }
					]}
					onSelect={(v) => (pausePreset = v)}
					ariaLabel={m.heartbeats_pause_for()}
				/>
			</Field>
			<Field label={m.heartbeats_pause_reason()}>
				<Input
					bind:value={pauseReason}
					placeholder={m.heartbeats_pause_reason_placeholder()}
					disabled={pausing}
				/>
			</Field>
		</div>
		{#snippet footer()}
			<div class="flex justify-end gap-2">
				<Button variant="secondary" size="sm" onclick={() => (pauseOpen = false)}>
					{m.heartbeats_cancel()}
				</Button>
				<Button variant="primary" size="sm" onclick={submitPause} loading={pausing}>
					{m.heartbeats_pause_confirm()}
				</Button>
			</div>
		{/snippet}
	</Modal>
{/if}
