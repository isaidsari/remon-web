<script lang="ts" module>
	import type {
		IncidentBundle,
		IncidentCoActiveAlert,
		IncidentDaemonError,
		IncidentFailedService,
		IncidentProcessSlice,
		IncidentSystemEvents,
		IncidentVitals,
		SliceError
	} from '$lib/types/api';

	/** A slice is either the data, `null`, or `{ error }`. Narrow once here so
	 *  the markup never has to ask again. */
	function slice<T>(value: T | SliceError | null | undefined): {
		data: T | null;
		error: string | null;
	} {
		if (value == null) return { data: null, error: null };
		if (typeof value === 'object' && 'error' in value && typeof value.error === 'string') {
			return { data: null, error: value.error };
		}
		return { data: value as T, error: null };
	}
</script>

<script lang="ts">
	import PanelSection from '$lib/components/metrics/PanelSection.svelte';
	import { fmtBytes, fmtNumber, fmtPercent, fmtBps } from '$lib/utils/format';
	import { m } from '$lib/paraglide/messages';

	interface Props {
		bundle: IncidentBundle;
		/** The follow-up carries vitals and processes only. */
		compact?: boolean;
		/** The capture this one is read against. Set on the follow-up: the only
		 *  question a minute later is "better or worse", and two columns of bare
		 *  numbers make the reader do that subtraction by eye. */
		baseline?: IncidentBundle;
	}

	let { bundle, compact = false, baseline }: Props = $props();

	let vitals = $derived(slice<IncidentVitals>(bundle.vitals));
	// The daemon wraps the ranked union in `{ snapshot_at, processes }`; unwrap it
	// here so the markup keeps iterating a plain list.
	let procSlice = $derived(slice<IncidentProcessSlice>(bundle.top_processes));
	let processes = $derived({ data: procSlice.data?.processes ?? null, error: procSlice.error });
	let failedServices = $derived(slice<IncidentFailedService[]>(bundle.failed_services));
	let systemErrors = $derived(slice<IncidentSystemEvents>(bundle.system_errors));
	let daemonErrors = $derived(slice<IncidentDaemonError[]>(bundle.recent_daemon_errors));
	let coActive = $derived(slice<IncidentCoActiveAlert[]>(bundle.co_active_alerts));

	function memPercentOf(v: IncidentVitals | null): number | null {
		if (!v?.memory_total_bytes) return null;
		return ((v.memory_used_bytes ?? 0) / v.memory_total_bytes) * 100;
	}

	let memPct = $derived(memPercentOf(vitals.data));

	let baseVitals = $derived(baseline ? slice<IncidentVitals>(baseline.vitals).data : null);
	let baseMemPct = $derived(memPercentOf(baseVitals));

	/** Signed change against the baseline, already worded. `null` whenever the
	 *  comparison would be a guess — no baseline, a missing side, or no movement
	 *  worth a line. Every vital below is lower-is-better, so a fall is good. */
	function delta(
		now: number | null | undefined,
		before: number | null | undefined,
		format: (n: number) => string
	): { text: string; better: boolean } | null {
		if (baseVitals == null || now == null || before == null) return null;
		const d = now - before;
		// Formatting decides the resolution; a change that rounds away is noise.
		if (format(Math.abs(d)) === format(0)) return null;
		return { text: `${d < 0 ? '↓' : '↑'} ${format(Math.abs(d))}`, better: d < 0 };
	}
</script>

{#snippet stat(label: string, value: string, change?: { text: string; better: boolean } | null)}
	<div>
		<dt class="text-3xs tracking-wide text-[var(--color-fg-subtle)]">{label}</dt>
		<dd class="text-md font-mono text-[var(--color-fg)] tabular-nums">{value}</dd>
		{#if change}
			<dd
				class={change.better
					? 'text-3xs font-mono text-[var(--color-success)] tabular-nums'
					: 'text-3xs font-mono text-[var(--color-danger)] tabular-nums'}
				title={m.incident_delta_vs_capture()}
			>
				{change.text}
			</dd>
		{/if}
	</div>
{/snippet}

{#snippet unavailable(error: string | null)}
	<p class="text-xs text-[var(--color-fg-subtle)]">
		{error ? `${m.incident_slice_failed()} — ${error}` : m.incident_slice_empty()}
	</p>
{/snippet}

{#if vitals.data}
	{@const v = vitals.data}
	<dl class="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
		{@render stat(
			'cpu',
			v.cpu_percent == null ? '—' : fmtPercent(v.cpu_percent, 1),
			delta(v.cpu_percent, baseVitals?.cpu_percent, (n) => fmtPercent(n, 1))
		)}
		<!-- Load is a triple, so a single arrow beside it would be ambiguous;
		     the 1-minute figure carries the comparison in the other three. -->
		{@render stat(m.incident_load(), v.load ? v.load.map((n) => fmtNumber(n, 2)).join(' · ') : '—')}
		{@render stat(
			m.overview_card_memory_title(),
			memPct == null ? '—' : fmtPercent(memPct, 1),
			delta(memPct, baseMemPct, (n) => fmtPercent(n, 1))
		)}
		{@render stat(
			m.incident_swap(),
			v.swap_used_bytes == null ? '—' : fmtBytes(v.swap_used_bytes),
			delta(v.swap_used_bytes, baseVitals?.swap_used_bytes, (n) => fmtBytes(n))
		)}
	</dl>

	{#if v.disks && v.disks.length > 0}
		<ul class="mt-3 flex flex-col gap-1">
			{#each v.disks as d (d.mount_point)}
				<li class="flex items-baseline justify-between gap-3 text-xs">
					<span class="truncate font-mono text-[var(--color-fg-muted)]">{d.mount_point}</span>
					<span class="shrink-0 font-mono text-[var(--color-fg-subtle)] tabular-nums">
						{fmtPercent(d.used_percent, 1)}
						{#if d.io_util_percent != null}
							· io {fmtPercent(d.io_util_percent, 0)}
						{/if}
					</span>
				</li>
			{/each}
		</ul>
	{/if}

	{#if v.network && v.network.length > 0}
		<ul class="mt-2 flex flex-col gap-1">
			{#each v.network as n (n.interface)}
				<li class="flex items-baseline justify-between gap-3 text-xs">
					<span class="truncate font-mono text-[var(--color-fg-muted)]">{n.interface}</span>
					<span class="shrink-0 font-mono text-[var(--color-fg-subtle)] tabular-nums">
						↓ {fmtBps(n.rx_bytes_per_sec, 1)} · ↑ {fmtBps(n.tx_bytes_per_sec, 1)}
					</span>
				</li>
			{/each}
		</ul>
	{/if}
{:else}
	{@render unavailable(vitals.error)}
{/if}

<PanelSection label={m.incident_processes()}>
	{#if processes.data && processes.data.length > 0}
		<ul class="flex flex-col gap-1.5">
			{#each processes.data as p (p.pid)}
				<li class="flex items-baseline justify-between gap-3 text-xs">
					<span class="min-w-0 truncate">
						<span class="font-mono text-[var(--color-fg)]">{p.name}</span>
						<span class="text-3xs ml-1.5 font-mono text-[var(--color-fg-subtle)]">{p.pid}</span>
						{#if p.user}
							<span class="text-3xs ml-1.5 font-mono text-[var(--color-fg-faint)]">{p.user}</span>
						{/if}
					</span>
					<span class="shrink-0 font-mono text-[var(--color-fg-subtle)] tabular-nums">
						{p.cpu_percent == null ? '—' : fmtPercent(p.cpu_percent, 1)}
						{#if p.recent?.cpu_max_percent != null}
							<!-- The in-memory window the daemon still had for this pid. -->
							<span class="text-[var(--color-fg-faint)]">
								(max {fmtPercent(p.recent.cpu_max_percent, 0)})
							</span>
						{/if}
						· {p.memory_bytes == null ? '—' : fmtBytes(p.memory_bytes)}
					</span>
				</li>
			{/each}
		</ul>
	{:else}
		{@render unavailable(processes.error)}
	{/if}
</PanelSection>

{#if !compact}
	<PanelSection label={m.incident_co_active()}>
		{#if coActive.data && coActive.data.length > 0}
			<ul class="flex flex-col gap-1.5">
				{#each coActive.data as a (a.name + (a.label_set ?? ''))}
					<li class="flex items-baseline justify-between gap-3 text-xs">
						<span class="min-w-0 truncate text-[var(--color-fg)]">
							{a.name}
							{#if a.label_set}
								<span class="text-3xs ml-1.5 font-mono text-[var(--color-fg-subtle)]">
									{a.label_set}
								</span>
							{/if}
						</span>
						<span class="shrink-0 font-mono text-[var(--color-fg-subtle)] tabular-nums">
							{a.severity} · {a.state}
							{#if a.last_value != null}
								· {fmtNumber(a.last_value, 1)}
							{/if}
						</span>
					</li>
				{/each}
			</ul>
		{:else}
			{@render unavailable(coActive.error)}
		{/if}
	</PanelSection>

	<PanelSection label={m.incident_daemon_errors()}>
		{#if daemonErrors.data && daemonErrors.data.length > 0}
			<ul class="flex flex-col gap-1.5">
				{#each daemonErrors.data as e, i (e.timestamp + '-' + i)}
					<li class="text-xs">
						<span
							class={e.level === 'error'
								? 'font-mono text-[var(--color-danger)]'
								: 'font-mono text-[var(--color-warning)]'}
						>
							{e.target}
						</span>
						<span class="text-[var(--color-fg-muted)]">{e.message}</span>
					</li>
				{/each}
			</ul>
		{:else}
			{@render unavailable(daemonErrors.error)}
		{/if}
	</PanelSection>

	<!-- Captured on every bundle but never surfaced until now: during a resource
	     incident the kernel's own account (OOM kills, disk errors) is usually the
	     line that explains the graph. -->
	<PanelSection label={m.incident_system_errors()}>
		{#if systemErrors.data?.events && systemErrors.data.events.length > 0}
			<ul class="flex flex-col gap-1">
				{#each systemErrors.data.events as line, i (i)}
					<li class="truncate font-mono text-xs text-[var(--color-fg-muted)]" title={line}>
						{line}
					</li>
				{/each}
			</ul>
		{:else}
			{@render unavailable(systemErrors.error)}
		{/if}
	</PanelSection>

	<PanelSection label={m.incident_failed_services()}>
		{#if failedServices.data && failedServices.data.length > 0}
			<ul class="flex flex-col gap-1.5">
				{#each failedServices.data as s (s.name)}
					<li class="flex items-baseline justify-between gap-3 text-xs">
						<span class="min-w-0 truncate font-mono text-[var(--color-fg)]">{s.name}</span>
						{#if s.raw_state}
							<span class="shrink-0 font-mono text-[var(--color-danger)]">{s.raw_state}</span>
						{/if}
					</li>
				{/each}
			</ul>
		{:else}
			{@render unavailable(failedServices.error)}
		{/if}
	</PanelSection>
{/if}
