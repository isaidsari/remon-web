<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import Button from '$lib/components/ui/Button.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import StatusDot from '$lib/components/layout/StatusDot.svelte';
	import { profiles } from '$lib/stores/profiles.svelte';
	import { connections } from '$lib/stores/connections.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { confirm } from '$lib/stores/confirm.svelte';
	import { ApiError } from '$lib/api/error';
	import { ACCENT_PRESETS, DEFAULT_ACCENT, isValidHex, applyAccent, clearAccent } from '$lib/utils/accent';
	import { applyTheme, getTheme, type ThemeMode } from '$lib/utils/theme';
	import {
		changeLocale,
		currentLocale,
		LOCALE_LABELS,
		SUPPORTED_LOCALES,
		type Locale
	} from '$lib/utils/lang';
	import { m } from '$lib/paraglide/messages';
	import { WEB_VERSION, WEB_BUILT_AT, WEB_BUILD_MODE } from '$lib/version';
	import { fmtRelative } from '$lib/utils/format';
	import { cn } from '$lib/utils/cn';
	import type { SessionInfo } from '$lib/types/api';
	import {
		isPushSupported,
		notificationPermission,
		getCurrentSubscription,
		subscribeToPush,
		unsubscribeLocal
	} from '$lib/utils/push';
	import IconCheck from '~icons/lucide/check';
	import IconRotateCcw from '~icons/lucide/rotate-ccw';
	import IconSun from '~icons/lucide/sun';
	import IconMoon from '~icons/lucide/moon';
	import IconMonitor from '~icons/lucide/monitor';
	import IconLanguages from '~icons/lucide/languages';
	import IconRefreshCw from '~icons/lucide/refresh-cw';
	import IconBellRing from '~icons/lucide/bell-ring';
	import IconBellOff from '~icons/lucide/bell-off';

	let id = $derived(page.params.id ?? '');
	let profile = $derived(id ? profiles.byId(id) : undefined);
	let conn = $derived(profile ? connections.connect(profile) : null);
	let now = $state(Date.now());

	$effect(() => {
		const t = setInterval(() => (now = Date.now()), 1000);
		return () => clearInterval(t);
	});

	let secondsToExpiry = $derived.by(() => {
		if (!conn || !conn.expiresAt) return 0;
		return Math.max(0, Math.floor((conn.expiresAt - now) / 1000));
	});

	async function signIn() {
		if (!conn) return;
		try {
			await conn.login();
			toast.success(m.settings_toast_signed_in());
		} catch (e) {
			if (e instanceof ApiError) toast.error(m.settings_toast_signin_failed(), { description: e.userMessage });
		}
	}

	async function refreshNow() {
		if (!conn) return;
		try {
			await conn.refresh();
			toast.success(m.settings_toast_tokens_rotated());
		} catch (e) {
			if (e instanceof ApiError) toast.error(m.settings_toast_refresh_failed(), { description: e.userMessage });
		}
	}

	async function signOut() {
		if (!conn) return;
		await conn.logout();
		toast.info(m.settings_toast_signed_out());
	}

	async function remove() {
		if (!profile) return;
		const ok = await confirm({
			title: m.servers_remove_dialog_title({ name: profile.name }),
			description: m.servers_remove_dialog_description(),
			confirmLabel: m.servers_remove_dialog_confirm(),
			variant: 'danger'
		});
		if (!ok) return;
		await conn?.logout();
		await profiles.remove(profile.id);
		toast.success(m.servers_remove_toast_success());
		goto('/servers', { replaceState: true });
	}

	function fmtSeconds(s: number): string {
		const m = Math.floor(s / 60);
		const sec = s % 60;
		return `${m}:${String(sec).padStart(2, '0')}`;
	}

	let customHex = $state('');
	let theme = $state<ThemeMode>(getTheme());

	function setTheme(mode: ThemeMode) {
		theme = mode;
		applyTheme(mode);
	}

	let lang = $state<Locale>(currentLocale());
	function setLang(next: Locale) {
		if (next === lang) return;
		changeLocale(next); // reloads
	}

	let serverDesc = $derived(conn?.systemInfo?.data?.description);
	let serverVersion = $derived(serverDesc?.version);
	let serverMode = $derived(serverDesc?.build_mode);
	let serverBuiltAt = $derived(serverDesc?.built_at);

	async function setAccent(hex: string | null) {
		if (!profile) return;
		if (hex) applyAccent(hex);
		else clearAccent();
		await profiles.update(profile.id, { accent: hex ?? undefined });
	}

	async function applyCustom() {
		const v = customHex.trim();
		if (!isValidHex(v)) {
			toast.error(m.settings_toast_hex_invalid());
			return;
		}
		await setAccent(v);
		customHex = '';
		toast.success(m.settings_toast_accent_updated());
	}

	let sessions = $state<SessionInfo[]>([]);
	let sessionsLoading = $state(false);
	let sessionsError = $state<string | null>(null);
	let editingId = $state<string | null>(null);
	let editingName = $state('');

	async function fetchSessions() {
		if (!conn?.isAuthenticated) return;
		sessionsLoading = true;
		sessionsError = null;
		try {
			const res = await conn.client.listSessions();
			sessions = res.sessions;
		} catch (e) {
			sessionsError = e instanceof ApiError ? e.userMessage : String(e);
		} finally {
			sessionsLoading = false;
		}
	}

	$effect(() => {
		if (conn?.isAuthenticated) void fetchSessions();
	});

	function startRename(s: SessionInfo) {
		editingId = s.id;
		editingName = s.name;
	}

	async function commitRename(id: string) {
		const next = editingName.trim();
		const target = sessions.find((s) => s.id === id);
		if (!target || !next || next === target.name) {
			editingId = null;
			return;
		}
		try {
			await conn!.client.renameSession(id, next);
			editingId = null;
			toast.success(m.settings_toast_renamed());
			await fetchSessions();
		} catch (e) {
			editingId = null;
			toast.error(m.settings_toast_rename_failed(), {
				description: e instanceof ApiError ? e.userMessage : String(e)
			});
		}
	}

	let pushSupported = $state(false);
	let pushSubscribed = $state(false);
	let pushBusy = $state(false);
	let pushPermission = $state<NotificationPermission>('default');

	async function refreshPushState() {
		if (!isPushSupported()) {
			pushSupported = false;
			return;
		}
		pushSupported = true;
		pushPermission = notificationPermission();
		const sub = await getCurrentSubscription();
		pushSubscribed = sub !== null;
	}

	$effect(() => {
		void refreshPushState();
	});

	async function enablePush() {
		if (!conn?.isAuthenticated) return;
		pushBusy = true;
		try {
			const { public_key } = await conn.client.getVapidPublicKey();
			const payload = await subscribeToPush(public_key);
			await conn.client.subscribePush(payload);
			pushSubscribed = true;
			pushPermission = notificationPermission();
			toast.success(m.settings_toast_push_enabled());
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			toast.error(m.settings_toast_push_enable_failed(), { description: msg });
		} finally {
			pushBusy = false;
		}
	}

	async function disablePush() {
		if (!conn?.isAuthenticated) return;
		pushBusy = true;
		try {
			// Both steps needed: skipping either leaves a stale subscription on relay or server.
			await unsubscribeLocal();
			await conn.client.unsubscribePush();
			pushSubscribed = false;
			toast.info(m.settings_toast_push_disabled());
		} catch (e) {
			toast.error(m.settings_toast_push_disable_failed(), {
				description: e instanceof Error ? e.message : String(e)
			});
		} finally {
			pushBusy = false;
		}
	}

	async function togglePush() {
		if (pushSubscribed) await disablePush();
		else await enablePush();
	}

	async function revokeSession(s: SessionInfo) {
		const ok = await confirm({
			title: s.is_current
				? m.settings_revoke_self_title()
				: m.settings_revoke_other_title({ name: s.name }),
			description: s.is_current
				? m.settings_revoke_self_description()
				: m.settings_revoke_other_description(),
			confirmLabel: m.settings_revoke_confirm(),
			variant: 'danger'
		});
		if (!ok) return;
		try {
			await conn!.client.revokeSession(s.id);
			toast.success(m.settings_toast_revoked());
			if (s.is_current) {
				// jti gone server-side; local logout so the layout guard redirects cleanly.
				await conn?.logout();
				goto('/servers', { replaceState: true });
			} else {
				await fetchSessions();
			}
		} catch (e) {
			toast.error(m.settings_toast_revoke_failed(), {
				description: e instanceof ApiError ? e.userMessage : String(e)
			});
		}
	}
</script>

{#if profile}
	<div class="mx-auto max-w-3xl px-4 py-8 md:px-8 md:py-10">
		<header class="mb-8">
			<h1 class="text-[24px] font-semibold tracking-tight">{m.section_settings()}</h1>
			<p class="mt-1.5 max-w-md text-sm leading-relaxed text-[var(--color-fg-muted)]">
				{m.settings_page_description()}
			</p>
		</header>

		<Card class="mb-5">
			<div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
				<div class="min-w-0">
					<p class="text-xs tracking-wide text-[var(--color-fg-muted)]">{m.settings_session_eyebrow()}</p>
					<div class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
						{#if conn && conn.isAuthenticated}
							<StatusDot status="connected" label={m.settings_session_authenticated()} />
							<span class="text-sm text-[var(--color-fg-muted)]">
								{m.settings_session_expires_in()} <span class="font-mono text-[var(--color-fg)]"
									>{fmtSeconds(secondsToExpiry)}</span
								>
							</span>
						{:else if conn?.status === 'authenticating'}
							<StatusDot status="unknown" label={m.settings_session_signing_in()} />
						{:else if conn?.status === 'error'}
							<StatusDot status="offline" label={m.settings_session_signed_out()} />
							{#if conn.error}
								<span class="text-sm text-[var(--color-danger)]">{conn.error.userMessage}</span>
							{/if}
						{:else}
							<StatusDot status="unknown" label={m.settings_session_idle()} />
						{/if}
					</div>
				</div>
				<div class="flex items-center gap-2 sm:shrink-0">
					{#if conn?.isAuthenticated}
						<Button variant="secondary" size="sm" onclick={refreshNow}>{m.settings_action_refresh()}</Button>
						<Button variant="ghost" size="sm" onclick={signOut}>{m.settings_action_signout()}</Button>
					{:else}
						<Button size="sm" onclick={signIn} loading={conn?.status === 'authenticating'}>
							{m.settings_action_signin()}
						</Button>
					{/if}
				</div>
			</div>
		</Card>

		<Card padding="md" class="mb-5">
			<p class="mb-3 text-xs tracking-wide text-[var(--color-fg-muted)]">
				{m.settings_pairing_eyebrow()}
			</p>
			<dl class="grid gap-3 text-sm sm:grid-cols-[140px_1fr]">
				<dt class="text-[var(--color-fg-muted)]">{m.settings_pairing_display_name()}</dt>
				<dd class="text-[var(--color-fg)]">{profile.name}</dd>
				<dt class="text-[var(--color-fg-muted)]">{m.settings_pairing_base_url()}</dt>
				<dd class="break-all font-mono text-[var(--color-fg)]">{profile.baseUrl}</dd>
				<dt class="text-[var(--color-fg-muted)]">{m.settings_pairing_device_id()}</dt>
				<dd class="break-all font-mono text-[var(--color-fg)]">{profile.deviceId}</dd>
				<dt class="text-[var(--color-fg-muted)]">{m.settings_pairing_paired_at()}</dt>
				<dd class="text-[var(--color-fg)]">{new Date(profile.createdAt).toLocaleString()}</dd>
			</dl>
		</Card>

		<Card padding="md" class="mb-5">
			<div class="mb-3 flex items-baseline justify-between gap-3">
				<p class="text-xs tracking-wide text-[var(--color-fg-muted)]">
					{m.settings_devices_eyebrow()}
				</p>
				<button
					type="button"
					onclick={fetchSessions}
					disabled={sessionsLoading}
					class="inline-flex items-center gap-1 text-[11px] text-[var(--color-fg-subtle)] transition hover:text-[var(--color-fg)] disabled:opacity-50"
					title={m.settings_devices_refresh_title()}
				>
					<IconRefreshCw class={cn('size-[11px]', sessionsLoading && 'animate-spin')} stroke-width="2.25" />
					{m.settings_devices_refresh()}
				</button>
			</div>
			<p class="mb-3 max-w-md text-[12px] text-[var(--color-fg-muted)]">
				{m.settings_devices_description()}
			</p>

			{#if sessionsError}
				<p class="text-[12px] text-[var(--color-danger)]">{sessionsError}</p>
			{:else if sessionsLoading && sessions.length === 0}
				<p class="text-[12px] text-[var(--color-fg-subtle)]">{m.settings_devices_loading()}</p>
			{:else if sessions.length === 0}
				<p class="text-[12px] text-[var(--color-fg-subtle)]">{m.settings_devices_empty()}</p>
			{:else}
				<ul class="-mx-2 flex flex-col">
					{#each sessions as s (s.id)}
						<li
							class={cn(
								'group flex items-center gap-3 rounded-md px-2 py-2.5 transition-colors',
								'hover:bg-[var(--color-surface-2)]/40',
								s.is_current && 'bg-[var(--color-accent)]/5'
							)}
						>
							<div class="min-w-0 flex-1">
								<div class="flex items-center gap-2">
									{#if editingId === s.id}
										<Input
											bind:value={editingName}
											onblur={() => commitRename(s.id)}
											onkeydown={(e: KeyboardEvent) => {
												if (e.key === 'Enter') {
													e.preventDefault();
													void commitRename(s.id);
												} else if (e.key === 'Escape') {
													editingId = null;
												}
											}}
											class="h-7 w-48 text-[13px]"
										/>
									{:else}
										<button
											type="button"
											onclick={() => startRename(s)}
											class="truncate text-[14px] font-medium text-[var(--color-fg)] transition hover:text-[var(--color-accent)]"
											title={m.settings_devices_rename_title()}
										>
											{s.name}
										</button>
									{/if}
									{#if s.is_current}
										<span
											class="rounded bg-[var(--color-accent)]/15 px-1.5 py-0.5 font-mono text-[10px] tracking-wide text-[var(--color-accent)]"
										>
											{m.settings_devices_this_device()}
										</span>
									{/if}
									{#if !s.is_active}
										<span
											class="rounded bg-[var(--color-fg-subtle)]/15 px-1.5 py-0.5 font-mono text-[10px] tracking-wide text-[var(--color-fg-subtle)]"
										>
											{m.settings_devices_inactive()}
										</span>
									{/if}
								</div>
								<p class="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-[var(--color-fg-subtle)]">
									<span>{m.settings_devices_last_seen({ time: fmtRelative(s.last_seen) })}</span>
									{#if s.last_ip}
										<span class="text-[var(--color-fg-faint)]" aria-hidden="true">·</span>
										<span class="font-mono">{s.last_ip}</span>
									{/if}
									<span class="text-[var(--color-fg-faint)]" aria-hidden="true">·</span>
									<span>
										{s.active_sessions === 1
											? m.settings_devices_live_sessions_one()
											: m.settings_devices_live_sessions_other({ count: s.active_sessions })}
									</span>
								</p>
							</div>
							<button
								type="button"
								onclick={() => revokeSession(s)}
								class="shrink-0 rounded-md px-2 py-1 text-[12px] text-[var(--color-fg-subtle)] opacity-60 transition hover:bg-[var(--color-danger)]/10 hover:text-[var(--color-danger)] hover:opacity-100 group-hover:opacity-100"
							>
								{m.settings_devices_revoke()}
							</button>
						</li>
					{/each}
				</ul>
			{/if}
		</Card>

		<Card padding="md" class="mb-5">
			<div class="mb-3 flex items-baseline justify-between gap-3">
				<p class="text-xs tracking-wide text-[var(--color-fg-muted)]">
					{m.settings_push_eyebrow()}
				</p>
				{#if pushSupported}
					<span
						class={cn(
							'text-[11px]',
							pushSubscribed
								? 'text-[var(--color-success)]'
								: 'text-[var(--color-fg-subtle)]'
						)}
					>
						{pushSubscribed ? m.settings_push_status_enabled() : m.settings_push_status_disabled()}
					</span>
				{/if}
			</div>
			<p class="mb-3 max-w-md text-[12px] text-[var(--color-fg-muted)]">
				{m.settings_push_description()}
			</p>

			{#if !pushSupported}
				<p class="text-[12px] text-[var(--color-fg-subtle)]">
					{m.settings_push_unsupported()}
				</p>
			{:else if pushPermission === 'denied'}
				<p class="text-[12px] text-[var(--color-warning)]">
					{m.settings_push_blocked()}
				</p>
			{:else}
				<Button
					variant={pushSubscribed ? 'secondary' : 'primary'}
					size="sm"
					onclick={togglePush}
					loading={pushBusy}
				>
					{#if pushSubscribed}
						<IconBellOff class="size-[13px]" stroke-width="2" />
						{m.settings_push_disable()}
					{:else}
						<IconBellRing class="size-[13px]" stroke-width="2" />
						{m.settings_push_enable()}
					{/if}
				</Button>
			{/if}
		</Card>

		<Card padding="md" class="mb-5">
			<div class="mb-3 flex items-baseline justify-between">
				<p class="text-xs tracking-wide text-[var(--color-fg-muted)]">{m.settings_appearance_eyebrow()}</p>
				<span class="text-[11px] text-[var(--color-fg-subtle)]">
					{m.settings_applies_to_all()}
				</span>
			</div>
			<p class="mb-3 max-w-md text-[12px] text-[var(--color-fg-muted)]">
				{m.settings_appearance_description_prefix()} <span class="font-mono">{m.settings_theme_auto()}</span> {m.settings_appearance_description_suffix()}
			</p>
			<div class="inline-flex items-center rounded-[var(--radius-input)] border border-[var(--color-border)] bg-[var(--color-surface-2)] p-0.5">
				{@render themeBtn('auto', m.settings_theme_auto(), IconMonitor)}
				{@render themeBtn('light', m.settings_theme_light(), IconSun)}
				{@render themeBtn('dark', m.settings_theme_dark(), IconMoon)}
			</div>
		</Card>

		<Card padding="md" class="mb-5">
			<div class="mb-3 flex items-baseline justify-between">
				<p class="text-xs tracking-wide text-[var(--color-fg-muted)]">{m.settings_accent_eyebrow()}</p>
				{#if profile.accent}
					<button
						type="button"
						onclick={() => setAccent(null)}
						class="inline-flex items-center gap-1 text-[11px] text-[var(--color-fg-subtle)] transition hover:text-[var(--color-fg)]"
						title={m.settings_accent_reset_title()}
					>
						<IconRotateCcw class="size-[11px]" stroke-width="2.25" />
						{m.settings_accent_reset()}
					</button>
				{/if}
			</div>
			<p class="mb-3 max-w-md text-[12px] text-[var(--color-fg-muted)]">
				{m.settings_accent_description()}
			</p>

			<div class="flex flex-wrap gap-2">
				{#each ACCENT_PRESETS as p (p.hex)}
					{@const active = (profile.accent ?? DEFAULT_ACCENT).toLowerCase() === p.hex.toLowerCase()}
					<button
						type="button"
						onclick={() => setAccent(p.hex)}
						class={cn(
							'group relative grid size-8 place-items-center rounded-full transition',
							active && 'ring-2 ring-offset-2 ring-offset-[var(--color-surface)]'
						)}
						style="background: {p.hex}; --tw-ring-color: {p.hex}"
						title={p.name}
						aria-label={p.name}
					>
						{#if active}
							<IconCheck class="size-4 text-white drop-shadow" stroke-width="3" />
						{/if}
					</button>
				{/each}
			</div>

			<div class="mt-4 flex items-end gap-2">
				<label class="flex-1 text-[11px] font-medium tracking-wide text-[var(--color-fg-muted)]">
					{m.settings_accent_custom_hex_label()}
					<Input
						bind:value={customHex}
						placeholder="#38bdf8"
						class="mt-1 font-mono"
					/>
				</label>
				<Button variant="secondary" size="sm" onclick={applyCustom}>{m.settings_action_apply()}</Button>
			</div>
		</Card>

		<Card padding="md" class="mb-5">
			<div class="mb-3 flex items-baseline justify-between">
				<p class="text-xs tracking-wide text-[var(--color-fg-muted)]">
					{m.settings_language_eyebrow()}
				</p>
				<span class="text-[11px] text-[var(--color-fg-subtle)]">
					{m.settings_applies_to_all()}
				</span>
			</div>
			<p class="mb-3 max-w-md text-[12px] text-[var(--color-fg-muted)]">
				{m.settings_language_description()}
			</p>
			<div class="inline-flex items-center rounded-[var(--radius-input)] border border-[var(--color-border)] bg-[var(--color-surface-2)] p-0.5">
				{#each SUPPORTED_LOCALES as code (code)}
					{@render langBtn(code, LOCALE_LABELS[code])}
				{/each}
			</div>
		</Card>

		<Card padding="md" class="mb-5">
			<p class="mb-3 text-xs tracking-wide text-[var(--color-fg-muted)]">{m.settings_versions_eyebrow()}</p>
			<dl class="grid gap-y-2 text-sm sm:grid-cols-[140px_1fr]">
				<dt class="text-[var(--color-fg-muted)]">remon-server</dt>
				<dd class="flex flex-wrap items-baseline gap-x-2 font-mono text-[var(--color-fg)]">
					<span>{serverVersion ? `v${serverVersion}` : '—'}</span>
					{#if serverMode}
						<span class="text-[11px] tracking-wide text-[var(--color-fg-muted)]">
							{serverMode}
						</span>
					{/if}
					{#if serverBuiltAt}
						<span
							class="text-[11px] text-[var(--color-fg-subtle)]"
							title={new Date(serverBuiltAt * 1000).toLocaleString()}
						>
							{m.settings_versions_built({ time: fmtRelative(serverBuiltAt) })}
						</span>
					{/if}
				</dd>

				<dt class="text-[var(--color-fg-muted)]">remon-web</dt>
				<dd class="flex flex-wrap items-baseline gap-x-2 font-mono text-[var(--color-fg)]">
					<span>v{WEB_VERSION}</span>
					<span class="text-[11px] tracking-wide text-[var(--color-fg-muted)]">
						{WEB_BUILD_MODE}
					</span>
					{#if WEB_BUILT_AT > 0}
						<span
							class="text-[11px] text-[var(--color-fg-subtle)]"
							title={new Date(WEB_BUILT_AT * 1000).toLocaleString()}
						>
							{m.settings_versions_built({ time: fmtRelative(WEB_BUILT_AT) })}
						</span>
					{/if}
				</dd>
			</dl>
		</Card>

		<Card padding="md" class="border-[var(--color-danger)]/30">
			<div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
				<div class="min-w-0">
					<p class="font-medium text-[var(--color-fg)]">{m.settings_remove_title()}</p>
					<p class="mt-1 text-sm text-[var(--color-fg-muted)]">
						{m.settings_remove_description()}
					</p>
				</div>
				<Button variant="danger" size="sm" onclick={remove} class="sm:shrink-0">
					{m.servers_remove_dialog_confirm()}
				</Button>
			</div>
		</Card>
	</div>
{/if}

{#snippet themeBtn(mode: ThemeMode, label: string, Icon: typeof IconSun)}
	{@const active = theme === mode}
	<button
		type="button"
		onclick={() => setTheme(mode)}
		class={cn(
			'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-medium transition',
			active
				? 'bg-[var(--color-surface)] text-[var(--color-fg)] shadow-[0_0_0_1px_var(--color-border)]'
				: 'text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]'
		)}
		aria-pressed={active}
	>
		<Icon class="size-[13px]" stroke-width="2" />
		{label}
	</button>
{/snippet}

{#snippet langBtn(code: Locale, label: string)}
	{@const active = lang === code}
	<button
		type="button"
		onclick={() => setLang(code)}
		class={cn(
			'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-medium transition',
			active
				? 'bg-[var(--color-surface)] text-[var(--color-fg)] shadow-[0_0_0_1px_var(--color-border)]'
				: 'text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]'
		)}
		aria-pressed={active}
	>
		<IconLanguages class="size-[13px]" stroke-width="2" />
		{label}
	</button>
{/snippet}
