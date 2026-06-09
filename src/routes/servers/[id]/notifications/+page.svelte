<script lang="ts">
	import { untrack } from 'svelte';
	import type { Component } from 'svelte';
	import { page } from '$app/state';
	import { m } from '$lib/paraglide/messages';
	import Card from '$lib/components/ui/Card.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Modal from '$lib/components/ui/Modal.svelte';
	import Banner from '$lib/components/ui/Banner.svelte';
	import Field from '$lib/components/ui/Field.svelte';
	import { profiles } from '$lib/stores/profiles.svelte';
	import IconBell from '~icons/lucide/bell';
	import IconPencil from '~icons/lucide/pencil';
	import IconTrash from '~icons/lucide/trash-2';
	import IconSmartphone from '~icons/lucide/smartphone';
	import IconSend from '~icons/lucide/send';
	import IconRadio from '~icons/lucide/radio';
	import IconWebhook from '~icons/lucide/webhook';
	import IconBellRing from '~icons/lucide/bell-ring';
	import { connections } from '$lib/stores/connections.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { confirm } from '$lib/stores/confirm.svelte';
	import { ApiError } from '$lib/api/error';
	import { fmtRelative } from '$lib/utils/format';
	import { cn } from '$lib/utils/cn';
	import type {
		NotificationChannelResponse,
		NotificationChannelType,
		NotificationMinSeverity,
		CreateChannelRequest
	} from '$lib/types/api';

	let id = $derived(page.params.id ?? '');
	let profile = $derived(id ? profiles.byId(id) : undefined);
	let conn = $derived(profile ? connections.connect(profile) : null);

	$effect(() => {
		if (!conn) return;
		untrack(() => {
			conn.ensureSignedIn().catch((e) => {
				if (e instanceof ApiError)
					toast.error(m.notifications_toast_signin_failed(), { description: e.userMessage });
			});
		});
	});

	interface TestResult {
		ok: boolean;
		message: string;
		ts: number;
	}

	let channels = $state<NotificationChannelResponse[]>([]);
	let busy = $state(false);
	let testing = $state<number | null>(null);
	let acting = $state<string | null>(null);
	let testResults = $state(new Map<number, TestResult>());

	async function fetchAll() {
		if (!conn?.isAuthenticated) return;
		busy = true;
		try {
			const res = await conn.client.listChannels();
			channels = res.channels;
		} catch (e) {
			if (e instanceof ApiError)
				toast.error(m.notifications_toast_load_failed(), { description: e.userMessage });
		} finally {
			busy = false;
		}
	}

	$effect(() => {
		if (conn?.isAuthenticated) fetchAll();
	});

	async function testChannel(ch: NotificationChannelResponse) {
		testing = ch.id;
		try {
			const res = await conn!.client.testChannel(ch.id);
			toast.success(m.notifications_toast_test_sent({ count: res.delivered }));
			testResults = new Map(testResults).set(ch.id, {
				ok: true,
				message: m.notifications_test_result_ok({ count: res.delivered }),
				ts: Math.floor(Date.now() / 1000)
			});
		} catch (e) {
			const msg = e instanceof ApiError ? e.userMessage : String(e);
			toast.error(m.notifications_toast_test_failed(), { description: msg });
			testResults = new Map(testResults).set(ch.id, {
				ok: false,
				message: msg,
				ts: Math.floor(Date.now() / 1000)
			});
		} finally {
			testing = null;
		}
	}

	async function toggleEnabled(ch: NotificationChannelResponse) {
		acting = `toggle:${ch.id}`;
		try {
			await conn!.client.updateChannel(ch.id, {
				name: ch.name,
				enabled: !ch.enabled,
				config: ch.config,
				min_severity: ch.min_severity
			});
			fetchAll();
		} catch (e) {
			if (e instanceof ApiError)
				toast.error(m.notifications_toast_update_failed(), { description: e.userMessage });
		} finally {
			acting = null;
		}
	}

	async function deleteChannel(ch: NotificationChannelResponse) {
		const ok = await confirm({
			title: m.notifications_confirm_delete_title({ name: ch.name }),
			description: m.notifications_confirm_delete_description(),
			confirmLabel: m.notifications_action_delete(),
			variant: 'danger'
		});
		if (!ok) return;
		acting = `delete:${ch.id}`;
		try {
			await conn!.client.deleteChannel(ch.id);
			toast.success(m.notifications_toast_deleted({ name: ch.name }));
			fetchAll();
		} catch (e) {
			if (e instanceof ApiError)
				toast.error(m.notifications_toast_delete_failed(), { description: e.userMessage });
		} finally {
			acting = null;
		}
	}

	let showForm = $state(false);
	let editTarget = $state<NotificationChannelResponse | null>(null);

	let formName = $state('');
	let formType = $state<NotificationChannelType>('telegram');
	let formEnabled = $state(true);
	let formMinSeverity = $state<NotificationMinSeverity | ''>('');
	let formBusy = $state(false);

	let cfgChatId = $state('');
	let cfgNtfyServer = $state('https://ntfy.sh');
	let cfgNtfyTopic = $state('');
	let cfgWebhookUrl = $state('');

	function openCreate() {
		editTarget = null;
		formName = '';
		formType = 'telegram';
		formEnabled = true;
		formMinSeverity = '';
		cfgChatId = '';
		cfgNtfyServer = 'https://ntfy.sh';
		cfgNtfyTopic = '';
		cfgWebhookUrl = '';
		showForm = true;
	}

	function openEdit(ch: NotificationChannelResponse) {
		editTarget = ch;
		formName = ch.name;
		formType = ch.type;
		formEnabled = ch.enabled;
		formMinSeverity = ch.min_severity ?? '';
		const cfg = ch.config ?? {};
		cfgChatId = (cfg.chat_id as string) ?? '';
		cfgNtfyServer = (cfg.server as string) ?? 'https://ntfy.sh';
		cfgNtfyTopic = (cfg.topic as string) ?? '';
		cfgWebhookUrl = (cfg.url as string) ?? '';
		showForm = true;
	}

	function buildConfig(): Record<string, unknown> {
		switch (formType) {
			case 'telegram':
				return { chat_id: cfgChatId.trim() };
			case 'ntfy':
				return { server: cfgNtfyServer.trim(), topic: cfgNtfyTopic.trim() };
			case 'webhook':
				return { url: cfgWebhookUrl.trim() };
			case 'fcm':
				return {};
			case 'web-push':
				return {};
		}
	}

	async function submitForm() {
		if (!conn?.isAuthenticated) return;
		formBusy = true;
		try {
			const req: CreateChannelRequest = {
				name: formName.trim(),
				type: formType,
				enabled: formEnabled,
				config: buildConfig(),
				min_severity: formMinSeverity || null
			};
			if (editTarget) {
				await conn.client.updateChannel(editTarget.id, {
					name: req.name,
					enabled: formEnabled,
					config: req.config,
					min_severity: req.min_severity
				});
				toast.success(m.notifications_toast_channel_updated());
			} else {
				await conn.client.createChannel(req);
				toast.success(m.notifications_toast_channel_created());
			}
			showForm = false;
			fetchAll();
		} catch (e) {
			if (e instanceof ApiError)
				toast.error(m.notifications_toast_save_failed(), { description: e.userMessage });
		} finally {
			formBusy = false;
		}
	}

	const TYPE_LABELS: Record<NotificationChannelType, () => string> = {
		fcm: () => m.notifications_type_label_fcm(),
		telegram: () => 'Telegram',
		ntfy: () => 'ntfy',
		webhook: () => 'Webhook',
		'web-push': () => m.notifications_type_label_web_push()
	};

	const TYPE_ICONS: Record<NotificationChannelType, Component> = {
		fcm: IconSmartphone,
		telegram: IconSend,
		ntfy: IconRadio,
		webhook: IconWebhook,
		'web-push': IconBellRing
	};
</script>

{#snippet typePill(type: NotificationChannelType)}
	{@const Icon = TYPE_ICONS[type]}
	<span
		class="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-surface-2)] px-2.5 py-0.5 font-mono text-[10px] text-[var(--color-fg-muted)]"
	>
		<Icon class="size-[10px]" stroke-width="2" />
		{TYPE_LABELS[type]()}
	</span>
{/snippet}

{#if profile}
	<div class="px-4 py-6 md:px-8 md:py-8">
		<header class="mb-6 flex items-end justify-between gap-4">
			<div>
				<h1 class="text-[24px] font-semibold tracking-tight">{m.notifications_page_title()}</h1>
				<p class="mt-1.5 text-sm text-[var(--color-fg-muted)]">
					{m.notifications_page_subtitle()}
				</p>
			</div>
			<div class="flex items-center gap-2">
				<Button variant="secondary" size="sm" onclick={fetchAll} loading={busy}
					>{m.notifications_action_refresh()}</Button
				>
				<Button size="sm" onclick={openCreate}>{m.notifications_action_add_channel()}</Button>
			</div>
		</header>

		{#if !conn?.isAuthenticated}
			<Banner variant="warning" title={m.notifications_banner_not_signed_in_title()}
				>{m.notifications_banner_not_signed_in_body()}</Banner
			>
		{:else if channels.length === 0 && !busy}
			<Card padding="lg" class="text-center">
				<div
					class="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-[var(--color-accent)]/10"
				>
					<IconBell class="size-5 text-[var(--color-accent)]" stroke-width="2" />
				</div>
				<p class="font-medium">{m.notifications_empty_title()}</p>
				<p class="mt-1 text-sm text-[var(--color-fg-muted)]">
					{m.notifications_empty_body()}
				</p>
				<div class="mt-4">
					<Button onclick={openCreate}>{m.notifications_action_add_channel()}</Button>
				</div>
			</Card>
		{:else}
			<div class="flex flex-col gap-3">
				{#each channels as ch (ch.id)}
					<Card
						padding="none"
						class={cn('overflow-hidden transition', !ch.enabled && 'opacity-60')}
					>
						<div class="flex items-center gap-4 px-4 py-3">
							<div class="flex flex-1 flex-col gap-1 min-w-0">
								<div class="flex items-center gap-2">
									<span class="font-medium truncate">{ch.name}</span>
									{@render typePill(ch.type)}
									{#if ch.min_severity}
										<span
											class={cn(
												'rounded-full px-2 py-0.5 font-mono text-[10px] tracking-wide',
												ch.min_severity === 'crit'
													? 'bg-[var(--color-danger)]/10 text-[var(--color-danger)]'
													: 'bg-[var(--color-warning)]/10 text-[var(--color-warning)]'
											)}>{m.notifications_min_severity_pill({ severity: ch.min_severity })}</span
										>
									{/if}
								</div>
								<p class="font-mono text-[11px] text-[var(--color-fg-subtle)]">
									{#if ch.type === 'telegram'}
										chat_id: {(ch.config.chat_id as string) || '—'}
									{:else if ch.type === 'ntfy'}
										{(ch.config.server as string) || 'https://ntfy.sh'} / {(ch.config
											.topic as string) || '—'}
									{:else if ch.type === 'webhook'}
										{(ch.config.url as string) || '—'}
									{:else if ch.type === 'fcm'}
										{m.notifications_target_fcm()}
									{:else if ch.type === 'web-push'}
										{m.notifications_target_web_push()}
									{/if}
									<span class="ml-2 text-[var(--color-fg-faint)]"
										>{m.notifications_updated_suffix({ when: fmtRelative(ch.updated_at) })}</span
									>
								</p>
								{#if testResults.get(ch.id)}
									{@const tr = testResults.get(ch.id)!}
									<p
										class={cn(
											'mt-1 text-[11px]',
											tr.ok ? 'text-[var(--color-success)]' : 'text-[var(--color-danger)]'
										)}
									>
										{tr.ok ? '✓' : '✗'}
										{tr.message}
										<span class="ml-1 text-[var(--color-fg-faint)]">{fmtRelative(tr.ts)}</span>
									</p>
								{/if}
							</div>

							<div class="flex shrink-0 items-center gap-2">
								<button
									type="button"
									onclick={() => toggleEnabled(ch)}
									disabled={acting !== null}
									title={ch.enabled
										? m.notifications_action_disable()
										: m.notifications_action_enable()}
									class={cn(
										'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50',
										ch.enabled ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-border)]'
									)}
								>
									<span
										class={cn(
											'pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out',
											ch.enabled ? 'translate-x-4' : 'translate-x-0'
										)}
									></span>
								</button>

								<Button
									variant="secondary"
									size="sm"
									loading={testing === ch.id}
									onclick={() => testChannel(ch)}
									disabled={!ch.enabled || testing !== null}>{m.notifications_action_test()}</Button
								>

								<button
									type="button"
									onclick={() => openEdit(ch)}
									title={m.notifications_action_edit()}
									class="grid h-8 w-8 place-items-center rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-fg-muted)] transition hover:border-[var(--color-border-strong)] hover:text-[var(--color-fg)]"
								>
									<IconPencil class="size-[13px]" stroke-width="2" />
								</button>

								<button
									type="button"
									onclick={() => deleteChannel(ch)}
									disabled={acting === `delete:${ch.id}`}
									title={m.notifications_action_delete()}
									class="grid h-8 w-8 place-items-center rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-fg-muted)] transition hover:border-[var(--color-danger)]/50 hover:text-[var(--color-danger)] disabled:cursor-not-allowed disabled:opacity-30"
								>
									{#if acting === `delete:${ch.id}`}
										<span
											class="h-3 w-3 animate-spin rounded-full border-2 border-current border-r-transparent"
										></span>
									{:else}
										<IconTrash class="size-[13px]" stroke-width="2" />
									{/if}
								</button>
							</div>
						</div>
					</Card>
				{/each}
			</div>
		{/if}
	</div>
{/if}

<Modal
	open={showForm}
	onClose={() => (showForm = false)}
	title={editTarget ? m.notifications_modal_edit_title() : m.notifications_modal_create_title()}
	width="md"
>
	<form
		onsubmit={(e) => {
			e.preventDefault();
			submitForm();
		}}
		class="flex flex-col gap-4"
	>
		<Field label={m.notifications_field_name()} required>
			<Input bind:value={formName} placeholder={m.notifications_field_name_placeholder()} />
		</Field>

		{#if !editTarget}
			<Field label={m.notifications_field_type()}>
				<select
					bind:value={formType}
					class="h-9 w-full rounded-[var(--radius-input)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-[13px] text-[var(--color-fg)] focus:border-[var(--color-accent)] focus:outline-none"
				>
					<option value="telegram">Telegram</option>
					<option value="ntfy">ntfy</option>
					<option value="webhook">Webhook</option>
					<option value="fcm">{m.notifications_type_option_fcm()}</option>
					<option value="web-push">{m.notifications_type_option_web_push()}</option>
				</select>
			</Field>
		{/if}

		{#if formType === 'telegram'}
			<Field label={m.notifications_field_chat_id()} required>
				<Input
					bind:value={cfgChatId}
					placeholder={m.notifications_field_chat_id_placeholder()}
					class="font-mono"
				/>
				<p class="mt-1 text-[12px] text-[var(--color-fg-muted)]">
					{m.notifications_hint_telegram_pre()}
					<code class="font-mono">api.telegram.org/bot&lt;token&gt;/getUpdates</code>.
					{m.notifications_hint_telegram_post()}
				</p>
			</Field>
		{:else if formType === 'ntfy'}
			<Field label={m.notifications_field_server_url()}>
				<Input bind:value={cfgNtfyServer} placeholder="https://ntfy.sh" class="font-mono" />
			</Field>
			<Field label={m.notifications_field_topic()} required>
				<Input bind:value={cfgNtfyTopic} placeholder="my-alerts" class="font-mono" />
				<p class="mt-1 text-[12px] text-[var(--color-fg-muted)]">
					{m.notifications_hint_ntfy_pre()}
					<code class="font-mono">notifications.ntfy.token</code>.
				</p>
			</Field>
		{:else if formType === 'webhook'}
			<Field label={m.notifications_field_url()} required>
				<Input
					bind:value={cfgWebhookUrl}
					placeholder="https://example.com/hook"
					class="font-mono"
				/>
				<p class="mt-1 text-[12px] text-[var(--color-fg-muted)]">
					{m.notifications_hint_webhook_pre()}
					<code class="font-mono">&#123; event, severity, title, body, timestamp &#125;</code>.
					{m.notifications_hint_webhook_mid()}
					<code class="font-mono">notifications.webhook.secret</code>.
				</p>
			</Field>
		{:else if formType === 'fcm'}
			<Banner variant="info" title={m.notifications_banner_no_config_title()}>
				{m.notifications_banner_fcm_body_pre()}
				<code class="font-mono text-[11px]">notifications.fcm.service_account_path</code>.
			</Banner>
		{:else if formType === 'web-push'}
			<Banner variant="info" title={m.notifications_banner_no_config_title()}>
				{m.notifications_banner_web_push_body()}
			</Banner>
		{/if}

		<div class="grid grid-cols-2 gap-4">
			<Field label={m.notifications_field_min_severity()}>
				<select
					bind:value={formMinSeverity}
					class="h-9 w-full rounded-[var(--radius-input)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-[13px] text-[var(--color-fg)] focus:border-[var(--color-accent)] focus:outline-none"
				>
					<option value="">{m.notifications_severity_all()}</option>
					<option value="warn">{m.notifications_severity_warn_and_above()}</option>
					<option value="crit">{m.notifications_severity_crit_only()}</option>
				</select>
			</Field>

			<Field label={m.notifications_field_enabled()}>
				<label class="flex h-9 cursor-pointer items-center gap-2 text-sm">
					<input type="checkbox" bind:checked={formEnabled} class="accent-[var(--color-accent)]" />
					{m.notifications_field_enabled_checkbox()}
				</label>
			</Field>
		</div>
	</form>

	{#snippet footer()}
		<div class="flex justify-end gap-2">
			<Button variant="secondary" onclick={() => (showForm = false)}>{m.common_cancel()}</Button>
			<Button onclick={submitForm} loading={formBusy}>
				{editTarget ? m.notifications_action_save_changes() : m.notifications_action_add_channel()}
			</Button>
		</div>
	{/snippet}
</Modal>
