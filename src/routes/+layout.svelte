<script lang="ts">
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import Toaster from '$lib/components/ui/Toaster.svelte';
	import ConfirmDialog from '$lib/components/ui/ConfirmDialog.svelte';
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
	import { fly } from 'svelte/transition';
	import IconDownload from '~icons/lucide/download';
	import { m } from '$lib/paraglide/messages';

	let { children } = $props();

	const queryClient = createQueryClient();

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
	<link rel="icon" href={favicon} />
	<title>Remon</title>
</svelte:head>

<QueryClientProvider client={queryClient}>
	<div class="app-content flex min-h-screen flex-col text-[var(--color-fg)]">
		{#if showChrome}
			<Header />
		{/if}
		<main class="flex-1">
			{#if showContent}
				{@render children()}
			{/if}
		</main>
	</div>
</QueryClientProvider>

{#if $needRefresh}
	<!-- Bottom-centre, but no longer whispering: an accent edge, an icon and a
	     slide-in, because the previous flat surface-2 bar read as chrome and
	     went unnoticed on a busy dashboard. -->
	<div
		role="status"
		aria-live="polite"
		transition:fly={{ y: 12, duration: 200 }}
		class="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-lg bg-[var(--color-surface-2)] px-4 py-2.5 text-sm shadow-lg shadow-black/20 ring-1 ring-[var(--color-accent)]/40"
	>
		<IconDownload class="size-[15px] shrink-0 text-[var(--color-accent)]" stroke-width="2.25" />
		<span class="font-medium text-[var(--color-fg)]">{m.update_available()}</span>
		<button
			onclick={() => needRefresh.set(false)}
			class="text-[var(--color-fg-subtle)] transition hover:text-[var(--color-fg)]"
		>
			{m.common_dismiss()}
		</button>
		<button
			onclick={applyUpdate}
			disabled={applying}
			class="rounded-md bg-[var(--color-accent)] px-3 py-1 text-xs font-medium text-[var(--color-accent-fg)] transition hover:bg-[var(--color-accent-hover)] disabled:opacity-60"
		>
			{applying ? m.update_reloading() : m.update_reload()}
		</button>
	</div>
{/if}

<Toaster />
<ConfirmDialog />
