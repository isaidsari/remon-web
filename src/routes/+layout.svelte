<script lang="ts">
	import '../app.css';
	import Toaster from '$lib/components/ui/Toaster.svelte';
	import ConfirmDialog from '$lib/components/ui/ConfirmDialog.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Header from '$lib/components/layout/Header.svelte';
	import { vault } from '$lib/vault/store.svelte';
	import { goto, onNavigate } from '$app/navigation';
	import { page } from '$app/state';
	import { applyTheme, getTheme } from '$lib/utils/theme';
	import { applyHtmlLang } from '$lib/utils/lang';
	import { loadEcharts } from '$lib/charts/echarts-lazy';
	import { onMount } from 'svelte';
	import { useRegisterSW } from 'virtual:pwa-register/svelte';
	import { QueryClientProvider } from '@tanstack/svelte-query';
	import { createQueryClient } from '$lib/api/query';
	import { toast } from '$lib/stores/toast.svelte';
	import { fade } from 'svelte/transition';
	import IconDownload from '~icons/lucide/download';
	import { m } from '$lib/paraglide/messages';
	import { tab } from '$lib/brand/tab.svelte';
	import { faviconSvg, svgDataUrl } from '$lib/brand/mark';
	import { clearBadge } from '$lib/utils/badge';

	let { children } = $props();

	const queryClient = createQueryClient();

	// Looking at the app counts as having seen the alerts the badge was counting.
	$effect(() => {
		const onVisible = () => {
			if (document.visibilityState === 'visible') void clearBadge();
		};
		onVisible();
		document.addEventListener('visibilitychange', onVisible);
		return () => document.removeEventListener('visibilitychange', onVisible);
	});

	// app.html's icon is the pre-hydration default; from here on it follows the tab state.
	$effect(() => {
		const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
		if (link) link.href = svgDataUrl(faviconSvg(tab.values, tab.status));
	});

	// This tab stays open for weeks; the browser only looks for a new SW on load.
	const SW_UPDATE_INTERVAL_MS = 60 * 60 * 1000;

	// `updateServiceWorker` from the plugin is deliberately unused: it routes
	// through the plugin's own registration, and when that registration failed
	// it resolves to `sendSkipWaitingMessage?.()` — a button that silently does
	// nothing. `applyUpdate` below talks to the registration the browser
	// actually holds, so it works either way and always does something visible.
	const { needRefresh } = useRegisterSW({
		onRegisteredSW(_url, registration) {
			if (!registration) return;
			const check = () => {
				if (navigator.onLine) void registration.update().catch(() => {});
			};
			setInterval(check, SW_UPDATE_INTERVAL_MS);
			// Returning to a backgrounded tab is the natural "am I stale?" moment.
			document.addEventListener('visibilitychange', () => {
				if (document.visibilityState === 'visible') check();
			});
		},
		// A console warning nobody reads is how a broken registration went
		// unnoticed for a whole release. Say it out loud instead.
		onRegisterError(e) {
			console.warn('SW registration failed', e);
			toast.warning(m.update_sw_unavailable(), {
				description: e instanceof Error ? e.message : String(e)
			});
		}
	});

	let applying = $state(false);

	/** Hand the waiting worker its cue, then reload when it takes over. */
	async function applyUpdate() {
		if (applying) return;
		applying = true;
		const reg = await navigator.serviceWorker?.getRegistration().catch(() => undefined);
		if (!reg?.waiting) {
			// Nothing is waiting: the banner outlived its worker, or the update
			// already activated. A plain reload lands on whatever is current.
			location.reload();
			return;
		}
		navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), {
			once: true
		});
		reg.waiting.postMessage({ type: 'SKIP_WAITING' });
		// If the worker never answers, the button must not sit there spinning.
		setTimeout(() => location.reload(), 3000);
	}

	onMount(() => {
		applyTheme(getTheme());
		applyHtmlLang();

		// ~1 MB to parse, already cached by the SW — warm it off the critical path.
		const warm = () =>
			void loadEcharts().catch(() => {
				/* no-op — chart components will retry on mount */
			});
		if (typeof requestIdleCallback === 'function') requestIdleCallback(warm, { timeout: 3000 });
		else setTimeout(warm, 1200);
	});

	// View Transitions API — animation rules in app.css; no-ops on unsupported browsers.
	onNavigate((navigation) => {
		if (!('startViewTransition' in document)) return;
		if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
		// Query/hash changes update the current page without a page transition.
		if (navigation.from?.url.pathname === navigation.to?.url.pathname) return;
		return new Promise((resolve) => {
			let transition: ViewTransition;
			try {
				transition = document.startViewTransition(async () => {
					resolve();
					await navigation.complete;
				});
			} catch {
				// Document not fully active. Resolving is load-bearing: an unresolved
				// promise stalls the navigation.
				resolve();
				return;
			}
			// An abandoned transition (hidden tab, superseded navigation) rejects
			// both promises. Harmless, but noisy if unhandled.
			transition.ready.catch(() => {});
			transition.finished.catch(() => {});
		});
	});

	const NO_CHROME_ROUTES = ['/setup', '/unlock'];

	let path = $derived(page.url.pathname);
	// Setup/unlock are the only chrome-less, vault-independent routes.
	let isProtectedRoute = $derived(!NO_CHROME_ROUTES.some((p) => path.startsWith(p)));
	let showChrome = $derived(isProtectedRoute);
	// Suppress content until vault matches — prevents a locked-state flash before redirect.
	let showContent = $derived(!isProtectedRoute || vault.isOpen);

	$effect(() => {
		const state = vault.state;
		const p = path;

		// 'pending' = async auto-unlock in flight; don't bounce through /unlock.
		if (state === 'pending') return;

		if (state === 'none' && p !== '/setup') {
			goto('/setup', { replaceState: true });
		} else if (state === 'locked' && p !== '/unlock') {
			goto('/unlock', { replaceState: true });
		} else if (state === 'open' && (p === '/setup' || p === '/unlock' || p === '/')) {
			goto('/servers', { replaceState: true });
		}
	});
</script>

<svelte:head>
	<title>{tab.title}</title>
</svelte:head>

<QueryClientProvider client={queryClient}>
	<div class="app-content safe-x flex min-h-screen flex-col text-[var(--color-fg)]">
		{#if showChrome}
			<Header />
		{/if}
		<main class="flex-1" style:view-transition-name={page.params.id ? 'none' : 'page-content'}>
			{#if showContent}
				{@render children()}
			{/if}
		</main>
	</div>
</QueryClientProvider>

{#if $needRefresh}
	<div
		transition:fade={{ duration: 140 }}
		class="fixed right-4 bottom-[max(1rem,env(safe-area-inset-bottom))] left-4 z-40 rounded-[var(--radius-card)] bg-[var(--color-surface)] p-4 shadow-lg ring-1 shadow-black/15 ring-[var(--color-border)] sm:left-auto sm:w-80"
	>
		<div class="flex items-start gap-3" role="status" aria-live="polite" aria-atomic="true">
			<IconDownload
				class="mt-0.5 size-4 shrink-0 text-[var(--color-fg-muted)]"
				aria-hidden="true"
			/>
			<div class="min-w-0">
				<p class="text-sm font-medium text-[var(--color-fg)]">
					{applying ? m.update_reloading() : m.update_available()}
				</p>
				<p class="mt-1 text-xs leading-relaxed text-[var(--color-fg-muted)]">
					{m.update_description()}
				</p>
			</div>
		</div>
		<div class="mt-4 flex flex-wrap justify-end gap-2">
			<Button variant="ghost" size="sm" disabled={applying} onclick={() => needRefresh.set(false)}>
				{m.update_later()}
			</Button>
			<Button size="sm" onclick={applyUpdate} loading={applying}>
				{applying ? m.update_reloading() : m.update_reload()}
			</Button>
		</div>
	</div>
{/if}

<Toaster />
<ConfirmDialog />
