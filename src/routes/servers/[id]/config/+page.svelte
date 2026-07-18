<script lang="ts">
	import { untrack } from 'svelte';
	import { page } from '$app/state';
	import Card from '$lib/components/ui/Card.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Field from '$lib/components/ui/Field.svelte';
	import { profiles } from '$lib/stores/profiles.svelte';
	import { connections } from '$lib/stores/connections.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { ApiError } from '$lib/api/error';
	import type {
		ConfigResponse,
		ResolutionDto,
		RetentionPolicyDto,
		UpdateConfigRequest
	} from '$lib/types/api';
	import { m } from '$lib/paraglide/messages';
	import { fmtRelative } from '$lib/utils/format';
	import { cn } from '$lib/utils/cn';

	let id = $derived(page.params.id ?? '');
	let profile = $derived(id ? profiles.byId(id) : undefined);
	let conn = $derived(profile ? connections.connect(profile) : null);

	$effect(() => {
		if (!conn) return;
		untrack(() => {
			conn.ensureSignedIn().catch((e) => {
				if (e instanceof ApiError)
					toast.error(m.config_signin_failed(), { description: e.userMessage });
			});
		});
	});

	let original = $state<ConfigResponse | null>(null);
	let form = $state<EditableConfig | null>(null);
	let busy = $state(false);
	let saving = $state(false);

	type EditableConfig = {
		server_name: string;
		stats_ms: number;
		processes_ms: number;
		docker_ms: number;
		smart_ms: number;
		rollup_ms: number;
		retention_ms: number;
	};

	function fromResponse(c: ConfigResponse): EditableConfig {
		return {
			server_name: c.server_name,
			stats_ms: c.collector_stats_interval_ms,
			processes_ms: c.collector_processes_interval_ms,
			docker_ms: c.collector_docker_interval_ms,
			smart_ms: c.collector_smart_interval_ms,
			rollup_ms: c.rollup_tick_interval_ms,
			retention_ms: c.retention_tick_interval_ms
		};
	}

	async function load() {
		if (!conn?.isAuthenticated) return;
		busy = true;
		try {
			const c = await conn.client.getConfig();
			original = c;
			form = fromResponse(c);
		} catch (e) {
			if (e instanceof ApiError) {
				toast.error(m.config_load_failed(), { description: e.userMessage });
			}
		} finally {
			busy = false;
		}
	}

	$effect(() => {
		if (conn?.isAuthenticated) {
			load();
			loadRetention();
			loadResolutions();
		}
	});

	let diff = $derived.by((): UpdateConfigRequest => {
		if (!original || !form) return {};
		const d: UpdateConfigRequest = {};
		if (form.server_name !== original.server_name) d.server_name = form.server_name;
		if (form.stats_ms !== original.collector_stats_interval_ms)
			d.collector_stats_interval_ms = form.stats_ms;
		if (form.processes_ms !== original.collector_processes_interval_ms)
			d.collector_processes_interval_ms = form.processes_ms;
		if (form.docker_ms !== original.collector_docker_interval_ms)
			d.collector_docker_interval_ms = form.docker_ms;
		if (form.smart_ms !== original.collector_smart_interval_ms)
			d.collector_smart_interval_ms = form.smart_ms;
		if (form.rollup_ms !== original.rollup_tick_interval_ms)
			d.rollup_tick_interval_ms = form.rollup_ms;
		if (form.retention_ms !== original.retention_tick_interval_ms)
			d.retention_tick_interval_ms = form.retention_ms;
		return d;
	});

	let dirty = $derived(Object.keys(diff).length > 0);

	// Surface the empty-name error inline on the field.
	let serverNameError = $derived(
		form && !form.server_name.trim() ? m.config_validation_server_name_empty() : null
	);

	// Server enforces >= 1000 ms for collector intervals (sub-second sampling
	// collides with second-resolution metric PKs) and >= 60 s for SMART
	// (each poll shells out to every disk). Mirror both floors here.
	const MIN_INTERVAL_MS = 1000;
	const MIN_SMART_INTERVAL_MS = 60_000;

	let validationError = $derived.by((): string | null => {
		if (!form) return null;
		if (!form.server_name.trim()) return m.config_validation_server_name_empty();
		const intervals: [string, number, number][] = [
			[m.config_interval_label_stats(), form.stats_ms, MIN_INTERVAL_MS],
			[m.config_interval_label_processes(), form.processes_ms, MIN_INTERVAL_MS],
			[m.config_interval_label_docker(), form.docker_ms, MIN_INTERVAL_MS],
			[m.config_interval_label_smart(), form.smart_ms, MIN_SMART_INTERVAL_MS],
			[m.config_interval_label_rollup(), form.rollup_ms, MIN_INTERVAL_MS],
			[m.config_interval_label_retention(), form.retention_ms, MIN_INTERVAL_MS]
		];
		for (const [label, v, min] of intervals) {
			if (!Number.isFinite(v) || v < min)
				return min === MIN_SMART_INTERVAL_MS
					? m.config_validation_min_smart()
					: m.config_validation_min({ label });
			if (v > 24 * 3600 * 1000) return m.config_validation_max({ label });
		}
		return null;
	});

	async function save() {
		if (!conn?.isAuthenticated || !dirty || validationError) return;
		saving = true;
		try {
			const renamed = 'server_name' in diff;
			const updated = await conn.client.patchConfig(diff);
			original = updated;
			form = fromResponse(updated);
			// Sidebar and server cards read the canonical name from the cached
			// system info — refetch so a rename shows up immediately.
			if (renamed) void conn.refreshSystemInfo().catch(() => {});
			toast.success(m.config_saved());
		} catch (e) {
			if (e instanceof ApiError) {
				toast.error(m.config_save_failed(), { description: e.userMessage });
			}
		} finally {
			saving = false;
		}
	}

	function reset() {
		if (original) form = fromResponse(original);
	}

	const presets: { label: string; ms: number }[] = [
		{ label: '1s', ms: 1000 },
		{ label: '2s', ms: 2000 },
		{ label: '5s', ms: 5000 },
		{ label: '10s', ms: 10000 },
		{ label: '30s', ms: 30000 },
		{ label: '1m', ms: 60000 },
		{ label: '5m', ms: 300000 },
		{ label: '1h', ms: 3600000 }
	];

	// SMART shells out to every disk per poll — its sensible range starts
	// at minutes, not seconds.
	const smartPresets: { label: string; ms: number }[] = [
		{ label: '5m', ms: 300000 },
		{ label: '15m', ms: 900000 },
		{ label: '30m', ms: 1800000 },
		{ label: '1h', ms: 3600000 },
		{ label: '3h', ms: 10800000 },
		{ label: '6h', ms: 21600000 },
		{ label: '12h', ms: 43200000 },
		{ label: '24h', ms: 86400000 }
	];

	function fmtMs(ms: number): string {
		if (ms < 1000) return `${ms}ms`;
		if (ms < 60000) return `${(ms / 1000).toFixed(ms % 1000 === 0 ? 0 : 1)}s`;
		if (ms < 3600000) return `${(ms / 60000).toFixed(ms % 60000 === 0 ? 0 : 1)}m`;
		return `${(ms / 3600000).toFixed(ms % 3600000 === 0 ? 0 : 1)}h`;
	}

	// ─── Retention policy ────────────────────────────────────────────────────

	const RESOLUTION_ORDER = ['raw', '1m', '5m', '1h'];
	// Metric families first, bookkeeping tables after; unknowns sort last.
	const RESOURCE_ORDER = [
		'cpu',
		'cpu_cores',
		'memory',
		'disk',
		'network',
		'docker',
		'process',
		'pressure',
		'components',
		'probe',
		'smart',
		'logs',
		'probe_runs',
		'heartbeat_pings',
		'incident_snapshots',
		'alert_events'
	];

	const KEEP_PRESETS = [
		21600, 43200, 86400, 172800, 604800, 1209600, 2592000, 7776000, 15552000, 31536000, 63072000
	];

	let retOriginal = $state<RetentionPolicyDto[] | null>(null);
	let retForm = $state<Record<string, number>>({});
	let retSaving = $state(false);

	const retKey = (resource: string, resolution: string) => `${resource}|${resolution}`;

	async function loadRetention() {
		if (!conn?.isAuthenticated) return;
		try {
			const res = await conn.client.getRetention();
			retOriginal = res.policies;
			retForm = Object.fromEntries(
				res.policies.map((p) => [retKey(p.resource, p.resolution), p.keep_seconds])
			);
		} catch (e) {
			if (e instanceof ApiError)
				toast.error(m.config_retention_load_failed(), { description: e.userMessage });
		}
	}

	let retResources = $derived.by((): string[] => {
		if (!retOriginal) return [];
		const seen = [...new Set(retOriginal.map((p) => p.resource))];
		return seen.sort((a, b) => {
			const ia = RESOURCE_ORDER.indexOf(a);
			const ib = RESOURCE_ORDER.indexOf(b);
			return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib) || a.localeCompare(b);
		});
	});

	let retDiff = $derived.by((): RetentionPolicyDto[] => {
		if (!retOriginal) return [];
		return retOriginal
			.filter((p) => retForm[retKey(p.resource, p.resolution)] !== p.keep_seconds)
			.map((p) => ({
				resource: p.resource,
				resolution: p.resolution,
				keep_seconds: retForm[retKey(p.resource, p.resolution)]
			}));
	});

	function retCell(resource: string, resolution: string): RetentionPolicyDto | undefined {
		return retOriginal?.find((p) => p.resource === resource && p.resolution === resolution);
	}

	function fmtKeep(s: number): string {
		if (s % 31536000 === 0) return `${s / 31536000}y`;
		if (s % 86400 === 0) return `${s / 86400}d`;
		if (s % 3600 === 0) return `${s / 3600}h`;
		return `${s}s`;
	}

	function keepOptions(current: number): number[] {
		return KEEP_PRESETS.includes(current)
			? KEEP_PRESETS
			: [...KEEP_PRESETS, current].sort((a, b) => a - b);
	}

	async function saveRetention() {
		if (!conn?.isAuthenticated || retDiff.length === 0) return;
		retSaving = true;
		try {
			const res = await conn.client.patchRetention({ policies: retDiff });
			retOriginal = res.policies;
			retForm = Object.fromEntries(
				res.policies.map((p) => [retKey(p.resource, p.resolution), p.keep_seconds])
			);
			toast.success(m.config_retention_saved());
		} catch (e) {
			if (e instanceof ApiError)
				toast.error(m.config_retention_save_failed(), { description: e.userMessage });
		} finally {
			retSaving = false;
		}
	}

	function resetRetention() {
		if (!retOriginal) return;
		retForm = Object.fromEntries(
			retOriginal.map((p) => [retKey(p.resource, p.resolution), p.keep_seconds])
		);
	}

	// ─── Resolutions ─────────────────────────────────────────────────────────

	let resolutions = $state<ResolutionDto[] | null>(null);
	let resolutionBusy = $state<string | null>(null);

	async function loadResolutions() {
		if (!conn?.isAuthenticated) return;
		try {
			const res = await conn.client.getResolutions();
			resolutions = res.resolutions;
		} catch (e) {
			if (e instanceof ApiError)
				toast.error(m.config_resolutions_load_failed(), { description: e.userMessage });
		}
	}

	// Mirrors the server's chain guards so locked toggles explain themselves
	// instead of failing on click.
	function lockReason(r: ResolutionDto): string | null {
		if (!resolutions) return null;
		if (r.rollup_from === null) return m.config_resolution_locked_raw();
		if (r.enabled) {
			const child = resolutions.find((c) => c.enabled && c.rollup_from === r.name);
			if (child) return m.config_resolution_locked_parent({ child: child.name });
			return null;
		}
		const parent = resolutions.find((p) => p.name === r.rollup_from);
		if (parent && !parent.enabled) return m.config_resolution_locked_child({ parent: parent.name });
		return null;
	}

	async function toggleResolution(r: ResolutionDto) {
		if (!conn?.isAuthenticated || resolutionBusy || lockReason(r)) return;
		resolutionBusy = r.name;
		try {
			const res = await conn.client.patchResolution(r.name, !r.enabled);
			resolutions = res.resolutions;
		} catch (e) {
			if (e instanceof ApiError)
				toast.error(m.config_resolution_toggle_failed(), { description: e.userMessage });
		} finally {
			resolutionBusy = null;
		}
	}

	function fmtIntervalSecs(s: number): string {
		if (s % 3600 === 0) return `${s / 3600}h`;
		if (s % 60 === 0) return `${s / 60}m`;
		return `${s}s`;
	}
</script>

{#if profile}
	<div class="px-4 py-6 md:px-8 md:py-8">
		<header class="mb-6 flex items-end justify-between gap-4">
			<div>
				<h1 class="text-[24px] font-semibold tracking-tight">{m.section_config()}</h1>
				<p class="mt-1.5 max-w-md text-sm leading-relaxed text-[var(--color-fg-muted)]">
					{m.config_page_description_prefix()} <span class="font-mono text-xs">server_config</span>
					{m.config_page_description_suffix()}
				</p>
				{#if original}
					<p class="mt-1 text-xs text-[var(--color-fg-subtle)]">
						{m.config_updated_at({ time: fmtRelative(original.updated_at) })}
					</p>
				{/if}
			</div>
			<Button variant="ghost" size="sm" onclick={load} loading={busy}>{m.config_reload()}</Button>
		</header>

		{#if !conn?.isAuthenticated}
			<Card padding="lg" class="border-[var(--color-warning)]/30">
				<p class="text-sm text-[var(--color-fg-muted)]">
					{m.config_signin_required()}
				</p>
			</Card>
		{:else if form && original}
			<form
				class="flex flex-col gap-5"
				onsubmit={(e) => {
					e.preventDefault();
					save();
				}}
			>
				<Card>
					<p class="mb-4 text-xs tracking-wide text-[var(--color-fg-muted)]">
						{m.config_section_general()}
					</p>
					<Field
						label={m.config_field_server_name_label()}
						hint={m.config_field_server_name_hint_notify()}
						error={serverNameError}
						for="server-name"
					>
						<Input
							id="server-name"
							bind:value={form.server_name}
							placeholder={m.config_field_server_name_placeholder()}
							required
						/>
					</Field>
				</Card>

				<Card>
					<p class="mb-4 text-xs tracking-wide text-[var(--color-fg-muted)]">
						{m.config_section_collector_intervals()}
					</p>
					<div class="flex flex-col gap-5">
						{@render intervalField(
							m.config_interval_label_stats(),
							m.config_interval_hint_stats(),
							'stats',
							form.stats_ms,
							(v) => (form!.stats_ms = v),
							presets,
							MIN_INTERVAL_MS
						)}
						{@render intervalField(
							m.config_interval_label_processes(),
							m.config_interval_hint_processes(),
							'processes',
							form.processes_ms,
							(v) => (form!.processes_ms = v),
							presets,
							MIN_INTERVAL_MS
						)}
						{@render intervalField(
							m.config_interval_label_docker(),
							m.config_interval_hint_docker(),
							'docker',
							form.docker_ms,
							(v) => (form!.docker_ms = v),
							presets,
							MIN_INTERVAL_MS
						)}
						{@render intervalField(
							m.config_interval_label_smart(),
							m.config_interval_hint_smart(),
							'smart',
							form.smart_ms,
							(v) => (form!.smart_ms = v),
							smartPresets,
							MIN_SMART_INTERVAL_MS
						)}
					</div>
				</Card>

				<Card>
					<p class="mb-4 text-xs tracking-wide text-[var(--color-fg-muted)]">
						{m.config_section_background_workers()}
					</p>
					<div class="flex flex-col gap-5">
						{@render intervalField(
							m.config_interval_label_rollup(),
							m.config_interval_hint_rollup(),
							'rollup',
							form.rollup_ms,
							(v) => (form!.rollup_ms = v),
							presets,
							MIN_INTERVAL_MS
						)}
						{@render intervalField(
							m.config_interval_label_retention(),
							m.config_interval_hint_retention(),
							'retention',
							form.retention_ms,
							(v) => (form!.retention_ms = v),
							presets,
							MIN_INTERVAL_MS
						)}
					</div>
				</Card>

				{#if validationError}
					<p class="text-sm text-[var(--color-danger)]">{validationError}</p>
				{/if}

				<div class="flex items-center justify-end gap-2">
					<span class="mr-auto text-xs text-[var(--color-fg-subtle)]">
						{Object.keys(diff).length === 1
							? m.config_fields_changed_one()
							: m.config_fields_changed_other({ count: Object.keys(diff).length })}
					</span>
					<Button variant="ghost" onclick={reset} disabled={!dirty || saving}
						>{m.config_reset()}</Button
					>
					<Button type="submit" disabled={!dirty || !!validationError || saving} loading={saving}>
						{m.config_save()}
					</Button>
				</div>
			</form>

			{#if resolutions}
				<Card class="mt-5">
					<p class="mb-1 text-xs tracking-wide text-[var(--color-fg-muted)]">
						{m.config_section_resolutions()}
					</p>
					<p class="mb-4 max-w-lg text-[12px] text-[var(--color-fg-muted)]">
						{m.config_resolutions_description()}
					</p>
					<ul class="flex flex-col gap-2">
						{#each resolutions as r (r.name)}
							{@const locked = lockReason(r)}
							<li
								class="flex items-center gap-3 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2"
							>
								<span class="w-10 font-mono text-[13px] text-[var(--color-fg)]">{r.name}</span>
								<span class="font-mono text-[11px] text-[var(--color-fg-subtle)]">
									{fmtIntervalSecs(r.interval_seconds)}
								</span>
								{#if r.rollup_from}
									<span class="text-[11px] text-[var(--color-fg-faint)]">
										← {r.rollup_from}
									</span>
								{/if}
								<span class="ml-auto"></span>
								{#if locked}
									<span
										class="max-w-56 truncate text-[11px] text-[var(--color-fg-subtle)]"
										title={locked}
									>
										{locked}
									</span>
								{/if}
								<button
									type="button"
									onclick={() => toggleResolution(r)}
									disabled={!!locked || resolutionBusy === r.name}
									class={cn(
										'rounded-full px-2.5 py-0.5 font-mono text-[11px] tracking-wide transition',
										r.enabled
											? 'bg-[var(--color-success)]/15 text-[var(--color-success)]'
											: 'bg-[var(--color-fg-subtle)]/15 text-[var(--color-fg-subtle)]',
										locked ? 'cursor-not-allowed opacity-60' : 'hover:opacity-80'
									)}
								>
									{r.enabled ? m.config_resolution_enabled() : m.config_resolution_disabled()}
								</button>
							</li>
						{/each}
					</ul>
				</Card>
			{/if}

			{#if retOriginal}
				<Card class="mt-5">
					<p class="mb-1 text-xs tracking-wide text-[var(--color-fg-muted)]">
						{m.config_section_retention()}
					</p>
					<p class="mb-4 max-w-lg text-[12px] text-[var(--color-fg-muted)]">
						{m.config_retention_description()}
					</p>

					<div class="overflow-x-auto">
						<table class="w-full min-w-[480px] text-sm">
							<thead>
								<tr class="text-left text-[11px] tracking-wide text-[var(--color-fg-subtle)]">
									<th class="pb-2 pr-4 font-normal">{m.config_retention_header_resource()}</th>
									{#each RESOLUTION_ORDER as res (res)}
										<th class="pb-2 pr-3 font-normal">{res}</th>
									{/each}
								</tr>
							</thead>
							<tbody>
								{#each retResources as resource (resource)}
									<tr class="border-t border-[var(--color-border)]/60">
										<td class="py-1.5 pr-4 font-mono text-[12px] text-[var(--color-fg)]">
											{resource}
										</td>
										{#each RESOLUTION_ORDER as resolution (resolution)}
											{@const cell = retCell(resource, resolution)}
											<td class="py-1.5 pr-3">
												{#if cell}
													{@const key = retKey(resource, resolution)}
													<select
														value={retForm[key]}
														onchange={(e) =>
															(retForm[key] = Number((e.target as HTMLSelectElement).value))}
														class={cn(
															'rounded-md border bg-[var(--color-surface)] px-1.5 py-0.5 font-mono text-[12px]',
															retForm[key] !== cell.keep_seconds
																? 'border-[var(--color-accent)] text-[var(--color-accent)]'
																: 'border-[var(--color-border)] text-[var(--color-fg-muted)]'
														)}
													>
														{#each keepOptions(retForm[key]) as opt (opt)}
															<option value={opt}>{fmtKeep(opt)}</option>
														{/each}
													</select>
												{:else}
													<span class="text-[11px] text-[var(--color-fg-faint)]">—</span>
												{/if}
											</td>
										{/each}
									</tr>
								{/each}
							</tbody>
						</table>
					</div>

					<div class="mt-4 flex items-center justify-end gap-2">
						<span class="mr-auto text-xs text-[var(--color-fg-subtle)]">
							{retDiff.length === 1
								? m.config_fields_changed_one()
								: m.config_fields_changed_other({ count: retDiff.length })}
						</span>
						<Button
							variant="ghost"
							onclick={resetRetention}
							disabled={retDiff.length === 0 || retSaving}
						>
							{m.config_reset()}
						</Button>
						<Button
							onclick={saveRetention}
							disabled={retDiff.length === 0 || retSaving}
							loading={retSaving}
						>
							{m.config_save()}
						</Button>
					</div>
				</Card>
			{/if}
		{:else if busy}
			<Card padding="lg">
				<p class="text-sm text-[var(--color-fg-muted)]">{m.config_loading()}</p>
			</Card>
		{/if}
	</div>
{/if}

{#snippet intervalField(
	label: string,
	hint: string,
	id: string,
	value: number,
	setValue: (v: number) => void,
	fieldPresets: { label: string; ms: number }[],
	minMs: number
)}
	<Field {label} {hint} for={id}>
		<div class="flex items-center gap-2">
			<Input
				{id}
				type="number"
				min={String(minMs)}
				step="100"
				{value}
				oninput={(e) => setValue(Number((e.target as HTMLInputElement).value))}
				class="w-40 font-mono"
			/>
			<span class="text-xs text-[var(--color-fg-muted)]">ms · {fmtMs(value)}</span>
		</div>
		<div class="mt-2 flex flex-wrap gap-1.5">
			{#each fieldPresets as p (p.label)}
				<button
					type="button"
					onclick={() => setValue(p.ms)}
					class="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-0.5 text-[11px] text-[var(--color-fg-muted)] transition hover:border-[var(--color-border-strong)] hover:text-[var(--color-fg)]"
				>
					{p.label}
				</button>
			{/each}
		</div>
	</Field>
{/snippet}
