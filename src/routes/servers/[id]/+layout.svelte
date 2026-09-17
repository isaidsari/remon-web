<script lang="ts">
	import { untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { profiles } from '$lib/stores/profiles.svelte';
	import { connections } from '$lib/stores/connections.svelte';
	import { sidebar } from '$lib/stores/sidebar.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { provideServer } from '$lib/server-scope';
	import { NAV_ITEMS } from '$lib/nav';
	import { ApiError } from '$lib/api/error';
	import Button from '$lib/components/ui/Button.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import Spinner from '$lib/components/ui/Spinner.svelte';
	import { cn } from '$lib/utils/cn';
	import { applyAccent, clearAccent } from '$lib/utils/accent';
	import { sessionTone, type LiveTone } from '$lib/utils/connTone';
	import IconChevronLeft from '~icons/lucide/chevron-left';
	import { m } from '$lib/paraglide/messages';

	let { children } = $props();

	let id = $derived(page.params.id ?? '');
	let profile = $derived(id ? profiles.byId(id) : undefined);
	let conn = $derived(profile ? connections.connect(profile) : null);
	let basePath = $derived(`/servers/${id}`);
	let currentPath = $derived(page.url.pathname);

	// Children only render once the profile exists, so the getters can assert.
	provideServer({
		get id() {
			return id;
		},
		get profile() {
			return profile!;
		},
		get conn() {
			return conn!;
		}
	});

	// The server-side name (`server_config.server_name`) is canonical; the
	// profile name is only a local alias used until the first fetch lands.
	let displayName = $derived(conn?.systemInfo?.data?.server_name ?? profile?.name ?? '');

	// One sign-in per server, not one per page; the gate below reports failure.
	$effect(() => {
		if (!conn) return;
		untrack(() => void conn.ensureSignedIn().catch(() => {}));
	});

	$effect(() => {
		if (conn?.isAuthenticated) void conn.fetchSystemInfo().catch(() => {});
	});

	// Restores default accent on unmount so other routes aren't tinted.
	$effect(() => {
		const hex = profile?.accent;
		if (hex) {
			applyAccent(hex);
		} else {
			clearAccent();
		}
		return () => clearAccent();
	});

	// Settings stays reachable while signed out: that is where a rejected
	// credential gets repaired and where a server gets removed.
	let gated = $derived(currentPath !== basePath + '/settings');
	let needsRepair = $derived(conn?.error?.needsRepair === true);

	async function signIn() {
		if (!conn) return;
		try {
			await conn.login();
			toast.success(m.overview_toast_signed_in());
		} catch (e) {
			if (e instanceof ApiError) {
				toast.error(m.overview_toast_signin_failed(), { description: e.userMessage });
			}
		}
	}

	function isActive(path: string): boolean {
		const target = basePath + path;
		if (path === '') return currentPath === basePath;
		return currentPath === target || currentPath.startsWith(target + '/');
	}

	// Prefetch on hover/focus: client has 5 s GET cache so the destination page renders without an extra round-trip.
	function prefetch(path: string) {
		if (!conn?.isAuthenticated) return;
		const c = conn.client;
		switch (path) {
			case '/processes':
				void c.processes().catch(() => {});
				break;
			case '/services':
				void c.listServices().catch(() => {});
				void c.listTimers().catch(() => {});
				void c.listCronJobs().catch(() => {});
				break;
			case '/probes':
				void c.listProbes().catch(() => {});
				break;
			case '/heartbeats':
				void c.listHeartbeats().catch(() => {});
				break;
			case '/docker':
				void c.dockerStatus().catch(() => {});
				void c.listContainers().catch(() => {});
				void c.listImages().catch(() => {});
				break;
			case '/alerts':
				void c.listAlertRules().catch(() => {});
				void c.alertState().catch(() => {});
				void c.alertEvents(100).catch(() => {});
				break;
			case '/actions':
				// A daemon older than the action engine 404s these; the page
				// says so for itself, and a failed prefetch is already silent.
				void c.actionCatalog().catch(() => {});
				void c.listActionBindings().catch(() => {});
				void c.actionRuns({ limit: 100 }).catch(() => {});
				break;
			case '/events':
				void c.events({ limit: 1000 }).catch(() => {});
				break;
			case '/incidents':
				void c.listIncidents(200).catch(() => {});
				break;
			case '/notifications':
				void c.listChannels().catch(() => {});
				break;
			case '/config':
				void c.getConfig().catch(() => {});
				break;
			// '/metrics' skipped: range query varies by selection, cache would miss.
		}
	}

	// Beside the server's name this answers one question: can I reach it. Whether
	// a live stream happens to be open is the current page's business.
	let connectionTone = $derived<LiveTone>(conn ? sessionTone(conn) : 'offline');

	let connectionLabel = $derived(
		connectionTone === 'online'
			? m.livebadge_online()
			: connectionTone === 'connecting'
				? m.livebadge_connecting()
				: connectionTone === 'offline'
					? m.livebadge_offline()
					: m.livebadge_idle()
	);

	const toneDot: Record<LiveTone, string> = {
		online: 'bg-[var(--color-success)] shadow-[0_0_6px_rgba(52,211,153,0.55)]',
		connecting: 'bg-[var(--color-warning)]',
		warning: 'bg-[var(--color-warning)]',
		offline: 'bg-[var(--color-danger)]',
		idle: 'bg-[var(--color-fg-faint)]'
	};

	// Auto-close on route change so the drawer doesn't linger after a nav item tap.
	$effect(() => {
		void currentPath;
		sidebar.close();
	});
</script>

{#if !profile}
	<div class="mx-auto max-w-3xl px-6 py-12">
		<EmptyState title={m.detail_not_found_title()} description={m.detail_not_found_description()}>
			<Button onclick={() => goto('/servers')}>{m.detail_back_to_list()}</Button>
		</EmptyState>
	</div>
{:else}
	<div class="relative grid min-h-[calc(100dvh-3rem)] grid-cols-1 md:grid-cols-[256px_1fr]">
		{#if sidebar.open}
			<button
				type="button"
				onclick={() => sidebar.close()}
				aria-label={m.header_close_menu()}
				class="fixed inset-x-0 top-12 bottom-0 z-30 bg-black/50 backdrop-blur-sm md:hidden"
			></button>
		{/if}
		<!-- Sticks under the header and scrolls on its own; content keeps window scroll. -->
		<aside
			class={cn(
				'flex flex-col border-r border-[var(--color-border)] px-4 py-6',
				'overflow-y-auto overscroll-contain',
				'bg-[var(--color-bg)]',
				'md:bg-[var(--color-bg-soft)]/30 md:backdrop-blur-sm',
				'fixed inset-y-0 top-12 left-0 z-40 w-64 transform transition-transform duration-[var(--dur-mid)] ease-[var(--ease-snap)]',
				sidebar.open ? 'translate-x-0' : '-translate-x-full',
				'md:sticky md:top-12 md:bottom-auto md:z-auto md:h-[calc(100dvh-3rem)] md:translate-x-0 md:self-start md:transition-none'
			)}
		>
			<a
				href="/servers"
				class="group mb-5 inline-flex items-center gap-1.5 px-2 text-xs text-[var(--color-fg-subtle)] transition-colors duration-[var(--dur-fast)] hover:text-[var(--color-fg-muted)]"
			>
				<IconChevronLeft
					class="size-[14px] shrink-0 transition-transform duration-[var(--dur-fast)] group-hover:-translate-x-0.5"
					stroke-width="2"
				/>
				{m.detail_back_to_servers()}
			</a>

			<div class="mb-6 px-2">
				<div class="flex items-center gap-2">
					<h2 class="min-w-0 flex-1 truncate text-sm leading-tight font-semibold tracking-tight">
						{displayName}
					</h2>
					<span
						class={cn('size-2 shrink-0 rounded-full', toneDot[connectionTone])}
						title={connectionLabel}
						aria-label={connectionLabel}
					></span>
				</div>
				<p class="mt-1 truncate font-mono text-xs text-[var(--color-fg-muted)]">
					{profile.baseUrl}
				</p>
			</div>

			<nav class="flex flex-1 flex-col gap-0.5" aria-label={m.detail_aria_server_sections()}>
				{#each NAV_ITEMS as item (item.path)}
					{@const active = isActive(item.path)}
					{@const Icon = item.icon}
					<a
						href={basePath + item.path}
						onmouseenter={() => prefetch(item.path)}
						onfocus={() => prefetch(item.path)}
						class={cn(
							'group text-md relative flex items-center gap-3 rounded-[var(--radius-input)] px-3 py-2.5 transition-all duration-[var(--dur-fast)] ease-[var(--ease-snap)]',
							active
								? 'bg-[var(--color-surface)] text-[var(--color-fg)]'
								: 'text-[var(--color-fg-muted)] hover:bg-[var(--color-surface)]/60 hover:text-[var(--color-fg)]'
						)}
					>
						{#if active}
							<span
								class="absolute inset-y-1.5 left-0 w-[2.5px] rounded-r-full bg-[var(--color-accent)]"
								aria-hidden="true"
							></span>
						{/if}
						<Icon
							class={cn(
								'size-[17px] shrink-0 transition-colors',
								active
									? 'text-[var(--color-accent)]'
									: 'text-[var(--color-fg-subtle)] group-hover:text-[var(--color-fg-muted)]'
							)}
							stroke-width="2"
						/>
						<span class="flex-1 font-medium">{item.label()}</span>
					</a>
				{/each}
			</nav>
		</aside>

		<!-- clip, not hidden: hidden makes this a scroll container and breaks sticky. -->
		<main class="min-w-0 overflow-x-clip">
			{#if !gated || conn?.isAuthenticated}
				{@render children()}
			{:else if conn?.status === 'error'}
				<div class="px-4 py-6 md:px-8 md:py-8">
					<Card padding="lg">
						<div class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
							<div>
								<p class="font-medium">
									{needsRepair
										? m.overview_auth_credential_rejected()
										: m.overview_auth_not_signed_in()}
								</p>
								<p class="mt-1 text-sm text-[var(--color-fg-muted)]">
									{needsRepair
										? m.overview_auth_needs_repair_body()
										: m.overview_auth_signin_prompt()}
								</p>
								{#if conn.error}
									<p class="mt-1 text-sm text-[var(--color-danger)]">{conn.error.userMessage}</p>
								{/if}
							</div>
							<div class="flex shrink-0 items-center gap-2">
								{#if needsRepair}
									<Button variant="primary" onclick={() => goto(`/servers/new?replace=${id}`)}>
										{m.overview_auth_repair_button()}
									</Button>
									<Button variant="ghost" onclick={signIn}>{m.overview_auth_retry_button()}</Button>
								{:else}
									<Button onclick={signIn}>{m.overview_auth_signin_button()}</Button>
								{/if}
							</div>
						</div>
					</Card>
				</div>
			{:else}
				<div
					class="flex items-center justify-center gap-2 px-4 py-24 text-sm text-[var(--color-fg-subtle)]"
				>
					<Spinner />
					{m.overview_auth_signing_in()}
				</div>
			{/if}
		</main>
	</div>
{/if}
