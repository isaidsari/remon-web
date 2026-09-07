<script lang="ts">
	import { untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import Card from '$lib/components/ui/Card.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import BundleView from '$lib/components/incidents/BundleView.svelte';
	import IconBotMessageSquare from '~icons/lucide/bot-message-square';
	import { profiles } from '$lib/stores/profiles.svelte';
	import { connections } from '$lib/stores/connections.svelte';
	import { ApiError } from '$lib/api/error';
	import { fmtNumber } from '$lib/utils/format';
	import { m } from '$lib/paraglide/messages';
	import type { IncidentDto } from '$lib/types/api';
	import IconChevronLeft from '~icons/lucide/chevron-left';

	let id = $derived(page.params.id ?? '');
	let iid = $derived(Number(page.params.iid ?? ''));
	let profile = $derived(id ? profiles.byId(id) : undefined);
	let conn = $derived(profile ? connections.connect(profile) : null);

	let incident = $state<IncidentDto | null>(null);
	let error = $state<string | null>(null);
	let busy = $state(true);

	$effect(() => {
		const c = conn;
		const target = iid;
		if (!c?.isAuthenticated || !Number.isFinite(target)) return;
		untrack(() => {
			busy = true;
			c.client
				.getIncident(target)
				.then((res) => {
					incident = res;
					error = null;
				})
				.catch((e) => {
					error = e instanceof ApiError ? e.userMessage : String(e);
				})
				.finally(() => (busy = false));
		});
	});

	function investigate() {
		const q = encodeURIComponent(m.incident_ask_prompt({ id: iid }));
		goto(`/servers/${id}/assistant?ask=${q}`);
	}

	// Alert captures name their rule; manual ones carry the operator's reason.
	let title = $derived(incident?.rule_name ?? incident?.reason ?? m.incident_title());
	let capturedAt = $derived(incident ? new Date(incident.created_at * 1000).toLocaleString() : '');
</script>

{#if profile}
	<div class="px-4 py-6 md:px-8 md:py-8">
		<button
			type="button"
			onclick={() => goto(`/servers/${id}/incidents`)}
			class="mb-5 inline-flex items-center gap-1.5 text-xs text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]"
		>
			<IconChevronLeft class="size-[14px]" stroke-width="2" />
			{m.incident_back()}
		</button>

		{#if incident}
			<header class="mb-6 flex items-start justify-between gap-4">
				<div class="min-w-0">
					<h1 class="truncate text-2xl font-semibold tracking-tight">{title}</h1>
					<p
						class="text-2xs mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[var(--color-fg-muted)]"
					>
						<span>{capturedAt}</span>
						<span class="text-[var(--color-fg-subtle)]">
							{incident.trigger_kind === 'alert'
								? m.incident_trigger_alert()
								: m.incident_trigger_manual()}
							· {incident.category}
						</span>
						{#if incident.label_set}
							<span class="text-[var(--color-fg-subtle)]">{incident.label_set}</span>
						{/if}
						{#if incident.metric_value != null}
							<span class="text-[var(--color-fg)] tabular-nums">
								{fmtNumber(incident.metric_value, 2)}
							</span>
						{/if}
					</p>
				</div>

				<!-- The daemon's assistant already has an `incident_detail` tool, so it
				     is handed the id and fetches the bundle itself. -->
				<Button variant="secondary" size="sm" class="shrink-0" onclick={investigate}>
					<IconBotMessageSquare class="size-4" stroke-width="2" />
					{m.incident_investigate()}
				</Button>
			</header>

			<div class="grid grid-cols-1 gap-4 xl:grid-cols-2">
				<Card>
					<h2 class="mb-3 text-sm font-medium text-[var(--color-fg)]">
						{m.incident_at_capture()}
					</h2>
					<BundleView bundle={incident.bundle} />
				</Card>

				<!-- Same shape, one minute on. The point is the comparison, so it sits
				     beside the capture rather than below it. -->
				<Card>
					<h2 class="mb-3 text-sm font-medium text-[var(--color-fg)]">{m.incident_after()}</h2>
					{#if incident.after_bundle}
						<BundleView bundle={incident.after_bundle} compact baseline={incident.bundle} />
					{:else}
						<p class="text-xs text-[var(--color-fg-subtle)]">{m.incident_after_missing()}</p>
					{/if}
				</Card>
			</div>
		{:else if busy}
			<Card padding="lg">
				<p class="text-sm text-[var(--color-fg-muted)]">{m.incident_loading()}</p>
			</Card>
		{:else}
			<Card padding="lg">
				<p class="text-sm text-[var(--color-fg-muted)]">{error ?? m.incident_not_found()}</p>
			</Card>
		{/if}
	</div>
{/if}
