<script lang="ts">
	import { useServer } from '$lib/server-scope';
	import { tabParam } from '$lib/utils/tab';
	import Button from '$lib/components/ui/Button.svelte';
	import DataTable from '$lib/components/ui/DataTable.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import IconButton from '$lib/components/ui/IconButton.svelte';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import Switch from '$lib/components/ui/Switch.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Modal from '$lib/components/ui/Modal.svelte';
	import Tabs from '$lib/components/layout/Tabs.svelte';
	import AlertRuleEditor from '$lib/components/alerts/AlertRuleEditor.svelte';
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

	let { conn } = $derived(useServer());

	const tabs = tabParam(['rules', 'active', 'events'] as const, 'rules');
	let tab = $derived(tabs.current);

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
			// Falls back to the name so two deleted rules do not both key on
			// `null` and have their episodes paired into each other.
			const key = `${ev.rule_id ?? ev.rule_name}:${ev.label_set}`;
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
		if (!conn.isAuthenticated) return;
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
		if (!conn.isAuthenticated || eventsLoadingMore) return;
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
		if (conn.isAuthenticated) fetchAll();
	});

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
		if (!conn.isAuthenticated) return;
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
			await conn.client.updateAlertRule(rule.id, { enabled: !rule.enabled });
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
			await conn.client.silenceAlertRule(rule.id, { duration_secs: durationSecs });
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
			await conn.client.unsilenceAlertRule(rule.id);
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
			await conn.client.deleteAlertRule(rule.id);
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

{#snippet ruleActions(rule: AlertRuleDto)}
	<Switch
		checked={rule.enabled}
		onchange={() => toggleEnabled(rule)}
		disabled={acting !== null}
		label={rule.enabled ? m.alerts_action_disable() : m.alerts_action_enable()}
	/>
	<IconButton label={m.alerts_action_edit()} onclick={() => openEdit(rule)}>
		<IconPencil class="size-[13px]" stroke-width="2" />
	</IconButton>
	{#if isSilenced(rule)}
		<IconButton
			label={m.alerts_action_unsilence()}
			onclick={() => unsilenceRule(rule)}
			loading={acting === `unsilence:${rule.id}`}
		>
			<IconBell class="size-[13px]" stroke-width="2" />
		</IconButton>
	{:else}
		<IconButton label={m.alerts_action_silence()} onclick={() => openSilence(rule)}>
			<IconBellOff class="size-[13px]" stroke-width="2" />
		</IconButton>
	{/if}
	<IconButton
		tone="danger"
		label={m.alerts_action_delete()}
		onclick={() => deleteRule(rule)}
		loading={acting === `delete:${rule.id}`}
	>
		<IconTrash class="size-[13px]" stroke-width="2" />
	</IconButton>
{/snippet}

{#snippet severityBadge(sev: AlertSeverity)}
	<span
		class={cn(
			'text-3xs inline-flex items-center rounded-full px-2 py-0.5 font-mono font-medium tracking-wide',
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
			'text-3xs inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono font-medium tracking-wide',
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

{#snippet silencedPill(rule: AlertRuleDto)}
	<span
		class="text-3xs inline-flex items-center gap-1 rounded-full bg-[var(--color-fg-subtle)]/15 px-2 py-0.5 font-mono tracking-wide text-[var(--color-fg-muted)]"
		title={m.alerts_silenced_until({
			time: new Date((rule.silenced_until ?? 0) * 1000).toLocaleString()
		})}
	>
		<IconBellOff class="size-[10px]" stroke-width="2.25" />
		{m.alerts_silenced_for({ duration: fmtDuration((rule.silenced_until ?? 0) - now) })}
	</span>
{/snippet}

{#snippet labelSet(labels: string)}
	{#if labels === '{}'}
		<span class="text-[var(--color-fg-subtle)]">—</span>
	{:else}
		<code
			class="text-3xs rounded bg-[var(--color-surface-2)] px-1.5 py-0.5 font-mono break-all text-[var(--color-fg-muted)]"
		>
			{labels}
		</code>
	{/if}
{/snippet}

{#snippet loadMore()}
	<Button variant="ghost" size="sm" onclick={loadMoreEvents} loading={eventsLoadingMore}>
		{m.alerts_events_load_more()}
	</Button>
{/snippet}

<div class="px-4 py-6 md:px-8 md:py-8">
	<PageHeader title={m.alerts_page_title()} subtitle={m.alerts_page_subtitle()}>
		<Button variant="secondary" size="sm" onclick={fetchAll} loading={busy}>
			{m.alerts_action_refresh()}
		</Button>
		<Button size="sm" onclick={openCreate}>{m.alerts_action_new_rule()}</Button>
	</PageHeader>

	<div class="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
		<Tabs tabs={tabsConfig} value={tab} onSelect={tabs.set} />
		{#if tab === 'rules'}
			<Input
				placeholder={m.alerts_filter_rules_placeholder()}
				bind:value={q}
				class="w-full sm:w-64"
			/>
		{/if}
	</div>

	{#if tab === 'rules'}
		<DataTable
			empty={filteredRules.length === 0
				? rules.length === 0
					? m.alerts_empty_rules()
					: m.alerts_empty_rules_filter()
				: undefined}
		>
			{#snippet head()}
				<th>{m.alerts_table_name()}</th>
				<th>{m.alerts_table_expression()}</th>
				<th>{m.alerts_table_severity()}</th>
				<th>{m.alerts_table_for()}</th>
				<th>{m.alerts_table_cooldown()}</th>
				<th class="text-right">{m.alerts_table_actions()}</th>
			{/snippet}
			{#each filteredRules as rule (rule.id)}
				<tr class={cn(!rule.enabled && 'muted')}>
					<td>
						<div class="flex flex-col">
							<div class="flex flex-wrap items-center gap-2">
								<span class="font-medium break-words text-[var(--color-fg)]">{rule.name}</span>
								{#if isSilenced(rule)}{@render silencedPill(rule)}{/if}
							</div>
							{#if rule.description}
								<span class="text-xs text-[var(--color-fg-muted)]">{rule.description}</span>
							{/if}
						</div>
					</td>
					<!-- md:max-w-0: a rule expression is arbitrary-length text, and in
							     auto table layout its max-content would set the column width. -->
					<td class="md:w-full md:max-w-0">
						<div class="flex flex-col gap-0.5" title={rule.expression}>
							<span class="text-md break-words text-[var(--color-fg)] md:truncate">
								{describeExpression(rule.expression, schema)}
							</span>
							<code class="text-3xs font-mono break-all text-[var(--color-fg-subtle)] md:truncate">
								{rule.expression}
							</code>
						</div>
					</td>
					<td data-label={m.alerts_table_severity()}>{@render severityBadge(rule.severity)}</td>
					<td
						data-label={m.alerts_table_for()}
						class="font-mono text-xs text-[var(--color-fg-muted)]"
					>
						{rule.for_duration_secs}s
					</td>
					<td
						data-label={m.alerts_table_cooldown()}
						class="font-mono text-xs text-[var(--color-fg-muted)]"
					>
						{rule.cooldown_secs}s
					</td>
					<td class="actions">
						<div class="flex items-center gap-2 md:justify-end">
							{@render ruleActions(rule)}
						</div>
					</td>
				</tr>
			{/each}
		</DataTable>
	{:else if tab === 'active'}
		{#if activeStates.length === 0}
			<EmptyState
				icon={IconCheck}
				tone="success"
				title={m.alerts_empty_active_title()}
				description={m.alerts_empty_active_body()}
			/>
		{:else}
			<DataTable>
				{#snippet head()}
					<th>{m.alerts_table_rule()}</th>
					<th>{m.alerts_table_state()}</th>
					<th>{m.alerts_table_severity()}</th>
					<th>{m.alerts_table_labels()}</th>
					<th class="text-right">{m.alerts_table_last_value()}</th>
					<th class="text-right">{m.alerts_table_since()}</th>
				{/snippet}
				{#each activeStates as s (s.rule_id + s.label_set)}
					<tr>
						<td class="font-medium break-words">{s.rule_name}</td>
						<td data-label={m.alerts_table_state()}>{@render stateBadge(s.state)}</td>
						<td data-label={m.alerts_table_severity()}>{@render severityBadge(s.severity)}</td>
						<td data-label={m.alerts_table_labels()}>{@render labelSet(s.label_set)}</td>
						<td data-label={m.alerts_table_last_value()} class="font-mono text-xs md:text-right">
							{s.last_value != null ? s.last_value.toFixed(2) : '—'}
						</td>
						<td
							data-label={m.alerts_table_since()}
							class="text-xs text-[var(--color-fg-muted)] md:text-right"
						>
							{fmtRelative(s.state_since)}
						</td>
					</tr>
				{/each}
			</DataTable>
		{/if}
	{:else if tab === 'events'}
		<DataTable
			empty={episodes.length === 0 ? m.alerts_empty_events() : undefined}
			footer={eventsHasMore ? loadMore : undefined}
		>
			{#snippet head()}
				<th>{m.alerts_table_time()}</th>
				<th>{m.alerts_table_rule()}</th>
				<th>{m.alerts_table_severity()}</th>
				<th>{m.alerts_table_labels()}</th>
				<th class="text-right">{m.alerts_table_value()}</th>
				<th>{m.alerts_table_status()}</th>
				<th class="text-right">{m.alerts_table_notified()}</th>
			{/snippet}
			{#each episodes as ep (ep.fired.id)}
				{@const rule = ep.fired.rule_id === null ? undefined : rulesById.get(ep.fired.rule_id)}
				{@const duration = ep.resolved ? ep.resolved.occurred_at - ep.fired.occurred_at : null}
				<tr>
					<td data-label={m.alerts_table_time()} class="text-xs text-[var(--color-fg-muted)]">
						{fmtRelative(ep.fired.occurred_at)}
					</td>
					<td class="break-words">
						{#if rule}
							<span class="font-medium text-[var(--color-fg)]">{rule.name}</span>
						{:else}
							<span class="text-[var(--color-fg-muted)]">{ep.fired.rule_name}</span>
						{/if}
					</td>
					<td data-label={m.alerts_table_severity()}>
						{@render severityBadge(ep.fired.severity)}
					</td>
					<td data-label={m.alerts_table_labels()}>{@render labelSet(ep.fired.label_set)}</td>
					<td data-label={m.alerts_table_value()} class="font-mono text-xs md:text-right">
						{ep.fired.metric_value != null ? ep.fired.metric_value.toFixed(2) : '—'}
					</td>
					<td data-label={m.alerts_table_status()}>
						{#if ep.resolved}
							<span class="inline-flex items-center gap-1.5 text-xs text-[var(--color-success)]">
								<IconCircleCheck class="size-[13px]" stroke-width="2" />
								<span>{m.alerts_event_status_resolved()}</span>
								{#if duration !== null}
									<span class="text-3xs text-[var(--color-fg-subtle)]">
										{m.alerts_event_resolved_in({ duration: fmtDuration(duration) })}
									</span>
								{/if}
							</span>
						{:else}
							<span class="inline-flex items-center gap-1.5 text-xs text-[var(--color-danger)]">
								<IconFlame class="size-[13px]" stroke-width="2" />
								<span>{m.alerts_event_status_ongoing()}</span>
							</span>
						{/if}
					</td>
					<td data-label={m.alerts_table_notified()} class="md:text-right">
						{#if ep.fired.notified || ep.resolved?.notified}
							<span class="text-[var(--color-success)]">✓</span>
						{:else}
							<span class="text-[var(--color-fg-subtle)]">—</span>
						{/if}
					</td>
				</tr>
			{/each}
		</DataTable>
	{/if}
</div>

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
