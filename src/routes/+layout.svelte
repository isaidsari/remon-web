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

	let { children } = $props();

	onMount(() => {
		applyTheme(getTheme());
		applyHtmlLang();
		void loadEcharts().catch(() => {
			/* no-op — chart components will retry on mount */
		});
		if ('serviceWorker' in navigator) {
			void navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch((err) => {
				console.warn('Service worker registration failed:', err);
			});
		}
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
	let showChrome = $derived(!NO_CHROME_ROUTES.some((p) => path.startsWith(p)));

	let routeNeedsVault = $derived(!NO_CHROME_ROUTES.some((p) => path.startsWith(p)));
	// Suppress content until vault matches — prevents a locked-state flash before redirect.
	let showContent = $derived(!routeNeedsVault || vault.isOpen);

	$effect(() => {
		const state = vault.state;
		const p = path;

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

<Toaster />
<ConfirmDialog />
