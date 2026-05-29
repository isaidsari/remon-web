<script lang="ts">
	import { goto } from '$app/navigation';
	import Button from '$lib/components/ui/Button.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Field from '$lib/components/ui/Field.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import { vault } from '$lib/vault/store.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { confirm } from '$lib/stores/confirm.svelte';
	import { m } from '$lib/paraglide/messages';

	let pwd = $state('');
	let busy = $state(false);
	let error = $state<string | null>(null);
	let trust = $state(false);

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		if (!pwd || busy) return;
		busy = true;
		error = null;
		try {
			await vault.unlock(pwd);
			if (trust) {
				try {
					await vault.trustDevice(pwd);
				} catch {
					/* swallow; user can enable from settings */
				}
			}
			pwd = '';
			goto('/servers', { replaceState: true });
		} catch {
			error = m.unlock_wrong_password();
			pwd = '';
		} finally {
			busy = false;
		}
	}

	async function reset() {
		const ok = await confirm({
			title: m.unlock_wipe_dialog_title(),
			description: m.unlock_wipe_dialog_description(),
			confirmLabel: m.unlock_wipe_dialog_confirm(),
			variant: 'danger'
		});
		if (!ok) return;
		vault.destroy();
		toast.info(m.unlock_toast_wiped_title(), {
			description: m.unlock_toast_wiped_description()
		});
		goto('/setup', { replaceState: true });
	}
</script>

<div class="app-content grid min-h-screen place-items-center px-6 py-12">
	<div class="w-full max-w-md">
		<header class="mb-8">
			<h1 class="text-[32px] font-semibold tracking-[-0.02em] leading-tight">
				{m.unlock_title()}
			</h1>
			<p class="mt-3 max-w-sm text-[15px] leading-relaxed text-[var(--color-fg-muted)]">
				{m.unlock_intro()}
			</p>
		</header>

		<Card padding="lg">
			<form class="flex flex-col gap-5" onsubmit={submit}>
				<Field label={m.common_master_password()} {error} for="pwd">
					<Input
						id="pwd"
						type="password"
						bind:value={pwd}
						invalid={!!error}
						autocomplete="current-password"
						autofocus
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
						<span>{m.unlock_trust_label()}</span>
						<span class="text-[11px] text-[var(--color-fg-muted)]">
							{m.unlock_trust_hint()}
						</span>
					</span>
				</label>

				<Button type="submit" disabled={!pwd || busy} loading={busy} fullWidth size="lg">
					{m.unlock_submit()}
				</Button>
			</form>
		</Card>

		<button
			type="button"
			onclick={reset}
			class="mx-auto mt-7 block text-[12px] text-[var(--color-fg-subtle)] underline-offset-4 transition-colors duration-[var(--dur-fast)] hover:text-[var(--color-danger)] hover:underline"
		>
			{m.unlock_wipe_link()}
		</button>
	</div>
</div>
