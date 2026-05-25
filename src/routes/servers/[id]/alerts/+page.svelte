<script lang="ts">
	import { untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import Card from '$lib/components/ui/Card.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Modal from '$lib/components/ui/Modal.svelte';
	import Banner from '$lib/components/ui/Banner.svelte';
	import Tabs from '$lib/components/layout/Tabs.svelte';
	import AlertRuleEditor from '$lib/components/alerts/AlertRuleEditor.svelte';
	import { profiles } from '$lib/stores/profiles.svelte';
	import { connections } from '$lib/stores/connections.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { confirm } from '$lib/stores/confirm.svelte';
	import { ApiError } from '$lib/api/error';
	import { fmtRelative, fmtDuration } from '$lib/utils/format';
	import { cn } from '$lib/utils/cn';
	import { m } from '$lib/paraglide/messages';
	import { describeExpression } from '$lib/utils/alertExpression';
	import IconPencil from '~icons/lucide/pencil';
	import IconTrash from '~icons/lucide/trash-2';
	import IconCheck from '~icons/lucide/check';
	import IconFlame from '~icons/lucide/flame';
	import IconClock from '~icons/lucide/clock';
	import IconCircleCheck from '~icons/lucide/circle-check';
	import IconBellOff from '~icons/lucide/bell-off';
	import IconBell from '~icons/lucide/bell';
	import type {
		AlertRuleDto,
		AlertStateDto,
		AlertEventDto,
		AlertSeverity,
		AlertsSchemaResponse,
		CreateAlertRuleRequest
	} from '$lib/types/api';

	let id = $derived(page.params.id ?? '');
	let profile = $derived(id ? profiles.byId(id) : undefined);
	let conn = $derived(profile ? connections.connect(profile) : null);

	$effect(() => {
		if (!conn) return;
		untrack(() => {
			conn.ensureSignedIn().catch((e) => {
				if (e instanceof ApiError)
					toast.error(m.alerts_toast_signin_failed(), { description: e.userMessage });
			});
		});
	});

	type TabKey = 'rules' | 'active' | 'events';
	let tab = $derived<TabKey>(
		(['rules', 'active', 'events'] as const).find((k) => k === page.url.searchParams.get('tab')) ??
			'rules'
	);

	let rules = $state<AlertRuleDto[]>([]);
	let activeStates = $state<AlertStateDto[]>([]);
	let events = $state<AlertEventDto[]>([]);
	let rulesById = $derived(new Map(rules.map((r) => [r.id, r])));
	let schema = $state<AlertsSchemaResponse | null>(null);

	type Episode = { fired: AlertEventDto; resolved?: AlertEventDto };

	let episodes = $derived.by((): Episode[] => {
		const sorted = [...events].sort((a, b) => a.occurred_at - b.occurred_at);
		const result: Episode[] = [];
		const pending = new Map<string, Episode>();
		for (const ev of sorted) {
			const key = `${ev.rule_id}:${ev.label_set}`;
			if (ev.event_type === 'fired') {
				const ep: Episode = { fired: ev };
				pending.set(key, ep);
				result.push(ep);
			} else {
				const ep = pending.get(key);
				if (ep) {
					ep.resolved = ev;
					pending.delete(key);
				}
			}
		}
		return result.reverse();
	});
	let busy = $state(false);
	let acting = $state<string | null>(null);
	let q = $state('');
	const EVENT_PAGE = 50;
	let eventsLoadingMore = $state(false);
	let eventsHasMore = $state(false);

	async function fetchAll() {
		if (!conn?.isAuthenticated) return;
		busy = true;
		try {
			// Schema is static per server version — fetch once and reuse.
			const schemaPromise = schema
				? Promise.resolve(schema)
				: conn.client.alertsSchema().catch(() => null);
			const [r, s, e, sch] = await Promise.all([
				conn.client.listAlertRules(),
				conn.client.alertState(),
				conn.client.alertEvents(EVENT_PAGE),
				schemaPromise
			]);
			rules = r.rules;
			activeStates = s.states;
			events = e.events;
			eventsHasMore = e.events.length === EVENT_PAGE;
			if (sch && !schema) schema = sch;
		} catch (e) {
			if (e instanceof ApiError)
				toast.error(m.alerts_toast_load_failed(), { description: e.userMessage });
		} finally {
			busy = false;
		}
	}

	async function loadMoreEvents() {
		if (!conn?.isAuthenticated || eventsLoadingMore) return;
		eventsLoadingMore = true;
		try {
			const res = await conn.client.alertEvents(EVENT_PAGE, events.length);
			events = [...events, ...res.events];
			eventsHasMore = res.events.length === EVENT_PAGE;
		} catch (e) {
			if (e instanceof ApiError)
				toast.error(m.alerts_toast_load_failed(), { description: e.userMessage });
		} finally {
			eventsLoadingMore = false;
		}
	}

	$effect(() => {
		if (conn?.isAuthenticated) fetchAll();
	});

	function setTab(t: TabKey) {
		const url = new URL(page.url);
		url.searchParams.set('tab', t);
		goto(url, { replaceState: true, keepFocus: true });
	}

	const tabsConfig = $derived([
		{ key: 'rules' as const, label: m.alerts_tab_rules(), count: rules.length },
		{ key: 'active' as const, label: m.alerts_tab_active(), count: activeStates.length },
		{ key: 'events' as const, label: m.alerts_tab_events(), count: events.length }
	]);

	let filteredRules = $derived.by(() => {
		const needle = q.trim().toLowerCase();
		return needle
			? rules.filter(
					(r) =>
						r.name.toLowerCase().includes(needle) || r.expression.toLowerCase().includes(needle)
				)
			: rules;
	});

	let showForm = $state(false);
	let editTarget = $state<AlertRuleDto | null>(null);

	let formName = $state('');
	let formDescription = $state('');
	let formExpression = $state('');
	let formSeverity = $state<AlertSeverity>('warn');
	let formEnabled = $state(true);
	let formForDuration = $state(30);
	let formEvalInterval = $state(10);
	let formCooldown = $state(900);
	let formBusy = $state(false);

	function openCreate() {
		editTarget = null;
		formName = '';
		formDescription = '';
		formExpression = '';
		formSeverity = 'warn';
		formEnabled = true;
		formForDuration = 30;
		formEvalInterval = 10;
		formCooldown = 900;
		showForm = true;
	}

	function openEdit(rule: AlertRuleDto) {
		editTarget = rule;
		formName = rule.name;
		formDescription = rule.description ?? '';
		formExpression = rule.expression;
		formSeverity = rule.severity;
		formEnabled = rule.enabled;
		formForDuration = rule.for_duration_secs;
		formEvalInterval = rule.eval_interval_secs;
		formCooldown = rule.cooldown_secs;
		showForm = true;
	}

	async function submitForm() {
		if (!conn?.isAuthenticated) return;
		formBusy = true;
		try {
			const req: CreateAlertRuleRequest = {
				name: formName.trim(),
				description: formDescription.trim() || null,
				expression: formExpression.trim(),
				severity: formSeverity,
				enabled: formEnabled,
				for_duration_secs: formForDuration,
				eval_interval_secs: formEvalInterval,
				cooldown_secs: formCooldown
			};
			if (editTarget) {
				await conn.client.updateAlertRule(editTarget.id, req);
				toast.success(m.alerts_toast_rule_updated());
			} else {
				await conn.client.createAlertRule(req);
				toast.success(m.alerts_toast_rule_created());
			}
			showForm = false;
			fetchAll();
		} catch (e) {
			if (e instanceof ApiError)
				toast.error(m.alerts_toast_save_failed(), { description: e.userMessage });
		} finally {
			formBusy = false;
		}
	}

	async function toggleEnabled(rule: AlertRuleDto) {
		acting = `toggle:${rule.id}`;
		try {
			await conn!.client.updateAlertRule(rule.id, { enabled: !rule.enabled });
			fetchAll();
		} catch (e) {
			if (e instanceof ApiError)
				toast.error(m.alerts_toast_update_failed(), { description: e.userMessage });
		} finally {
			acting = null;
		}
	}

	let silenceTarget = $state<AlertRuleDto | null>(null);
	let silenceBusy = $state(false);

	// now ticks via 1s interval so the silenced-until countdown updates without a refetch.
	let now = $state(Math.floor(Date.now() / 1000));
	$effect(() => {
		const t = setInterval(() => (now = Math.floor(Date.now() / 1000)), 1000);
		return () => clearInterval(t);
	});

	function isSilenced(rule: AlertRuleDto): boolean {
		return rule.silenced_until !== null && rule.silenced_until > now;
	}

	const SILENCE_PRESETS: { label: () => string; secs: number }[] = [
		{ label: () => m.alerts_silence_preset_15m(), secs: 15 * 60 },
		{ label: () => m.alerts_silence_preset_1h(), secs: 60 * 60 },
		{ label: () => m.alerts_silence_preset_4h(), secs: 4 * 60 * 60 },
		{ label: () => m.alerts_silence_preset_24h(), secs: 24 * 60 * 60 },
		{ label: () => m.alerts_silence_preset_7d(), secs: 7 * 24 * 60 * 60 }
	];

	function openSilence(rule: AlertRuleDto) {
		silenceTarget = rule;
	}

	function closeSilence() {
		if (silenceBusy) return;
		silenceTarget = null;
	}

	async function applySilence(durationSecs: number) {
		if (!silenceTarget) return;
		const rule = silenceTarget;
		silenceBusy = true;
		try {
			await conn!.client.silenceAlertRule(rule.id, { duration_secs: durationSecs });
			toast.success(m.alerts_toast_silenced({ name: rule.name }));
			silenceTarget = null;
			fetchAll();
		} catch (e) {
			if (e instanceof ApiError)
				toast.error(m.alerts_toast_silence_failed(), { description: e.userMessage });
		} finally {
			silenceBusy = false;
		}
	}

	async function unsilenceRule(rule: AlertRuleDto) {
		acting = `unsilence:${rule.id}`;
		try {
			await conn!.client.unsilenceAlertRule(rule.id);
			toast.success(m.alerts_toast_unsilenced({ name: rule.name }));
			fetchAll();
		} catch (e) {
			if (e instanceof ApiError)
				toast.error(m.alerts_toast_unsilence_failed(), { description: e.userMessage });
		} finally {
			acting = null;
		}
	}

	async function deleteRule(rule: AlertRuleDto) {
		const ok = await confirm({
			title: m.alerts_confirm_delete_title({ name: rule.name }),
			description: m.alerts_confirm_delete_description(),
			confirmLabel: m.alerts_action_delete(),
			variant: 'danger'
		});
		if (!ok) return;
		acting = `delete:${rule.id}`;
		try {
			await conn!.client.deleteAlertRule(rule.id);
			toast.success(m.alerts_toast_rule_deleted({ name: rule.name }));
			fetchAll();
		} catch (e) {
			if (e instanceof ApiError)
				toast.error(m.alerts_toast_delete_failed(), { description: e.userMessage });
		} finally {
			acting = null;
		}
	}
</script>

{#snippet severityBadge(sev: AlertSeverity)}
	<span
		class={cn(
			'inline-flex items-center rounded-full px-2 py-0.5 font-mono text-[10px] font-medium tracking-wide',
			sev === 'crit'
				? 'bg-[var(--color-danger)]/10 text-[var(--color-danger)]'
				: 'bg-[var(--color-warning)]/10 text-[var(--color-warning)]'
		)}>{sev}</span
	>
{/snippet}

{#snippet stateBadge(state: string)}
	{@const Icon = state === 'firing' ? IconFlame : state === 'pending' ? IconClock : IconCircleCheck}
	{@const stateLabel =
		state === 'firing'
			? m.alerts_state_firing()
			: state === 'pending'
				? m.alerts_state_pending()
				: m.alerts_state_ok()}
	<span
		class={cn(
			'inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[10px] font-medium tracking-wide',
			state === 'firing'
				? 'bg-[var(--color-danger)]/10 text-[var(--color-danger)]'
				: state === 'pending'
					? 'bg-[var(--color-warning)]/10 text-[var(--color-warning)]'
					: 'bg-[var(--color-success)]/10 text-[var(--color-success)]'
		)}
	>
		<Icon class="size-[11px]" stroke-width="2.25" />
		{stateLabel}
	</span>
{/snippet}

{#if profile}
	<div class="px-4 py-6 md:px-8 md:py-8">
		<header class="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
			<div>
				<h1 class="text-[24px] font-semibold tracking-tight">{m.alerts_page_title()}</h1>
				<p class="mt-1.5 text-sm text-[var(--color-fg-muted)]">
					{m.alerts_page_subtitle()}
				</p>
			</div>
			<div class="flex flex-wrap items-center gap-2">
				<Button variant="secondary" size="sm" onclick={fetchAll} loading={busy}
					>{m.alerts_action_refresh()}</Button
				>
				<Button size="sm" onclick={openCreate}>{m.alerts_action_new_rule()}</Button>
			</div>
		</header>

		{#if !conn?.isAuthenticated}
			<Banner variant="warning" title={m.alerts_banner_not_signed_in_title()}
				>{m.alerts_banner_not_signed_in_body()}</Banner
			>
		{:else}
			<div class="mb-4 flex items-center justify-between gap-4">
				<Tabs tabs={tabsConfig} value={tab} onSelect={setTab} />
				{#if tab === 'rules'}
					<Input
						placeholder={m.alerts_filter_rules_placeholder()}
						bind:value={q}
						class="w-64 text-sm"
					/>
				{/if}
			</div>

			{#if tab === 'rules'}
				<Card padding="none" class="overflow-hidden">
					<div class="max-h-[calc(100vh-22rem)] overflow-auto">
						<table class="w-full text-sm">
							<thead
								class="sticky top-0 z-10 bg-[var(--color-surface-2)] text-xs tracking-wide text-[var(--color-fg-muted)]"
							>
								<tr>
									<th class="px-3 py-2.5 text-left font-medium">{m.alerts_table_name()}</th>
									<th class="px-3 py-2.5 text-left font-medium">{m.alerts_table_expression()}</th>
									<th class="px-3 py-2.5 text-left font-medium">{m.alerts_table_severity()}</th>
									<th class="px-3 py-2.5 text-left font-medium">{m.alerts_table_for()}</th>
									<th class="px-3 py-2.5 text-left font-medium">{m.alerts_table_cooldown()}</th>
									<th class="px-3 py-2.5 text-right font-medium">{m.alerts_table_actions()}</th>
								</tr>
							</thead>
							<tbody>
								{#each filteredRules as rule (rule.id)}
									<tr
										class={cn(
											'border-t border-[var(--color-border)] transition',
											!rule.enabled && 'opacity-50'
										)}
									>
										<td class="px-3 py-2.5">
											<div class="flex flex-col">
												<div class="flex items-center gap-2">
													<span class="font-medium text-[var(--color-fg)]">{rule.name}</span>
													{#if isSilenced(rule)}
														<span
															class="inline-flex items-center gap-1 rounded-full bg-[var(--color-fg-subtle)]/15 px-2 py-0.5 font-mono text-[10px] tracking-wide text-[var(--color-fg-muted)]"
															title={m.alerts_silenced_until({
																time: new Date((rule.silenced_until ?? 0) * 1000).toLocaleString()
															})}
														>
															<IconBellOff class="size-[10px]" stroke-width="2.25" />
															{m.alerts_silenced_for({
																duration: fmtDuration((rule.silenced_until ?? 0) - now)
															})}
														</span>
													{/if}
												</div>
												{#if rule.description}
													<span class="text-[12px] text-[var(--color-fg-muted)]"
														>{rule.description}</span
													>
												{/if}
											</div>
										</td>
										<td class="px-3 py-2.5">
											<div class="flex flex-col gap-0.5">
												<span class="text-[13px] text-[var(--color-fg)]">
													{describeExpression(rule.expression, schema)}
												</span>
												<code class="font-mono text-[10px] text-[var(--color-fg-subtle)]"
													>{rule.expression}</code
												>
											</div>
										</td>
										<td class="px-3 py-2.5">{@render severityBadge(rule.severity)}</td>
										<td class="px-3 py-2.5 font-mono text-xs text-[var(--color-fg-muted)]"
											>{rule.for_duration_secs}s</td
										>
										<td class="px-3 py-2.5 font-mono text-xs text-[var(--color-fg-muted)]"
											>{rule.cooldown_secs}s</td
										>
										<td class="px-3 py-2.5">
											<div class="flex items-center justify-end gap-2">
												<button
													type="button"
													onclick={() => toggleEnabled(rule)}
													disabled={acting !== null}
													title={rule.enabled
														? m.alerts_action_disable()
														: m.alerts_action_enable()}
													class={cn(
														'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50',
														rule.enabled ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-border)]'
													)}
												>
													<span
														class={cn(
															'pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out',
															rule.enabled ? 'translate-x-4' : 'translate-x-0'
														)}
													></span>
												</button>
												<button
													type="button"
													onclick={() => openEdit(rule)}
													title={m.alerts_action_edit()}
													class="grid h-8 w-8 place-items-center rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-fg-muted)] transition hover:border-[var(--color-border-strong)] hover:text-[var(--color-fg)]"
												>
													<IconPencil class="size-[13px]" stroke-width="2" />
												</button>
												{#if isSilenced(rule)}
													<button
														type="button"
														onclick={() => unsilenceRule(rule)}
														disabled={acting === `unsilence:${rule.id}`}
														title={m.alerts_action_unsilence()}
														class="grid h-8 w-8 place-items-center rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-fg-muted)] transition hover:border-[var(--color-border-strong)] hover:text-[var(--color-fg)] disabled:cursor-not-allowed disabled:opacity-30"
													>
														{#if acting === `unsilence:${rule.id}`}
															<span
																class="h-3 w-3 animate-spin rounded-full border-2 border-current border-r-transparent"
															></span>
														{:else}
															<IconBell class="size-[13px]" stroke-width="2" />
														{/if}
													</button>
												{:else}
													<button
														type="button"
														onclick={() => openSilence(rule)}
														title={m.alerts_action_silence()}
														class="grid h-8 w-8 place-items-center rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-fg-muted)] transition hover:border-[var(--color-border-strong)] hover:text-[var(--color-fg)]"
													>
														<IconBellOff class="size-[13px]" stroke-width="2" />
													</button>
												{/if}
												<button
													type="button"
													onclick={() => deleteRule(rule)}
													disabled={acting === `delete:${rule.id}`}
													title={m.alerts_action_delete()}
													class="grid h-8 w-8 place-items-center rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-fg-muted)] transition hover:border-[var(--color-danger)]/50 hover:text-[var(--color-danger)] disabled:cursor-not-allowed disabled:opacity-30"
												>
													{#if acting === `delete:${rule.id}`}
														<span
															class="h-3 w-3 animate-spin rounded-full border-2 border-current border-r-transparent"
														></span>
													{:else}
														<IconTrash class="size-[13px]" stroke-width="2" />
													{/if}
												</button>
											</div>
										</td>
									</tr>
								{/each}
								{#if filteredRules.length === 0}
									<tr>
										<td
											colspan="6"
											class="px-3 py-10 text-center text-sm text-[var(--color-fg-subtle)]"
										>
											{rules.length === 0 ? m.alerts_empty_rules() : m.alerts_empty_rules_filter()}
										</td>
									</tr>
								{/if}
							</tbody>
						</table>
					</div>
				</Card>
			{:else if tab === 'active'}
				{#if activeStates.length === 0}
					<Card padding="lg" class="text-center">
						<div
							class="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-[var(--color-success)]/10"
						>
							<IconCheck class="size-5 text-[var(--color-success)]" stroke-width="2" />
						</div>
						<p class="font-medium">{m.alerts_empty_active_title()}</p>
						<p class="mt-1 text-sm text-[var(--color-fg-muted)]">{m.alerts_empty_active_body()}</p>
					</Card>
				{:else}
					<Card padding="none" class="overflow-hidden">
						<div class="max-h-[calc(100vh-22rem)] overflow-auto">
							<table class="w-full text-sm">
								<thead
									class="sticky top-0 z-10 bg-[var(--color-surface-2)] text-xs tracking-wide text-[var(--color-fg-muted)]"
								>
									<tr>
										<th class="px-3 py-2.5 text-left font-medium">{m.alerts_table_rule()}</th>
										<th class="px-3 py-2.5 text-left font-medium">{m.alerts_table_state()}</th>
										<th class="px-3 py-2.5 text-left font-medium">{m.alerts_table_severity()}</th>
										<th class="px-3 py-2.5 text-left font-medium">{m.alerts_table_labels()}</th>
										<th class="px-3 py-2.5 text-right font-medium">{m.alerts_table_last_value()}</th
										>
										<th class="px-3 py-2.5 text-right font-medium">{m.alerts_table_since()}</th>
									</tr>
								</thead>
								<tbody>
									{#each activeStates as s (s.rule_id + s.label_set)}
										<tr class="border-t border-[var(--color-border)]">
											<td class="px-3 py-2.5 font-medium">{s.rule_name}</td>
											<td class="px-3 py-2.5">{@render stateBadge(s.state)}</td>
											<td class="px-3 py-2.5">{@render severityBadge(s.severity)}</td>
											<td class="px-3 py-2.5">
												{#if s.label_set === '{}'}
													<span class="text-[var(--color-fg-subtle)]">—</span>
												{:else}
													<code
														class="rounded bg-[var(--color-surface-2)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--color-fg-muted)]"
														>{s.label_set}</code
													>
												{/if}
											</td>
											<td class="px-3 py-2.5 text-right font-mono text-xs">
												{s.last_value != null ? s.last_value.toFixed(2) : '—'}
											</td>
											<td class="px-3 py-2.5 text-right text-xs text-[var(--color-fg-muted)]">
												{fmtRelative(s.state_since)}
											</td>
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
					</Card>
				{/if}
			{:else if tab === 'events'}
				<Card padding="none" class="overflow-hidden">
					<div class="max-h-[calc(100vh-22rem)] overflow-auto">
						<table class="w-full text-sm">
							<thead
								class="sticky top-0 z-10 bg-[var(--color-surface-2)] text-xs tracking-wide text-[var(--color-fg-muted)]"
							>
								<tr>
									<th class="px-3 py-2.5 text-left font-medium">{m.alerts_table_time()}</th>
									<th class="px-3 py-2.5 text-left font-medium">{m.alerts_table_rule()}</th>
									<th class="px-3 py-2.5 text-left font-medium">{m.alerts_table_severity()}</th>
									<th class="px-3 py-2.5 text-left font-medium">{m.alerts_table_labels()}</th>
									<th class="px-3 py-2.5 text-right font-medium">{m.alerts_table_value()}</th>
									<th class="px-3 py-2.5 text-left font-medium">{m.alerts_table_status()}</th>
									<th class="px-3 py-2.5 text-right font-medium">{m.alerts_table_notified()}</th>
								</tr>
							</thead>
							<tbody>
								{#each episodes as ep (ep.fired.id)}
									{@const rule = rulesById.get(ep.fired.rule_id)}
									{@const duration = ep.resolved
										? ep.resolved.occurred_at - ep.fired.occurred_at
										: null}
									<tr class="border-t border-[var(--color-border)]">
										<td class="px-3 py-2.5 text-xs text-[var(--color-fg-muted)]">
											{fmtRelative(ep.fired.occurred_at)}
										</td>
										<td class="px-3 py-2.5">
											{#if rule}
												<span class="font-medium text-[var(--color-fg)]">{rule.name}</span>
											{:else}
												<span class="font-mono text-xs text-[var(--color-fg-subtle)]"
													>#{ep.fired.rule_id}</span
												>
											{/if}
										</td>
										<td class="px-3 py-2.5">{@render severityBadge(ep.fired.severity)}</td>
										<td class="px-3 py-2.5">
											{#if ep.fired.label_set === '{}'}
												<span class="text-[var(--color-fg-subtle)]">—</span>
											{:else}
												<code
													class="rounded bg-[var(--color-surface-2)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--color-fg-muted)]"
													>{ep.fired.label_set}</code
												>
											{/if}
										</td>
										<td class="px-3 py-2.5 text-right font-mono text-xs">
											{ep.fired.metric_value != null ? ep.fired.metric_value.toFixed(2) : '—'}
										</td>
										<td class="px-3 py-2.5">
											{#if ep.resolved}
												<span
													class="inline-flex items-center gap-1.5 text-xs text-[var(--color-success)]"
												>
													<IconCircleCheck class="size-[13px]" stroke-width="2" />
													<span>{m.alerts_event_status_resolved()}</span>
												</span>
												{#if duration !== null}
													<span class="ml-1 text-[10px] text-[var(--color-fg-subtle)]"
														>{m.alerts_event_resolved_in({ duration: fmtDuration(duration) })}</span
													>
												{/if}
											{:else}
												<span
													class="inline-flex items-center gap-1.5 text-xs text-[var(--color-danger)]"
												>
													<IconFlame class="size-[13px]" stroke-width="2" />
													<span>{m.alerts_event_status_ongoing()}</span>
												</span>
											{/if}
										</td>
										<td class="px-3 py-2.5 text-right">
											{#if ep.fired.notified || ep.resolved?.notified}
												<span class="text-[var(--color-success)]">✓</span>
											{:else}
												<span class="text-[var(--color-fg-subtle)]">—</span>
											{/if}
										</td>
									</tr>
								{/each}
								{#if episodes.length === 0}
									<tr>
										<td
											colspan="7"
											class="px-3 py-10 text-center text-sm text-[var(--color-fg-subtle)]"
											>{m.alerts_empty_events()}</td
										>
									</tr>
								{/if}
							</tbody>
						</table>
					</div>
					{#if eventsHasMore}
						<div class="border-t border-[var(--color-border)] px-4 py-3 text-center">
							<Button
								variant="ghost"
								size="sm"
								onclick={loadMoreEvents}
								loading={eventsLoadingMore}
							>
								{m.alerts_events_load_more()}
							</Button>
						</div>
					{/if}
				</Card>
			{/if}
		{/if}
	</div>
{/if}

<Modal
	open={showForm}
	onClose={() => (showForm = false)}
	title={editTarget ? m.alerts_modal_title_edit() : m.alerts_modal_title_new()}
	width="lg"
>
	{#if conn}
		<AlertRuleEditor
			initial={editTarget}
			{conn}
			bind:name={formName}
			bind:description={formDescription}
			bind:expression={formExpression}
			bind:severity={formSeverity}
			bind:enabled={formEnabled}
			bind:for_duration_secs={formForDuration}
			bind:eval_interval_secs={formEvalInterval}
			bind:cooldown_secs={formCooldown}
		/>
	{/if}

	{#snippet footer()}
		<div class="flex justify-end gap-2">
			<Button variant="secondary" onclick={() => (showForm = false)}>{m.common_cancel()}</Button>
			<Button onclick={submitForm} loading={formBusy}>
				{editTarget ? m.alerts_action_save_changes() : m.alerts_action_create_rule()}
			</Button>
		</div>
	{/snippet}
</Modal>

<Modal
	open={silenceTarget !== null}
	onClose={closeSilence}
	title={silenceTarget ? m.alerts_silence_modal_title({ name: silenceTarget.name }) : ''}
	width="sm"
>
	<p class="mb-4 text-sm text-[var(--color-fg-muted)]">{m.alerts_silence_modal_description()}</p>
	<div class="flex flex-wrap gap-2">
		{#each SILENCE_PRESETS as preset (preset.secs)}
			<Button
				variant="secondary"
				size="sm"
				onclick={() => applySilence(preset.secs)}
				disabled={silenceBusy}
			>
				{preset.label()}
			</Button>
		{/each}
	</div>
	{#snippet footer()}
		<div class="flex justify-end">
			<Button variant="ghost" onclick={closeSilence} disabled={silenceBusy}>
				{m.common_cancel()}
			</Button>
		</div>
	{/snippet}
</Modal>
