<script lang="ts">
	import { untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import Button from '$lib/components/ui/Button.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Field from '$lib/components/ui/Field.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import { ApiClient } from '$lib/api/client';
	import { ApiError } from '$lib/api/error';
	import { profiles } from '$lib/stores/profiles.svelte';
	import { connections } from '$lib/stores/connections.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { cn } from '$lib/utils/cn';
	import IconChevronLeft from '~icons/lucide/chevron-left';
	import IconCheck from '~icons/lucide/check';
	import IconInfo from '~icons/lucide/info';
	import { m } from '$lib/paraglide/messages';

	type Step = 1 | 2 | 3;

	let step = $state<Step>(1);
	let busy = $state(false);

	// ?replace=<id>: re-pair an existing profile when its device credential is no longer valid.
	let replaceId = $derived(page.url.searchParams.get('replace'));
	let replacingProfile = $derived(replaceId ? profiles.byId(replaceId) : undefined);
	let isReplacing = $derived(!!replacingProfile);

	let baseUrl = $state('');
	let name = $state('');
	let urlError = $state<string | null>(null);

	// Pre-fill from the profile being replaced (run once on mount).
	$effect(() => {
		if (replacingProfile) {
			untrack(() => {
				if (!baseUrl) baseUrl = replacingProfile.baseUrl;
				if (!name) name = replacingProfile.name;
			});
		}
	});

	let pairExpiresAt = $state(0);
	let now = $state(Date.now());
	let pairingCode = $state('');
	let deviceName = $state('');
	let pairError = $state<string | null>(null);

	$effect(() => {
		if (step !== 2 && step !== 3) return;
		const id = setInterval(() => (now = Date.now()), 250);
		return () => clearInterval(id);
	});

	let secondsLeft = $derived(Math.max(0, Math.ceil((pairExpiresAt * 1000 - now) / 1000)));
	let expired = $derived(step >= 2 && pairExpiresAt > 0 && secondsLeft <= 0);

	let client: ApiClient | null = null;

	function normalizeUrl(input: string): string | null {
		const trimmed = input.trim().replace(/\/+$/, '');
		try {
			const u = new URL(trimmed);
			if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
			return u.origin + (u.pathname === '/' ? '' : u.pathname);
		} catch {
			return null;
		}
	}

	async function startStep1(e: SubmitEvent) {
		e.preventDefault();
		urlError = null;
		const norm = normalizeUrl(baseUrl);
		if (!norm) {
			urlError = m.pair_error_url_invalid();
			return;
		}
		if (!name.trim()) {
			urlError = m.pair_error_name_required();
			return;
		}
		busy = true;
		try {
			const probe = new ApiClient(norm);
			await probe.health();
			client = probe;
			baseUrl = norm;
			await initiatePairing();
		} catch (err) {
			if (err instanceof ApiError) {
				urlError = err.userMessage;
			} else {
				urlError = m.pair_error_unreachable();
			}
		} finally {
			busy = false;
		}
	}

	async function initiatePairing() {
		if (!client) return;
		pairError = null;
		try {
			const res = await client.pairInitiate();
			pairExpiresAt = res.expires_at;
			step = 2;
		} catch (err) {
			if (err instanceof ApiError && err.code === 'ALREADY_EXISTS') {
				pairError = m.pair_error_already_open();
				step = 2;
				pairExpiresAt = 0;
			} else if (err instanceof ApiError) {
				urlError = err.userMessage;
			} else {
				urlError = m.pair_error_init_failed();
			}
		}
	}

	async function completeStep2(e: SubmitEvent) {
		e.preventDefault();
		if (!client) return;
		pairError = null;
		const code = pairingCode.trim();
		const dname = deviceName.trim();
		if (!/^\d{8}$/.test(code)) {
			pairError = m.pair_error_code_format();
			return;
		}
		if (!dname) {
			pairError = m.pair_error_device_required();
			return;
		}
		busy = true;
		try {
			const res = await client.pairComplete({ pairing_code: code, device_name: dname });
			step = 3;
			// Re-pair: evict the cached Connection so the next access binds to the new deviceId/deviceToken.
			if (replaceId && replacingProfile) {
				await profiles.update(replaceId, {
					name: name.trim(),
					baseUrl,
					deviceId: res.device_id,
					deviceToken: res.device_token
				});
				connections.evict(replaceId);
				const updated = profiles.byId(replaceId);
				if (!updated) throw new Error('Profile vanished during update');
				const conn = connections.connect(updated);
				await conn.login();
				toast.success(m.pair_toast_repaired_title(), {
					description: m.pair_toast_repaired_description({ name: updated.name })
				});
				goto(`/servers/${updated.id}`, { replaceState: true });
			} else {
				const profile = await profiles.add({
					name: name.trim(),
					baseUrl,
					deviceId: res.device_id,
					deviceToken: res.device_token
				});
				const conn = connections.connect(profile);
				await conn.login();
				await syncServerName(conn, profile.id, name.trim());
				toast.success(m.pair_toast_paired_title(), {
					description: m.pair_toast_paired_description({ name: profile.name })
				});
				goto(`/servers/${profile.id}`, { replaceState: true });
			}
		} catch (err) {
			if (err instanceof ApiError && err.code === 'PAIRING_EXPIRED') {
				pairError = m.pair_error_code_expired();
				pairingCode = '';
			} else if (err instanceof ApiError) {
				pairError = err.userMessage;
			} else {
				pairError = m.pair_error_generic();
			}
			step = 2;
		} finally {
			busy = false;
		}
	}

	async function retry() {
		pairExpiresAt = 0;
		pairingCode = '';
		pairError = null;
		await initiatePairing();
	}

	// Factory value of `server_config.server_name` (see 0001_schema.sql).
	const DEFAULT_SERVER_NAME = 'My Server';

	/**
	 * Best-effort two-way name sync on a fresh pair: a factory-named server
	 * adopts the name typed during pairing; a server that was already renamed
	 * wins and overwrites the local alias. Failures are ignored — pairing
	 * already succeeded and the config page can fix names later.
	 */
	async function syncServerName(
		conn: ReturnType<typeof connections.connect>,
		profileId: string,
		typedName: string
	) {
		try {
			const cfg = await conn.client.getConfig();
			if (cfg.server_name === DEFAULT_SERVER_NAME) {
				if (typedName && typedName !== DEFAULT_SERVER_NAME) {
					await conn.client.patchConfig({ server_name: typedName });
				}
			} else if (cfg.server_name !== typedName) {
				await profiles.update(profileId, { name: cfg.server_name });
			}
		} catch {
			// non-fatal
		}
	}

	let stepDots = $derived([
		{ n: 1 as const, label: m.pair_step_server() },
		{ n: 2 as const, label: m.pair_step_code() },
		{ n: 3 as const, label: m.pair_step_done() }
	]);
</script>

<div class="app-content mx-auto max-w-xl px-6 py-12">
	<button
		type="button"
		onclick={() => goto('/servers')}
		class="group mb-6 inline-flex items-center gap-1.5 text-[12px] text-[var(--color-fg-subtle)] transition-colors duration-[var(--dur-fast)] hover:text-[var(--color-fg-muted)]"
	>
		<IconChevronLeft
			class="size-[14px] transition-transform duration-[var(--dur-fast)] group-hover:-translate-x-0.5"
			stroke-width="2"
		/>
		{m.pair_back_link()}
	</button>

	<h1 class="text-[28px] font-semibold tracking-tight">
		{isReplacing && replacingProfile
			? m.pair_title_replace({ name: replacingProfile.name })
			: m.pair_title_add()}
	</h1>
	<p class="mt-2 max-w-md text-sm leading-relaxed text-[var(--color-fg-muted)]">
		{isReplacing ? m.pair_description_replace() : m.pair_description_add()}
	</p>

	<div class="my-9 flex items-center gap-2.5">
		{#each stepDots as s (s.n)}
			<div class="flex items-center gap-2.5">
				<span
					class={cn(
						'grid h-7 w-7 place-items-center rounded-full font-mono text-[11px] font-semibold transition-all duration-[var(--dur-mid)]',
						step === s.n
							? 'bg-[var(--color-accent)] text-[var(--color-accent-fg)] shadow-[0_0_18px_-2px_var(--color-accent-glow)]'
							: step > s.n
								? 'bg-[var(--color-success)]/15 text-[var(--color-success)] border border-[var(--color-success)]/30'
								: 'border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-fg-subtle)]'
					)}
				>
					{#if step > s.n}
						<IconCheck class="size-[12px]" stroke-width="3" />
					{:else}
						{s.n}
					{/if}
				</span>
				<span
					class={cn(
						'text-[11px] font-medium tracking-[0.06em] transition-colors',
						step === s.n
							? 'text-[var(--color-fg)]'
							: step > s.n
								? 'text-[var(--color-fg-muted)]'
								: 'text-[var(--color-fg-subtle)]'
					)}
				>
					{s.label}
				</span>
			</div>
			{#if s.n < 3}
				<div
					class="h-px flex-1 bg-gradient-to-r from-[var(--color-border)] via-[var(--color-border)] to-transparent"
				></div>
			{/if}
		{/each}
	</div>

	{#if step === 1}
		<Card>
			<form class="flex flex-col gap-5" onsubmit={startStep1}>
				<Field
					label={m.pair_field_url_label()}
					hint={m.pair_field_url_hint()}
					error={urlError}
					for="baseUrl"
				>
					<Input
						id="baseUrl"
						type="url"
						bind:value={baseUrl}
						invalid={!!urlError}
						placeholder="http://192.168.1.50:8080"
						required
					/>
				</Field>
				<Field label={m.pair_field_name_label()} hint={m.pair_field_name_hint()} for="name">
					<Input id="name" bind:value={name} placeholder="prod-server-01" required />
				</Field>
				<div class="flex items-center justify-end gap-2 pt-2">
					<Button variant="ghost" onclick={() => goto('/servers')}>{m.common_cancel()}</Button>
					<Button type="submit" loading={busy} disabled={busy}>
						{m.pair_step1_button_continue()}
					</Button>
				</div>
			</form>
		</Card>
	{:else if step === 2}
		<Card>
			<div
				class="mb-5 flex items-start gap-3 rounded-[var(--radius-input)] border border-[var(--color-info)]/30 bg-[var(--color-info)]/10 p-4 text-sm"
			>
				<IconInfo class="mt-0.5 size-[18px] shrink-0 text-[var(--color-info)]" stroke-width="2" />
				<div>
					<p class="font-medium text-[var(--color-fg)]">{m.pair_info_title()}</p>
					<p class="mt-1 text-[var(--color-fg-muted)]">
						{m.pair_info_description()}
					</p>
				</div>
			</div>

			{#if pairExpiresAt > 0 && !expired}
				<div class="mb-5 flex items-center justify-between text-xs text-[var(--color-fg-muted)]">
					<span>{m.pair_code_expires_in()}</span>
					<span class="font-mono text-sm tabular-nums text-[var(--color-fg)]">
						{Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, '0')}
					</span>
				</div>
				<div class="mb-5 h-1 overflow-hidden rounded-full bg-[var(--color-surface-3)]">
					<div
						class="h-full bg-[var(--color-accent)] transition-all"
						style="width: {Math.min(100, (secondsLeft / 300) * 100)}%"
					></div>
				</div>
			{/if}

			{#if expired}
				<div
					class="mb-5 rounded-[var(--radius-input)] border border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 p-4 text-sm text-[var(--color-fg)]"
				>
					{m.pair_code_expired()}
				</div>
			{/if}

			{#if pairError}
				<div
					class="mb-5 rounded-[var(--radius-input)] border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 p-4 text-sm text-[var(--color-fg)]"
				>
					{pairError}
				</div>
			{/if}

			<form class="flex flex-col gap-5" onsubmit={completeStep2}>
				<Field label={m.pair_field_code_label()} hint={m.pair_field_code_hint()} for="code">
					<Input
						id="code"
						bind:value={pairingCode}
						placeholder="12345678"
						inputmode="numeric"
						pattern="[0-9]*"
						maxlength={8}
						class="font-mono text-lg tracking-[0.4em]"
						autofocus
						disabled={expired}
						required
					/>
				</Field>
				<Field label={m.pair_field_device_label()} hint={m.pair_field_device_hint()} for="dname">
					<Input
						id="dname"
						bind:value={deviceName}
						placeholder="My laptop"
						disabled={expired}
						required
					/>
				</Field>
				<div class="flex items-center justify-between gap-2 pt-2">
					<Button variant="ghost" onclick={retry} disabled={busy}>
						{expired ? m.pair_step2_button_restart() : m.pair_step2_button_new_code()}
					</Button>
					<Button type="submit" loading={busy} disabled={busy || expired}>
						{m.pair_step2_button_pair()}
					</Button>
				</div>
			</form>
		</Card>
	{:else}
		<Card class="grid place-items-center py-12 text-center">
			<div
				class="mx-auto grid h-12 w-12 place-items-center rounded-full bg-[var(--color-success)]/15 text-[var(--color-success)]"
			>
				<IconCheck class="size-5" stroke-width="2" />
			</div>
			<p class="mt-4 text-sm text-[var(--color-fg-muted)]">{m.pair_signing_in()}</p>
		</Card>
	{/if}
</div>
