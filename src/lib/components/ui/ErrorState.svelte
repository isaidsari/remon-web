<script lang="ts">
	import type { ApiError } from '$lib/api/error';
	import Banner from './Banner.svelte';
	import Button from './Button.svelte';
	import { m } from '$lib/paraglide/messages';

	interface Props {
		error: ApiError;
		onRetry?: () => void;
		/** Overrides the generic "failed to load" title. */
		title?: string;
		class?: string;
	}

	let { error, onRetry, title, class: klass = '' }: Props = $props();
</script>

{#if error.isNotSupported}
	<Banner variant="info" title={m.error_not_supported_title()} class={klass}>
		{error.userMessage}
	</Banner>
{:else if error.isForbidden}
	<Banner variant="warning" title={m.error_forbidden_title()} class={klass}>
		{error.userMessage}
		{m.error_forbidden_hint()}
	</Banner>
{:else}
	<Banner variant="danger" title={title ?? m.error_load_failed_title()} class={klass}>
		{error.userMessage}
		{#snippet actions()}
			{#if onRetry}
				<Button variant="secondary" size="sm" onclick={onRetry}>{m.common_retry()}</Button>
			{/if}
		{/snippet}
	</Banner>
{/if}
