<script lang="ts">
	import { untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import { profiles } from '$lib/stores/profiles.svelte';
	import { connections } from '$lib/stores/connections.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import ServerCard from '$lib/components/overview/ServerCard.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { confirm } from '$lib/stores/confirm.svelte';
	import IconPlus from '~icons/lucide/plus';
	import IconServer from '~icons/lucide/server';
	import { ApiError } from '$lib/api/error';
	import type { ServerProfile } from '$lib/types/profile';
	import { m } from '$lib/paraglide/messages';

	$effect(() => {
		const list = profiles.list;
		untrack(() => {
			for (const p of list) {
				const conn = connections.connect(p);
				conn.ensureSignedIn().catch((e) => {
					if (e instanceof ApiError && e.code !== 'CORS_OR_OFFLINE' && e.code !== 'TIMEOUT') {
						console.warn(`sign-in to ${p.name}:`, e.userMessage);
					}
				});
				void conn.fetchSystemInfo().catch(() => {/* not critical */});
			}
		});
	});

	let q = $state('');
	let filtered = $derived.by(() => {
		const needle = q.trim().toLowerCase();
		if (!needle) return profiles.list;
		return profiles.list.filter(
			(p) =>
				p.name.toLowerCase().includes(needle) ||
				p.baseUrl.toLowerCase().includes(needle)
		);
	});

	let showFilter = $derived(profiles.list.length >= 6);

	// $effect not $derived.by: conn.live lazily creates the LiveStats instance; $derived's strict mode suppresses that side effect.
	let toneCounts = $state({ connecting: 0, offline: 0 });
	$effect(() => {
		const counts = { connecting: 0, offline: 0 };
		for (const p of profiles.list) {
			const conn = connections.connect(p);
			if (conn.status === 'authenticating') counts.connecting++;
			else if (!conn.isAuthenticated) counts.offline++;
		}
		toneCounts = counts;
	});

	async function remove(p: ServerProfile, _e: MouseEvent) {
		const ok = await confirm({
			title: m.servers_remove_dialog_title({ name: p.name }),
			description: m.servers_remove_dialog_description(),
			confirmLabel: m.servers_remove_dialog_confirm(),
			variant: 'danger'
		});
		if (!ok) return;
		try {
			await profiles.remove(p.id);
			toast.success(m.servers_remove_toast_success());
		} catch (err) {
			toast.error(m.servers_remove_toast_failure(), {
				description: err instanceof Error ? err.message : String(err)
			});
		}
	}
</script>

<div class="app-content mx-auto max-w-6xl px-6 py-12">
	<header class="mb-8 flex flex-wrap items-end justify-between gap-4">
		<div>
			<h1 class="flex items-center gap-2.5 text-[24px] font-semibold tracking-tight">
				{m.servers_title()}
				<span
					class="rounded-md bg-[var(--color-surface-2)] px-2 py-0.5 font-mono text-[12px] font-medium text-[var(--color-fg-subtle)] shadow-[inset_0_0_0_1px_var(--color-border)]"
				>
					{profiles.list.length}
				</span>
				{#if toneCounts.connecting > 0}
					<span class="inline-flex items-center gap-1 font-mono text-[11px] font-medium text-[var(--color-warning)]">
						<span class="h-1.5 w-1.5 rounded-full bg-[var(--color-warning)]"></span>
						{toneCounts.connecting}
					</span>
				{/if}
				{#if toneCounts.offline > 0}
					<span class="inline-flex items-center gap-1 font-mono text-[11px] font-medium text-[var(--color-danger)]">
						<span class="h-1.5 w-1.5 rounded-full bg-[var(--color-danger)]"></span>
						{toneCounts.offline}
					</span>
				{/if}
			</h1>
		</div>

		{#if showFilter}
			<div class="flex flex-shrink-0 items-center gap-2">
				<Input placeholder={m.servers_filter_placeholder()} bind:value={q} class="w-48" />
			</div>
		{/if}
	</header>

	{#if profiles.list.length === 0}
		<div
			class="relative mx-auto max-w-md rounded-[var(--radius-card)] border border-dashed border-[var(--color-border-strong)] bg-[var(--color-surface)]/40 px-8 py-14 text-center"
		>
			<div
				class="mx-auto mb-5 grid h-16 w-16 place-items-center rounded-2xl bg-[var(--color-bg-soft)]"
			>
				<IconServer class="size-7 text-[var(--color-fg-muted)]" stroke-width="1.5" />
			</div>
			<h2 class="text-xl font-semibold tracking-tight">{m.servers_empty_title()}</h2>
			<p class="mx-auto mt-2 max-w-xs text-sm text-[var(--color-fg-muted)]">
				{m.servers_empty_description()}
			</p>
			<div class="mt-7">
				<Button variant="primary" size="lg" onclick={() => goto('/servers/new')}>
					{m.servers_empty_cta()}
				</Button>
			</div>
		</div>
	{:else if filtered.length === 0}
		<div class="rounded-[var(--radius-card)] border border-dashed border-[var(--color-border)] px-6 py-12 text-center text-sm text-[var(--color-fg-muted)]">
			{m.servers_no_match({ q })}
		</div>
	{:else}
		<div class="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
			{#each filtered as p (p.id)}
				<ServerCard
					profile={p}
					conn={connections.connect(p)}
					onRemove={(e) => remove(p, e)}
				/>
			{/each}
			{#if !q.trim()}
				<a
					href="/servers/new"
					class="group flex min-h-[260px] flex-col items-center justify-center rounded-[var(--radius-card)] border border-dashed border-[var(--color-border)] bg-transparent p-5 text-center transition-colors duration-[var(--dur-fast)] hover:border-[var(--color-fg-subtle)] hover:bg-[var(--color-surface)]/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]"
				>
					<div
						class="grid h-11 w-11 place-items-center rounded-full bg-[var(--color-surface-2)] text-[var(--color-fg-muted)] transition-colors group-hover:bg-[var(--color-surface-3)] group-hover:text-[var(--color-fg)]"
					>
						<IconPlus class="size-[18px]" stroke-width="1.8" />
					</div>
					<p class="mt-3 font-mono text-[12px] tracking-[0.04em] text-[var(--color-fg-muted)] transition-colors group-hover:text-[var(--color-fg)]">
						{m.servers_add_card()}
					</p>
				</a>
			{/if}
		</div>
	{/if}
</div>
