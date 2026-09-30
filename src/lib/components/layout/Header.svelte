<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { vault } from '$lib/vault/store.svelte';
	import { profiles } from '$lib/stores/profiles.svelte';
	import { sidebar } from '$lib/stores/sidebar.svelte';
	import { sectionLabel } from '$lib/nav';
	import { WEB_VERSION } from '$lib/version';
	import { m } from '$lib/paraglide/messages';
	import Button from '$lib/components/ui/Button.svelte';
	import BrandMark from './BrandMark.svelte';
	import IconLock from '~icons/lucide/lock';
	import IconChevronRight from '~icons/lucide/chevron-right';
	import { cn } from '$lib/utils/cn';

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
	class="sticky top-0 z-30 flex h-[var(--app-header-height)] items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-bg)]/80 px-4 pt-[env(safe-area-inset-top)] backdrop-blur-xl sm:px-6"
>
	<div class="flex min-w-0 items-center gap-2 sm:gap-3">
		{#if activeServerId}
			<!-- On phones the mark's three units double as the menu button. -->
			<button
				type="button"
				onclick={() => sidebar.toggle()}
				aria-label={sidebar.open ? m.header_close_menu() : m.header_open_menu()}
				aria-expanded={sidebar.open}
				class={cn(
					'-mx-2.5 grid size-11 shrink-0 place-items-center rounded-md transition active:scale-90 md:hidden',
					sidebar.open ? 'text-[var(--color-accent)]' : 'text-[var(--color-fg)]'
				)}
			>
				<BrandMark />
			</button>
		{/if}
		<a href="/servers" class="group flex shrink-0 items-center gap-2 text-[var(--color-fg)]">
			<span class={cn('contents', activeServerId && 'max-md:hidden')}><BrandMark /></span>
			<span class="flex items-baseline gap-1.5">
				<span
					class="font-mono text-sm font-semibold tracking-[0.02em] transition-colors group-hover:text-[var(--color-accent)]"
				>
					remon
				</span>
				<span
					class="text-2xs hidden font-mono text-[var(--color-fg-subtle)] sm:inline"
					title={m.header_build_version_title()}
				>
					v{WEB_VERSION}
				</span>
			</span>
		</a>

		{#if activeProfile && activeSection}
			<IconChevronRight class="size-3 shrink-0 text-[var(--color-fg-faint)]" stroke-width="2" />
			<a
				href={`/servers/${activeProfile.id}`}
				class="text-md min-w-0 truncate font-medium text-[var(--color-fg)] transition hover:text-[var(--color-accent)]"
			>
				{activeProfile.name}
			</a>
			<span class="text-md shrink-0 text-[var(--color-fg-faint)]">/</span>
			<span class="text-md min-w-0 truncate text-[var(--color-fg-muted)]">
				{sectionLabel(activeSection)}
			</span>
		{:else if onServerListPage && profiles.list.length > 0}
			<IconChevronRight class="size-3 shrink-0 text-[var(--color-fg-faint)]" stroke-width="2" />
			<span class="text-md truncate text-[var(--color-fg-muted)]">
				{profiles.list.length === 1
					? m.header_servers_one()
					: m.header_servers_other({ count: profiles.list.length })}
			</span>
		{/if}
	</div>

	<div class="ml-2 flex shrink-0 items-center gap-2">
		{#if vault.isOpen}
			<Button
				variant="ghost"
				size="sm"
				onclick={lock}
				aria-label={m.common_lock()}
				class="max-sm:size-11 max-sm:px-0"
			>
				<IconLock class="size-[13px]" stroke-width="1.9" />
				<span class="hidden sm:inline">{m.common_lock()}</span>
			</Button>
		{/if}
	</div>
</header>
