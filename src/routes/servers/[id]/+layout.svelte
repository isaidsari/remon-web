<script lang="ts">
	import type { Component } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { profiles } from '$lib/stores/profiles.svelte';
	import { connections } from '$lib/stores/connections.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import { cn } from '$lib/utils/cn';
	import { applyAccent, clearAccent } from '$lib/utils/accent';
	import type { LiveTone } from '$lib/utils/connTone';

	import { sidebar } from '$lib/stores/sidebar.svelte';
	import IconChevronLeft from '~icons/lucide/chevron-left';
	import IconSparkles from '~icons/lucide/sparkles';
	import IconLayoutDashboard from '~icons/lucide/layout-dashboard';
	import IconLineChart from '~icons/lucide/line-chart';
	import IconList from '~icons/lucide/list';
	import IconActivity from '~icons/lucide/activity';
	import IconStethoscope from '~icons/lucide/stethoscope';
	import IconHeartPulse from '~icons/lucide/heart-pulse';
	import IconContainer from '~icons/lucide/container';
	import IconTriangleAlert from '~icons/lucide/triangle-alert';
	import IconBell from '~icons/lucide/bell';
	import IconSettings from '~icons/lucide/settings';
	import IconSlidersHorizontal from '~icons/lucide/sliders-horizontal';
	import { m } from '$lib/paraglide/messages';

	let { children } = $props();

	let id = $derived(page.params.id ?? '');
	let profile = $derived(id ? profiles.byId(id) : undefined);
	let conn = $derived(profile ? connections.connect(profile) : null);
	let basePath = $derived(`/servers/${id}`);
	let currentPath = $derived(page.url.pathname);

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

	type NavItem = {
		href: string;
		label: string;
		icon: Component;
		enabled: boolean;
		badge?: string;
	};

	let nav = $derived<NavItem[]>([
		{ href: '', label: m.section_overview(), icon: IconLayoutDashboard, enabled: true },
		{ href: '/assistant', label: m.section_assistant(), icon: IconSparkles, enabled: true },
		{ href: '/metrics', label: m.section_metrics(), icon: IconLineChart, enabled: true },
		{ href: '/processes', label: m.section_processes(), icon: IconList, enabled: true },
		{ href: '/services', label: m.section_services(), icon: IconActivity, enabled: true },
		{ href: '/probes', label: m.section_probes(), icon: IconStethoscope, enabled: true },
		{ href: '/heartbeats', label: m.section_heartbeats(), icon: IconHeartPulse, enabled: true },
		{ href: '/docker', label: m.section_docker(), icon: IconContainer, enabled: true },
		{ href: '/alerts', label: m.section_alerts(), icon: IconTriangleAlert, enabled: true },
		{ href: '/notifications', label: m.section_notifications(), icon: IconBell, enabled: true },
		{ href: '/config', label: m.section_config(), icon: IconSettings, enabled: true },
		{ href: '/settings', label: m.section_settings(), icon: IconSlidersHorizontal, enabled: true }
	]);

	function isActive(item: NavItem): boolean {
		const target = basePath + item.href;
		if (item.href === '') return currentPath === basePath;
		return currentPath === target || currentPath.startsWith(target + '/');
	}

	// Prefetch on hover/focus: client has 5 s GET cache so the destination page renders without an extra round-trip.
	function prefetch(item: NavItem) {
		if (!conn?.isAuthenticated || !item.enabled) return;
		const c = conn.client;
		switch (item.href) {
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
			case '/notifications':
				void c.listChannels().catch(() => {});
				break;
			case '/config':
				void c.getConfig().catch(() => {});
				break;
			// '/metrics' skipped: range query varies by selection, cache would miss.
		}
	}

	let connectionTone = $derived<LiveTone>(
		conn?.isAuthenticated
			? conn.live.status === 'open'
				? 'online'
				: 'idle'
			: conn?.status === 'authenticating'
				? 'connecting'
				: 'offline'
	);
	let connectionLive = $derived(conn?.isAuthenticated === true && conn.live.status === 'open');

	// Auto-close on route change so the drawer doesn't linger after a nav item tap.
	$effect(() => {
		void currentPath;
		sidebar.close();
	});
</script>

{#if !profile}
	<div class="mx-auto max-w-3xl px-6 py-12">
		<Card padding="lg" class="text-center">
			<h2 class="text-lg font-medium">{m.detail_not_found_title()}</h2>
			<p class="mt-2 text-sm text-[var(--color-fg-muted)]">
				{m.detail_not_found_description()}
			</p>
			<div class="mt-6">
				<Button onclick={() => goto('/servers')}>{m.detail_back_to_list()}</Button>
			</div>
		</Card>
	</div>
{:else}
	<div class="relative grid min-h-[calc(100vh-3.5rem)] grid-cols-1 md:grid-cols-[256px_1fr]">
		{#if sidebar.open}
			<button
				type="button"
				onclick={() => sidebar.close()}
				aria-label={m.header_close_menu()}
				class="fixed inset-x-0 bottom-0 top-12 z-30 bg-black/50 backdrop-blur-sm md:hidden"
			></button>
		{/if}
		<aside
			class={cn(
				'flex flex-col border-r border-[var(--color-border)] px-4 py-6',
				'bg-[var(--color-bg)]',
				'md:bg-[var(--color-bg-soft)]/30 md:backdrop-blur-sm',
				'fixed inset-y-0 left-0 top-12 z-40 w-64 transform transition-transform duration-[var(--dur-mid)] ease-[var(--ease-snap)]',
				sidebar.open ? 'translate-x-0' : '-translate-x-full',
				'md:relative md:top-0 md:z-auto md:translate-x-0 md:transition-none'
			)}
		>
			<a
				href="/servers"
				class="group mb-5 inline-flex items-center gap-1.5 px-2 text-[12px] text-[var(--color-fg-subtle)] transition-colors duration-[var(--dur-fast)] hover:text-[var(--color-fg-muted)]"
			>
				<IconChevronLeft
					class="size-[14px] shrink-0 transition-transform duration-[var(--dur-fast)] group-hover:-translate-x-0.5"
					stroke-width="2"
				/>
				{m.detail_back_to_servers()}
			</a>

			<div class="mb-6 px-2">
				<div class="flex items-center gap-2">
					<h2
						class="min-w-0 flex-1 truncate text-[15px] font-semibold tracking-tight leading-tight"
					>
						{profile.name}
					</h2>
					<span
						class={cn(
							'size-2 shrink-0 rounded-full',
							connectionTone === 'online'
								? 'bg-[var(--color-success)] shadow-[0_0_6px_rgba(52,211,153,0.55)]'
								: connectionTone === 'connecting'
									? 'bg-[var(--color-warning)]'
									: connectionTone === 'offline'
										? 'bg-[var(--color-danger)]'
										: 'bg-[var(--color-fg-faint)]'
						)}
						title={connectionLive ? m.detail_status_live() : connectionTone}
						aria-label={connectionLive ? m.detail_status_live() : connectionTone}
					></span>
				</div>
				<p class="mt-1 truncate font-mono text-[12px] text-[var(--color-fg-muted)]">
					{profile.baseUrl}
				</p>
			</div>

			<nav class="flex flex-1 flex-col gap-0.5" aria-label={m.detail_aria_server_sections()}>
				{#each nav as item (item.href)}
					{@const active = isActive(item)}
					{@const Icon = item.icon}
					{#if item.enabled}
						<a
							href={basePath + item.href}
							onmouseenter={() => prefetch(item)}
							onfocus={() => prefetch(item)}
							class={cn(
								'group relative flex items-center gap-3 rounded-[var(--radius-input)] px-3 py-2.5 text-[13.5px] transition-all duration-[var(--dur-fast)] ease-[var(--ease-snap)]',
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
							<span class="flex-1 font-medium">{item.label}</span>
						</a>
					{:else}
						<div
							class="flex cursor-not-allowed items-center gap-3 rounded-[var(--radius-input)] px-3 py-2.5 text-[13.5px] text-[var(--color-fg-subtle)]/60"
							title={m.detail_disabled_tooltip()}
						>
							<Icon class="size-[17px] shrink-0" stroke-width="2" />
							<span class="flex-1">{item.label}</span>
							{#if item.badge}
								<span
									class="rounded-full bg-[var(--color-surface-2)] px-2 py-0.5 font-mono text-[9px] tracking-wide"
									>{item.badge}</span
								>
							{/if}
						</div>
					{/if}
				{/each}
			</nav>
		</aside>

		<main class="overflow-x-hidden">
			{@render children()}
		</main>
	</div>
{/if}
