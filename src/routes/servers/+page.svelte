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
	import IconSearch from '~icons/lucide/search';
	import IconX from '~icons/lucide/x';
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
				void conn.fetchSystemInfo().catch(() => {
					/* not critical */
				});
			}
		});
	});

	let q = $state('');
	let filtered = $derived.by(() => {
		const needle = q.trim().toLowerCase();
		if (!needle) return profiles.list;
		return profiles.list.filter(
			(p) => p.name.toLowerCase().includes(needle) || p.baseUrl.toLowerCase().includes(needle)
		);
	});

	let toneCounts = $state({ connected: 0, connecting: 0, offline: 0 });
	$effect(() => {
		const counts = { connected: 0, connecting: 0, offline: 0 };
		for (const p of profiles.list) {
			const conn = connections.connect(p);
			if (conn.isAuthenticated) counts.connected++;
			else if (conn.status === 'authenticating') counts.connecting++;
			else counts.offline++;
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

<div class="app-content mx-auto max-w-6xl px-4 py-7 sm:px-6 sm:py-10">
	<header class="mb-7 flex flex-wrap items-center justify-between gap-4 sm:mb-9">
		<div class="min-w-0">
			<h1 class="flex items-center gap-2.5 text-2xl font-semibold tracking-tight">
				{m.servers_title()}
				<span
					class="rounded-md bg-[var(--color-surface-2)] px-2 py-0.5 font-mono text-xs font-medium text-[var(--color-fg-subtle)] shadow-[inset_0_0_0_1px_var(--color-border)]"
				>
					{profiles.list.length}
				</span>
			</h1>
			<p class="mt-2 text-sm text-[var(--color-fg-subtle)]">{m.servers_description()}</p>
		</div>

		{#if profiles.list.length > 0}
			<Button onclick={() => goto('/servers/new')} class="h-10 shrink-0">
				<IconPlus class="size-4" aria-hidden="true" />
				{m.servers_add_card()}
			</Button>
		{/if}
	</header>

	{#if profiles.list.length > 0}
		<div
			class="mb-5 flex flex-col gap-4 border-b border-[var(--color-border)] pb-5 sm:flex-row sm:items-center sm:justify-between"
		>
			<div class="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-[var(--color-fg-muted)]">
				<span class="inline-flex items-center gap-2">
					<span class="size-1.5 rounded-full bg-[var(--color-success)]" aria-hidden="true"></span>
					{m.servers_connected_count({ count: toneCounts.connected })}
				</span>
				{#if toneCounts.connecting > 0}
					<span class="inline-flex items-center gap-2">
						<span class="size-1.5 rounded-full bg-[var(--color-warning)]" aria-hidden="true"></span>
						{m.servers_connecting_count({ count: toneCounts.connecting })}
					</span>
				{/if}
				{#if toneCounts.offline > 0}
					<span class="inline-flex items-center gap-2 text-[var(--color-danger)]">
						<span class="size-1.5 rounded-full bg-current" aria-hidden="true"></span>
						{m.servers_offline_count({ count: toneCounts.offline })}
					</span>
				{/if}
			</div>
			<div class="relative w-full sm:w-64">
				<IconSearch
					class="pointer-events-none absolute top-3 left-3 size-4 text-[var(--color-fg-subtle)]"
					aria-hidden="true"
				/>
				<Input
					type="search"
					aria-label={m.servers_search_label()}
					placeholder={m.servers_search_label()}
					bind:value={q}
					class="h-10 pr-10 pl-9 [&::-webkit-search-cancel-button]:appearance-none"
				/>
				{#if q}
					<button
						type="button"
						onclick={() => (q = '')}
						aria-label={m.servers_clear_search()}
						class="absolute top-0 right-0 grid size-10 place-items-center rounded-[var(--radius-input)] text-[var(--color-fg-subtle)] hover:text-[var(--color-fg)]"
					>
						<IconX class="size-4" aria-hidden="true" />
					</button>
				{/if}
			</div>
		</div>
	{/if}

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
		<div
			class="rounded-[var(--radius-card)] border border-dashed border-[var(--color-border)] bg-[var(--color-surface)] px-6 py-14 text-center text-sm text-[var(--color-fg-muted)]"
		>
			<IconSearch class="mx-auto mb-4 size-6 text-[var(--color-fg-subtle)]" aria-hidden="true" />
			<p role="status">{m.servers_no_match({ q })}</p>
			<Button variant="secondary" onclick={() => (q = '')} class="mt-5 h-10"
				>{m.servers_clear_search()}</Button
			>
		</div>
	{:else}
		<div class="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
			{#each filtered as p (p.id)}
				<ServerCard profile={p} conn={connections.connect(p)} onRemove={(e) => remove(p, e)} />
			{/each}
		</div>
	{/if}
</div>
