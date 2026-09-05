<script lang="ts" module>
	import type {
		IncidentBundle,
		IncidentCoActiveAlert,
		IncidentDaemonError,
		IncidentProcess,
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
	}

	let { bundle, compact = false }: Props = $props();

	let vitals = $derived(slice<IncidentVitals>(bundle.vitals));
	let processes = $derived(slice<IncidentProcess[]>(bundle.top_processes));
	let daemonErrors = $derived(slice<IncidentDaemonError[]>(bundle.recent_daemon_errors));
	let coActive = $derived(slice<IncidentCoActiveAlert[]>(bundle.co_active_alerts));

	let memPct = $derived.by(() => {
		const v = vitals.data;
		if (!v?.memory_total_bytes) return null;
		return ((v.memory_used_bytes ?? 0) / v.memory_total_bytes) * 100;
	});
</script>

{#snippet stat(label: string, value: string)}
	<div>
		<dt class="text-3xs tracking-wide text-[var(--color-fg-subtle)]">{label}</dt>
		<dd class="text-md font-mono text-[var(--color-fg)] tabular-nums">{value}</dd>
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
		{@render stat('cpu', v.cpu_percent == null ? '—' : fmtPercent(v.cpu_percent, 1))}
		{@render stat(m.incident_load(), v.load ? v.load.map((n) => fmtNumber(n, 2)).join(' · ') : '—')}
		{@render stat(m.overview_card_memory_title(), memPct == null ? '—' : fmtPercent(memPct, 1))}
		{@render stat(m.incident_swap(), v.swap_used_bytes == null ? '—' : fmtBytes(v.swap_used_bytes))}
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
					</span>
					<span class="shrink-0 font-mono text-[var(--color-fg-subtle)] tabular-nums">
						{p.cpu_percent == null ? '—' : fmtPercent(p.cpu_percent, 1)}
						{#if p.cpu_max_percent != null}
							<!-- The in-memory window the daemon still had for this pid. -->
							<span class="text-[var(--color-fg-faint)]">
								(max {fmtPercent(p.cpu_max_percent, 0)})
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
{/if}
