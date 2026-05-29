<script lang="ts">
	import { goto } from '$app/navigation';
	import Button from '$lib/components/ui/Button.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Field from '$lib/components/ui/Field.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import { vault } from '$lib/vault/store.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { m } from '$lib/paraglide/messages';

	let pwd = $state('');
	let confirm = $state('');
	let busy = $state(false);
	let trust = $state(false);

	let strength = $derived.by(() => {
		const len = pwd.length;
		const hasUpper = /[A-Z]/.test(pwd);
		const hasLower = /[a-z]/.test(pwd);
		const hasDigit = /\d/.test(pwd);
		const hasSym = /[^A-Za-z0-9]/.test(pwd);
		const variety = [hasUpper, hasLower, hasDigit, hasSym].filter(Boolean).length;
		if (len === 0) return { label: '', cls: '', pct: 0 };
		if (len < 8)
			return { label: m.setup_strength_weak(), cls: 'bg-[var(--color-danger)]', pct: 25 };
		if (len < 12 || variety < 2)
			return { label: m.setup_strength_fair(), cls: 'bg-[var(--color-warning)]', pct: 55 };
		if (len < 16 || variety < 3)
			return { label: m.setup_strength_good(), cls: 'bg-[var(--color-info)]', pct: 80 };
		return { label: m.setup_strength_strong(), cls: 'bg-[var(--color-success)]', pct: 100 };
	});

	let mismatched = $derived(confirm.length > 0 && confirm !== pwd);
	let canSubmit = $derived(pwd.length >= 8 && pwd === confirm && !busy);

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		if (!canSubmit) return;
		busy = true;
		try {
			await vault.create(pwd);
			if (trust) {
				// Best-effort: a failure here shouldn't block vault creation —
				// user can still sign in normally and turn on trust later.
				try {
					await vault.trustDevice(pwd);
				} catch {
					/* swallow; user can enable from settings */
				}
			}
			toast.success(m.setup_toast_created_title(), {
				description: m.setup_toast_created_description()
			});
			pwd = '';
			confirm = '';
			goto('/servers', { replaceState: true });
		} catch (err) {
			toast.error(m.setup_toast_error_title(), {
				description: err instanceof Error ? err.message : String(err)
			});
		} finally {
			busy = false;
		}
	}
</script>

<div class="app-content grid min-h-screen place-items-center px-6 py-12">
	<div class="w-full max-w-md">
		<header class="mb-9 text-center">
			<h1 class="text-[28px] font-semibold tracking-tight">{m.setup_title()}</h1>
			<p class="mx-auto mt-3 max-w-sm text-[13px] leading-relaxed text-[var(--color-fg-muted)]">
				{m.setup_intro()}
			</p>
		</header>

		<Card padding="lg">
			<form class="flex flex-col gap-5" onsubmit={submit}>
				<Field label={m.common_master_password()} hint={m.setup_password_hint()} for="pwd">
					<Input id="pwd" type="password" bind:value={pwd} autocomplete="new-password" required />
					{#if pwd.length > 0}
						<div class="mt-2 flex items-center gap-3">
							<div class="h-[3px] flex-1 overflow-hidden rounded-full bg-[var(--color-surface-3)]">
								<div
									class={`h-full rounded-full transition-all duration-[var(--dur-mid)] ease-[var(--ease-snap)] ${strength.cls}`}
									style="width: {strength.pct}%"
								></div>
							</div>
							<span
								class="text-[11px] font-medium tracking-[0.08em] text-[var(--color-fg-muted)] tabular-nums"
								>{strength.label}</span
							>
						</div>
					{/if}
				</Field>

				<Field
					label={m.setup_confirm_label()}
					error={mismatched ? m.setup_password_mismatch() : null}
					for="confirm"
				>
					<Input
						id="confirm"
						type="password"
						bind:value={confirm}
						invalid={mismatched}
						autocomplete="new-password"
						required
					/>
				</Field>

				<label
					class="flex cursor-pointer items-start gap-2.5 text-[13px] leading-snug text-[var(--color-fg)]"
				>
					<input
						type="checkbox"
						bind:checked={trust}
						class="mt-[3px] size-[14px] shrink-0 cursor-pointer accent-[var(--color-accent)]"
					/>
					<span class="flex flex-col gap-1">
						<span>{m.setup_trust_label()}</span>
						<span class="text-[11px] text-[var(--color-fg-muted)]">
							{m.setup_trust_hint()}
						</span>
					</span>
				</label>

				<Button type="submit" disabled={!canSubmit} loading={busy} fullWidth size="lg">
					{m.setup_submit()}
				</Button>
			</form>
		</Card>

		<p
			class="mx-auto mt-6 max-w-sm text-center text-[12px] leading-relaxed text-[var(--color-fg-subtle)]"
		>
			{m.setup_footer()} <br />
			<span class="font-mono">AES-256-GCM · PBKDF2-SHA256 600 000 iterations</span>
		</p>
	</div>
</div>
