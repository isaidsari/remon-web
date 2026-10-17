<script lang="ts">
	import { page } from '$app/state';
	import { useServer } from '$lib/server-scope';
	import Banner from '$lib/components/ui/Banner.svelte';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import ScreenView from '$lib/components/screen/ScreenView.svelte';
	import { decodeScreen } from '$lib/screen/spec';
	import { spanLabel } from '$lib/screen/plan';
	import { m } from '$lib/paraglide/messages';

	// A composed screen as a page of its own. The spec rides in `?s=` as
	// base64url JSON, so a screen is a link: shareable, bookmarkable, and
	// nothing stored anywhere.
	let { conn } = $derived(useServer());

	let encoded = $derived(page.url.searchParams.get('s') ?? '');
	let screen = $derived(encoded ? decodeScreen(encoded) : null);
</script>

<div class="px-4 py-6 md:px-8 md:py-8">
	{#if screen}
		<PageHeader
			title={screen.title}
			subtitle={screen.window ? spanLabel({ window: screen.window }) : undefined}
		/>
		<ScreenView {screen} {conn} />
	{:else}
		<Banner variant="danger">{m.screen_invalid_link()}</Banner>
	{/if}
</div>
