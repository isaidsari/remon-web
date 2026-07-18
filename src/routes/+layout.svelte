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
	import { m } from '$lib/paraglide/messages';

	let { children } = $props();

	// A monitoring dashboard is exactly the kind of tab that stays open for
	// weeks — without these checks a deployed update would never be noticed,
	// since the browser only looks for a new SW on page load.
	const SW_UPDATE_INTERVAL_MS = 60 * 60 * 1000;

	const { needRefresh, updateServiceWorker } = useRegisterSW({
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
		onRegisterError(e) {
			console.warn('SW registration failed', e);
		}
	});

	onMount(() => {
		applyTheme(getTheme());
		applyHtmlLang();
		void loadEcharts().catch(() => {
			/* no-op — chart components will retry on mount */
		});
	});

	// View Transitions API — animation rules in app.css; no-ops on unsupported browsers.
	onNavigate((navigation) => {
		if (!('startViewTransition' in document)) return;
		return new Promise((resolve) => {
			document.startViewTransition(async () => {
				resolve();
				await navigation.complete;
			});
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

{#if $needRefresh}
	<div
		role="status"
		aria-live="polite"
		class="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-2.5 text-sm shadow-lg"
	>
		<span class="text-[var(--color-fg-muted)]">{m.update_available()}</span>
		<button
			onclick={() => needRefresh.set(false)}
			class="text-[var(--color-fg-subtle)] transition hover:text-[var(--color-fg)]"
		>
			{m.common_dismiss()}
		</button>
		<button
			onclick={() => updateServiceWorker(true)}
			class="rounded-md bg-[var(--color-accent)] px-3 py-1 text-xs font-medium text-[var(--color-accent-fg)] transition hover:bg-[var(--color-accent-hover)]"
		>
			{m.update_reload()}
		</button>
	</div>
{/if}

<Toaster />
<ConfirmDialog />
