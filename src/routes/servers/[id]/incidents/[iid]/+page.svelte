<script lang="ts">
	import { untrack } from 'svelte';
	import { tabVisible } from '$lib/utils/visibility.svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import Card from '$lib/components/ui/Card.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import BundleView from '$lib/components/incidents/BundleView.svelte';
	import IconBotMessageSquare from '~icons/lucide/bot-message-square';
	import { profiles } from '$lib/stores/profiles.svelte';
	import { connections } from '$lib/stores/connections.svelte';
	import { ApiError } from '$lib/api/error';
	import { cn } from '$lib/utils/cn';
	import { fmtDuration, fmtNumber } from '$lib/utils/format';
	import { m } from '$lib/paraglide/messages';
	import type { IncidentDto, IncidentFrameDto, IncidentFrameKind } from '$lib/types/api';
	import IconChevronLeft from '~icons/lucide/chevron-left';

	let id = $derived(page.params.id ?? '');
	let iid = $derived(Number(page.params.iid ?? ''));
	let profile = $derived(id ? profiles.byId(id) : undefined);
	let conn = $derived(profile ? connections.connect(profile) : null);

	let incident = $state<IncidentDto | null>(null);
	let error = $state<string | null>(null);
	let busy = $state(true);
	let loadedTarget = '';

	$effect(() => {
		const c = conn,
			target = iid;
		const visible = tabVisible();
		untrack(() => {
			if (loadedTarget !== id + '/' + target) {
				loadedTarget = id + '/' + target;
				incident = null;
				error = null;
				busy = true;
			}
		});
		if (!c?.isAuthenticated || !Number.isFinite(target)) return;
		let cancelled = false;
		let timer: ReturnType<typeof setTimeout> | undefined;
		async function refresh() {
			try {
				const res = await c!.client.getIncident(target, true);
				if (cancelled) return;
				incident = res;
				error = null;
				if (
					visible &&
					(res.closed_at == null || res.frames.some((f) => f.payload.enrichment === 'pending'))
				) {
					timer = setTimeout(refresh, 5000);
				}
			} catch (e) {
				if (cancelled) return;
				error = e instanceof ApiError ? e.userMessage : String(e);
				if (visible) timer = setTimeout(refresh, 10000);
			} finally {
				if (!cancelled) busy = false;
			}
		}
		if (visible) void refresh();
		return () => {
			cancelled = true;
			clearTimeout(timer);
		};
	});

	function investigate() {
		const q = encodeURIComponent(m.incident_ask_prompt({ id: iid }));
		goto(`/servers/${id}/assistant?ask=${q}`);
	}

	// Alert episodes name their rule; manual ones carry the operator's reason.
	let title = $derived(incident?.rule_name ?? incident?.reason ?? m.incident_title());
	let openedAt = $derived(incident ? new Date(incident.opened_at * 1000).toLocaleString() : '');
	let stillOpen = $derived(incident != null && incident.closed_at == null);
	let duration = $derived(
		incident?.closed_at != null ? fmtDuration(incident.closed_at - incident.opened_at) : null
	);

	// The onset is what every later frame is read against — "worse or better
	// than when this started" is the question the reel exists to answer.
	let baseline = $derived(incident?.frames[0]?.payload ?? null);

	function frameLabel(kind: IncidentFrameKind): string {
		switch (kind) {
			case 'continuation':
				return m.incident_frame_continuation();
			case 'checkpoint':
				return m.incident_frame_checkpoint();
			case 'cleared':
				return m.incident_frame_cleared();
			case 'interrupted':
				return m.incident_frame_interrupted();
			case 'onset':
				return incident?.trigger_kind === 'manual'
					? m.incident_frame_manual()
					: m.incident_frame_onset();
			case 'escalation':
				return m.incident_frame_escalation();
			case 'peak':
				return m.incident_frame_peak();
			case 'resolution':
				return m.incident_frame_resolution();
			default:
				return m.incident_frame_followup();
		}
	}

	/** How far into the episode this frame was taken. */
	function offsetLabel(f: IncidentFrameDto): string {
		if (!incident) return '';
		const delta = f.captured_at - incident.opened_at;
		return delta <= 0 ? m.incident_frame_at_start() : `+${fmtDuration(delta)}`;
	}

	function dotClass(kind: IncidentFrameKind): string {
		switch (kind) {
			case 'peak':
				return 'bg-[var(--color-danger)]';
			case 'resolution':
				return 'bg-[var(--color-success)]';
			case 'escalation':
				return 'bg-[var(--color-warning)]';
			default:
				return 'bg-[var(--color-fg-faint)]';
		}
	}

	function closeReasonLabel(reason: string | undefined): string | null {
		switch (reason) {
			case 'data_gap':
				return m.incident_close_data_gap();
			case 'rule_removed':
				return m.incident_close_rule_removed();
			case 'rule_disabled':
				return m.incident_close_rule_disabled();
			case 'rule_changed':
				return m.incident_close_rule_changed();
			case 'completed':
				return m.incident_close_completed();
			case 'expired':
				return m.incident_close_expired();
			case 'daemon_restart':
				return m.incident_close_restart();
			default:
				return null;
		}
	}
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
						<span>{openedAt}</span>
						{#if stillOpen}
							<span class="text-[var(--color-danger)]">{m.incidents_live()}</span>
						{:else if duration}
							<span class="text-[var(--color-fg-subtle)]">
								{m.incident_lasted({ duration })}
							</span>
						{/if}
						<span class="text-[var(--color-fg-subtle)]">
							{incident.trigger_kind === 'alert'
								? m.incident_trigger_alert()
								: m.incident_trigger_manual()}
							· {incident.category}
						</span>
						{#if incident.label_set}
							<span class="text-[var(--color-fg-subtle)]">{incident.label_set}</span>
						{/if}
						{#if incident.trigger_value != null}
							<span class="text-[var(--color-fg)] tabular-nums">
								{fmtNumber(incident.trigger_value, 2)}
								{#if incident.worst_value != null && incident.worst_value !== incident.trigger_value}
									<span class="text-[var(--color-warning)]">
										→ {fmtNumber(incident.worst_value, 2)}
									</span>
								{/if}
							</span>
						{/if}
						{#if closeReasonLabel(incident.close_reason)}
							<span class="text-[var(--color-warning)]">
								{closeReasonLabel(incident.close_reason)}
							</span>
						{/if}
					</p>
				</div>

				<!-- The daemon's assistant already has an `incident_detail` tool, so it
				     is handed the id and fetches the reel itself. -->
				<Button variant="secondary" size="sm" class="shrink-0" onclick={investigate}>
					<IconBotMessageSquare class="size-4" stroke-width="2" />
					{m.incident_investigate()}
				</Button>
			</header>

			{#if incident.trigger_context}
				<Card class="mb-5" padding="sm">
					<p class="text-2xs text-[var(--color-fg-muted)]">{m.incident_trigger_definition()}</p>
					<p class="mt-2 font-mono text-xs break-words">{incident.trigger_context.expression}</p>
					<p class="text-2xs mt-2 text-[var(--color-fg-subtle)]">
						{m.incident_trigger_timing({
							duration: fmtDuration(incident.trigger_context.for_duration_secs),
							interval: fmtDuration(incident.trigger_context.eval_interval_secs)
						})}
					</p>
				</Card>
			{/if}
			{#if error}<p role="status" class="mb-4 text-xs text-[var(--color-warning)]">{error}</p>{/if}

			<p class="mb-4 text-xs text-[var(--color-fg-subtle)]">{m.incident_selected_frames()}</p>
			{#if incident.trigger_context?.previous_incident_id}
				<a
					class="mb-4 inline-block text-xs text-[var(--color-accent)] hover:underline"
					href={`/servers/${id}/incidents/${incident.trigger_context.previous_incident_id}`}
					>{m.incident_previous_recording()}</a
				>
			{/if}
			<!-- One column, oldest first: the reel is a sequence, and reading it top
			     to bottom is the point. Every frame after the first is scored against
			     the onset, so the deltas answer "worse or better than when it began". -->
			<ol class="flex flex-col gap-4">
				{#each incident.frames as f, i (f.seq)}
					<li class="relative pl-6">
						<span
							class={cn('absolute top-[1.15rem] left-0 size-2.5 rounded-full', dotClass(f.kind))}
							aria-hidden="true"
						></span>
						{#if i < incident.frames.length - 1}
							<span
								class="absolute top-[1.9rem] bottom-[-1rem] left-[4.5px] w-px bg-[var(--color-border)]"
								aria-hidden="true"
							></span>
						{/if}
						<Card>
							<div class="mb-3 flex items-baseline justify-between gap-3">
								<h2 class="text-sm font-medium text-[var(--color-fg)]">
									{frameLabel(f.kind)}
								</h2>
								<span
									class="text-2xs shrink-0 font-mono text-[var(--color-fg-subtle)] tabular-nums"
									title={new Date(f.captured_at * 1000).toLocaleString()}
								>
									{offsetLabel(f)}
								</span>
							</div>
							<!-- `compact` follows what the frame actually holds, not its
							     position: onset and resolution are captured at full depth, so
							     the closing frame still shows the failed units and kernel
							     errors that appeared *during* the episode. -->

							{#if f.payload.trigger_value != null}
								<p class="mb-3 font-mono text-xs tabular-nums">
									{m.incident_observed_value()}: {fmtNumber(f.payload.trigger_value, 2)}
								</p>
							{/if}
							{#if f.payload.enrichment === 'pending' || f.payload.enrichment === 'skipped_busy' || f.payload.enrichment === 'interrupted'}
								<p class="text-2xs mb-3 text-[var(--color-fg-subtle)]">
									{f.payload.enrichment === 'pending'
										? m.incident_enrichment_pending()
										: f.payload.enrichment === 'interrupted'
											? m.incident_enrichment_interrupted()
											: m.incident_enrichment_skipped()}
								</p>
							{/if}
							<BundleView
								bundle={f.payload}
								compact={![
									'onset',
									'continuation',
									'resolution',
									'cleared',
									'interrupted'
								].includes(f.kind)}
								baseline={i > 0 ? (baseline ?? undefined) : undefined}
							/>
						</Card>
					</li>
				{/each}
			</ol>

			{#if stillOpen}
				<p class="mt-4 text-xs text-[var(--color-fg-subtle)]">{m.incident_still_recording()}</p>
			{/if}
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
