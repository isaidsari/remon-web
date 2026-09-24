<script lang="ts">
	import type { IncidentSummaryDto } from '$lib/types/api';
	import { fmtDuration, fmtRelative } from '$lib/utils/format';
	import { m } from '$lib/paraglide/messages';

	let {
		incident,
		now,
		serverId
	}: {
		incident: IncidentSummaryDto;
		now: number;
		serverId?: string;
	} = $props();

	let open = $derived(incident.closed_at == null);
	let recovering = $derived(open && incident.recovery_started_at != null);
	let resolved = $derived(!open && incident.close_reason === 'resolved');
	let status = $derived.by(() => {
		if (recovering) return m.incident_recovering();
		if (open) return m.overview_incident_active();
		switch (incident.close_reason) {
			case 'resolved':
				return m.overview_incident_resolved();
			case 'expired':
				return m.incident_close_expired();
			case 'daemon_restart':
				return m.incident_close_restart();
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
			default:
				return m.overview_incident_closed();
		}
	});
	let title = $derived(incident.rule_name?.trim() || incident.reason?.trim() || m.incident_title());
	// An episode may include several excursions and a recovery confirmation.
	// Its envelope is recording time, never a claim of continuous violation.
	let duration = $derived(
		fmtDuration(Math.max(0, (incident.closed_at ?? Math.floor(now / 1000)) - incident.opened_at))
	);
</script>

<li
	class="flex items-start gap-3 py-3 [&:not(:first-child)]:border-t [&:not(:first-child)]:border-[var(--color-border)]"
>
	<span
		class="mt-1.5 size-1.5 shrink-0 rounded-full"
		style:background={recovering
			? 'var(--color-warning)'
			: open
				? 'var(--color-danger)'
				: resolved
					? 'var(--color-success)'
					: 'var(--color-fg-subtle)'}
		aria-hidden="true"
	></span>
	<div class="min-w-0 flex-1">
		{#if serverId}
			<a
				class="block text-sm font-medium break-words text-[var(--color-fg)] hover:underline"
				href={`/servers/${serverId}/incidents/${incident.id}`}>{title}</a
			>
		{:else}
			<p class="text-sm font-medium break-words text-[var(--color-fg)]">{title}</p>
		{/if}
		<p class="mt-1 text-xs text-[var(--color-fg-muted)]">{status}</p>
		<p class="text-2xs mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[var(--color-fg-subtle)]">
			<span>{m.overview_incident_started({ time: fmtRelative(incident.opened_at, now) })}</span>
			<span>{m.overview_incident_recording_duration({ duration })}</span>
		</p>
	</div>
</li>
