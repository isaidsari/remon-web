<script lang="ts">
	import { untrack } from 'svelte';
	import { page } from '$app/state';
	import Card from '$lib/components/ui/Card.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Banner from '$lib/components/ui/Banner.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Field from '$lib/components/ui/Field.svelte';
	import Modal from '$lib/components/ui/Modal.svelte';
	import Skeleton from '$lib/components/ui/Skeleton.svelte';
	import SegmentedControl, { type SegmentOption } from '$lib/components/ui/SegmentedControl.svelte';
	import { profiles } from '$lib/stores/profiles.svelte';
	import { connections } from '$lib/stores/connections.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { ApiError } from '$lib/api/error';
	import { cn } from '$lib/utils/cn';
	import { fmtNumber, fmtRelative } from '$lib/utils/format';
	import { m } from '$lib/paraglide/messages';
	import IconCamera from '~icons/lucide/camera';
	import IconFlame from '~icons/lucide/flame';
	import IconChevronRight from '~icons/lucide/chevron-right';
	import type { IncidentCategory, IncidentSummaryDto } from '$lib/types/api';

	let id = $derived(page.params.id ?? '');
	let profile = $derived(id ? profiles.byId(id) : undefined);
	let conn = $derived(profile ? connections.connect(profile) : null);

	$effect(() => {
		if (!conn) return;
		untrack(() => {
			conn.ensureSignedIn().catch((e) => {
				if (e instanceof ApiError)
					toast.error(m.incidents_load_failed(), { description: e.userMessage });
			});
		});
	});

	// The server caps at 200 and takes no filter but `limit`, so the whole page
	// is fetched once and the trigger filter is applied here.
	const PAGE_LIMIT = 200;

	let incidents = $state<IncidentSummaryDto[] | null>(null);
	let error = $state<ApiError | null>(null);
	let busy = $state(false);

	async function fetchList(bust = false) {
		if (!conn?.isAuthenticated) return;
		busy = true;
		try {
			const res = bust
				? await conn.client.request<{ incidents: IncidentSummaryDto[] }>(
						`/incidents?limit=${PAGE_LIMIT}`,
						{ bypassCache: true }
					)
				: await conn.client.listIncidents(PAGE_LIMIT);
			incidents = res.incidents;
			error = null;
		} catch (e) {
			if (e instanceof ApiError) error = e;
		} finally {
			busy = false;
		}
	}

	$effect(() => {
		if (conn?.isAuthenticated) void fetchList();
	});

	type TriggerFilter = 'all' | 'alert' | 'manual';
	let trigger = $state<TriggerFilter>('all');

	let shown = $derived(
		incidents === null
			? null
			: incidents.filter((i) => trigger === 'all' || i.trigger_kind === trigger)
	);

	// Re-render relative timestamps once a minute, as the timeline does.
	let nowMs = $state(Date.now());
	$effect(() => {
		const t = setInterval(() => (nowMs = Date.now()), 60_000);
		return () => clearInterval(t);
	});

	function categoryLabel(c: IncidentCategory): string {
		switch (c) {
			case 'resource':
				return m.incidents_category_resource();
			case 'availability':
				return m.incidents_category_availability();
			case 'security':
				return m.incidents_category_security();
			default:
				return m.incidents_category_custom();
		}
	}

	// Alert captures name their rule; manual ones carry the operator's reason.
	// Same precedence as the detail page, so a row and its page agree.
	function titleOf(i: IncidentSummaryDto): string {
		return i.rule_name ?? i.reason ?? m.incident_title();
	}

	const triggerOpts: SegmentOption<TriggerFilter>[] = [
		{ value: 'all', label: m.incidents_filter_all() },
		{ value: 'alert', label: m.incidents_filter_alert() },
		{ value: 'manual', label: m.incidents_filter_manual() }
	];

	// ── manual capture ──
	let captureOpen = $state(false);
	let capReason = $state('');
	let capCategory = $state<IncidentCategory>('custom');
	let capturing = $state(false);

	const categoryOpts: SegmentOption<IncidentCategory>[] = [
		{ value: 'resource', label: m.incidents_category_resource() },
		{ value: 'availability', label: m.incidents_category_availability() },
		{ value: 'security', label: m.incidents_category_security() },
		{ value: 'custom', label: m.incidents_category_custom() }
	];

	function openCapture() {
		capReason = '';
		capCategory = 'custom';
		captureOpen = true;
	}

	async function submitCapture() {
		const reason = capReason.trim();
		if (!reason || !conn) return;
		capturing = true;
		try {
			await conn.client.captureIncident({ reason, category: capCategory });
			captureOpen = false;
			toast.success(m.incidents_capture_ok());
			// The row must appear now, so bust the client's GET cache.
			await fetchList(true);
		} catch (e) {
			toast.error(m.incidents_capture_failed(), {
				description: e instanceof ApiError ? e.userMessage : String(e)
			});
		} finally {
			capturing = false;
		}
	}
</script>

<div class="px-4 py-6 md:px-8 md:py-8">
	<header class="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
		<div>
			<h1 class="text-2xl font-semibold tracking-tight">{m.incidents_title()}</h1>
			<p class="mt-1.5 text-sm text-[var(--color-fg-muted)]">{m.incidents_subtitle()}</p>
		</div>
		<div class="flex shrink-0 items-center gap-2">
			<Button variant="secondary" size="sm" onclick={() => fetchList(true)} loading={busy}>
				{m.alerts_action_refresh()}
			</Button>
			<Button variant="primary" size="sm" onclick={openCapture} disabled={!conn?.isAuthenticated}>
				<IconCamera class="size-4" stroke-width="2" />
				{m.incidents_capture()}
			</Button>
		</div>
	</header>

	{#if !conn?.isAuthenticated}
		<Banner variant="warning" title={m.alerts_banner_not_signed_in_title()}>
			{m.alerts_banner_not_signed_in_body()}
		</Banner>
	{:else}
		<div class="mb-4 flex flex-wrap items-center gap-2">
			<SegmentedControl
				value={trigger}
				options={triggerOpts}
				onSelect={(v) => (trigger = v)}
				ariaLabel={m.incidents_filter_all()}
			/>
			{#if shown && shown.length > 0}
				<span class="text-2xs ml-auto text-[var(--color-fg-subtle)] tabular-nums">
					{m.incidents_count({ count: shown.length })}
				</span>
			{/if}
		</div>

		{#if error}
			<!-- Rows already on screen stay put; the banner says they are stale. -->
			<Banner
				variant={incidents === null ? 'danger' : 'warning'}
				title={incidents === null ? m.incidents_load_failed() : m.incidents_refresh_failed()}
				class="mb-4"
			>
				{error.userMessage}
			</Banner>
		{/if}

		<Card padding="none" class="overflow-hidden">
			{#if shown === null}
				<div class="space-y-3 p-4">
					<Skeleton class="h-5 w-full" />
					<Skeleton class="h-5 w-4/5" />
					<Skeleton class="h-5 w-5/6" />
				</div>
			{:else if shown.length === 0}
				<div class="flex flex-col items-center justify-center gap-2 px-4 py-14 text-center">
					<IconCamera class="size-5 text-[var(--color-fg-faint)]" stroke-width="1.75" />
					<p class="text-md text-[var(--color-fg-muted)]">{m.incidents_empty()}</p>
				</div>
			{:else}
				<ul>
					{#each shown as i (i.id)}
						<li class="border-b border-[var(--color-border)] last:border-b-0">
							<a
								href={`/servers/${id}/incidents/${i.id}`}
								class="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-[var(--color-surface-2)]/60"
							>
								<!-- Trigger is the row's first question: did a rule catch this,
								     or did someone stand here and press the button. -->
								{#if i.trigger_kind === 'alert'}
									<IconFlame
										class="size-[15px] shrink-0 text-[var(--color-warning)]"
										stroke-width="2"
									/>
								{:else}
									<IconCamera
										class="size-[15px] shrink-0 text-[var(--color-fg-subtle)]"
										stroke-width="2"
									/>
								{/if}

								<span class="min-w-0 flex-1">
									<span class="text-md block truncate text-[var(--color-fg)]">
										{titleOf(i)}
									</span>
									<span
										class="text-2xs mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[var(--color-fg-subtle)]"
									>
										<span>{categoryLabel(i.category)}</span>
										{#if i.label_set}
											<span class="truncate font-mono">{i.label_set}</span>
										{/if}
										{#if i.metric_value != null}
											<span class="font-mono tabular-nums">{fmtNumber(i.metric_value, 2)}</span>
										{/if}
										{#if i.has_after}
											<span
												class="rounded-full bg-[var(--color-surface-2)] px-1.5 py-px font-mono tracking-wide"
											>
												{m.incidents_has_after()}
											</span>
										{/if}
									</span>
								</span>

								<span
									class="text-3xs shrink-0 font-mono text-[var(--color-fg-faint)] tabular-nums"
									title={new Date(i.created_at * 1000).toLocaleString()}
								>
									{fmtRelative(i.created_at, nowMs)}
								</span>
								<IconChevronRight
									class={cn(
										'size-3.5 shrink-0 text-[var(--color-fg-faint)] transition-transform',
										'group-hover:translate-x-0.5 group-hover:text-[var(--color-fg-muted)]'
									)}
									stroke-width="2"
								/>
							</a>
						</li>
					{/each}
				</ul>
			{/if}
		</Card>
	{/if}
</div>

<Modal
	open={captureOpen}
	onClose={() => (captureOpen = false)}
	title={m.incidents_capture_title()}
	description={m.incidents_capture_description()}
	width="md"
>
	<div class="flex flex-col gap-4">
		<Field label={m.incidents_capture_reason()} required hint={m.incidents_capture_reason_hint()}>
			<Input bind:value={capReason} disabled={capturing} placeholder="latency spike on checkout" />
		</Field>
		<Field label={m.incidents_capture_category()}>
			<SegmentedControl
				value={capCategory}
				options={categoryOpts}
				onSelect={(v) => (capCategory = v)}
				ariaLabel={m.incidents_capture_category()}
			/>
		</Field>
	</div>
	{#snippet footer()}
		<div class="flex justify-end gap-2">
			<Button variant="secondary" size="sm" onclick={() => (captureOpen = false)}>
				{m.common_cancel()}
			</Button>
			<Button
				variant="primary"
				size="sm"
				onclick={submitCapture}
				loading={capturing}
				disabled={capReason.trim().length === 0}
			>
				{m.incidents_capture_submit()}
			</Button>
		</div>
	{/snippet}
</Modal>
