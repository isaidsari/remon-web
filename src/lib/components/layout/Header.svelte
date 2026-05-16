<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { vault } from '$lib/vault/store.svelte';
	import { profiles } from '$lib/stores/profiles.svelte';
	import { sidebar } from '$lib/stores/sidebar.svelte';
	import { WEB_VERSION } from '$lib/version';
	import { m } from '$lib/paraglide/messages';
	import Button from '$lib/components/ui/Button.svelte';
	import IconLock from '~icons/lucide/lock';
	import IconChevronRight from '~icons/lucide/chevron-right';
	import IconPanelLeft from '~icons/lucide/panel-left';

	// Static switch: paraglide messages are tree-shaken, so dynamic key lookup would include all messages.
	function sectionLabel(name: string): string {
		switch (name) {
			case 'overview': return m.section_overview();
			case 'metrics': return m.section_metrics();
			case 'services': return m.section_services();
			case 'probes': return m.section_probes();
			case 'docker': return m.section_docker();
			case 'settings': return m.section_settings();
			case 'notifications': return m.section_notifications();
			case 'config': return m.section_config();
			case 'alerts': return m.section_alerts();
			case 'processes': return m.section_processes();
			default: return name;
		}
	}

	function lock() {
		vault.lock();
		goto('/unlock', { replaceState: true });
	}

	let path = $derived(page.url.pathname);
	let activeServerId = $derived.by(() => {
		const m = path.match(/^\/servers\/([^/]+)/);
		const id = m?.[1];
		// `/servers/new` is a route, not a profile — exclude it.
		return id && id !== 'new' ? id : null;
	});
	let activeProfile = $derived(activeServerId ? profiles.byId(activeServerId) : undefined);
	let activeSection = $derived.by(() => {
		if (!activeServerId) return null;
		const segs = path.split('/').filter(Boolean); // ["servers", "<id>", "<section>?"]
		return segs[2] ?? 'overview';
	});

	let onServerListPage = $derived(path === '/servers');
</script>

<header
	class="sticky top-0 z-30 flex h-12 items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-bg)]/80 px-4 backdrop-blur-xl sm:px-6"
>
	<div class="flex min-w-0 items-center gap-2 sm:gap-3">
		{#if activeServerId}
			<button
				type="button"
				onclick={() => sidebar.toggle()}
				aria-label={sidebar.open ? m.header_close_menu() : m.header_open_menu()}
				class="-ml-1 grid h-8 w-8 shrink-0 place-items-center rounded-md text-[var(--color-fg-muted)] transition hover:bg-[var(--color-surface-2)] hover:text-[var(--color-fg)] md:hidden"
			>
				<IconPanelLeft class="size-[16px]" stroke-width="2" />
			</button>
		{/if}
		<a href="/servers" class="group flex shrink-0 items-baseline gap-1.5">
			<span class="font-mono text-[14px] font-semibold tracking-[0.02em] text-[var(--color-fg)] transition-colors group-hover:text-[var(--color-accent)]">
				remon
			</span>
			<span
				class="hidden font-mono text-[11px] text-[var(--color-fg-subtle)] sm:inline"
				title={m.header_build_version_title()}
			>
				v{WEB_VERSION}
			</span>
		</a>

		{#if activeProfile && activeSection}
			<IconChevronRight class="size-3 shrink-0 text-[var(--color-fg-faint)]" stroke-width="2" />
			<a
				href={`/servers/${activeProfile.id}`}
				class="min-w-0 truncate text-[13px] font-medium text-[var(--color-fg)] transition hover:text-[var(--color-accent)]"
			>
				{activeProfile.name}
			</a>
			<span class="shrink-0 text-[13px] text-[var(--color-fg-faint)]">/</span>
			<span class="min-w-0 truncate text-[13px] text-[var(--color-fg-muted)]">
				{sectionLabel(activeSection)}
			</span>
		{:else if onServerListPage && profiles.list.length > 0}
			<IconChevronRight class="size-3 shrink-0 text-[var(--color-fg-faint)]" stroke-width="2" />
			<span class="truncate text-[13px] text-[var(--color-fg-muted)]">
				{profiles.list.length === 1
					? m.header_servers_one()
					: m.header_servers_other({ count: profiles.list.length })}
			</span>
		{/if}
	</div>

	<div class="ml-2 flex shrink-0 items-center gap-2">
		{#if vault.isOpen}
			<Button variant="ghost" size="sm" onclick={lock} aria-label={m.common_lock()}>
				<IconLock class="size-[13px]" stroke-width="1.9" />
				<span class="hidden sm:inline">{m.common_lock()}</span>
			</Button>
		{/if}
	</div>
</header>
