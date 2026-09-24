<script lang="ts">
	import type { IncidentSummaryDto } from '$lib/types/api';
	import { fmtRelative } from '$lib/utils/format';
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
</script>

<li class="border-[var(--color-border)] [&:not(:first-child)]:border-t">
	<svelte:element
		this={serverId ? 'a' : 'div'}
		href={serverId ? `/servers/${serverId}/incidents/${incident.id}` : undefined}
		class="-mx-2 flex min-h-16 items-start gap-3 rounded-md px-2 py-3 transition-colors hover:bg-[var(--color-surface-2)] focus-visible:outline-2 focus-visible:outline-[var(--color-accent)]"
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
		<span class="min-w-0 flex-1">
			<span class="line-clamp-2 text-sm leading-snug font-medium break-words text-[var(--color-fg)]"
				>{title}</span
			>
			<span
				class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--color-fg-subtle)]"
			>
				<span class:text-[var(--color-fg-muted)]={open}>{status}</span>
				<span aria-hidden="true">·</span>
				<span>{fmtRelative(incident.opened_at, now)}</span>
			</span>
		</span>
	</svelte:element>
</li>
