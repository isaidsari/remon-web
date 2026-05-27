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
	import type { ConfigResponse, UpdateConfigRequest } from '$lib/types/api';
	import { m } from '$lib/paraglide/messages';

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
		rollup_ms: number;
		retention_ms: number;
	};

	function fromResponse(c: ConfigResponse): EditableConfig {
		return {
			server_name: c.server_name,
			stats_ms: c.collector_stats_interval_ms,
			processes_ms: c.collector_processes_interval_ms,
			docker_ms: c.collector_docker_interval_ms,
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
		if (conn?.isAuthenticated) load();
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
		if (form.rollup_ms !== original.rollup_tick_interval_ms)
			d.rollup_tick_interval_ms = form.rollup_ms;
		if (form.retention_ms !== original.retention_tick_interval_ms)
			d.retention_tick_interval_ms = form.retention_ms;
		return d;
	});

	let dirty = $derived(Object.keys(diff).length > 0);

	// Docker collector is compiled out on servers built --no-default-features;
	// the API then reports interval 0. Hide the field and skip its validation.
	let dockerEnabled = $derived(original ? original.collector_docker_interval_ms !== 0 : false);

	// Server enforces >= 1000 ms for collector intervals (sub-second sampling
	// collides with second-resolution metric PKs). Mirror that floor here.
	const MIN_INTERVAL_MS = 1000;

	let validationError = $derived.by((): string | null => {
		if (!form) return null;
		if (!form.server_name.trim()) return m.config_validation_server_name_empty();
		const intervals: [string, number][] = [
			[m.config_interval_label_stats(), form.stats_ms],
			[m.config_interval_label_processes(), form.processes_ms],
			...(dockerEnabled
				? [[m.config_interval_label_docker(), form.docker_ms] as [string, number]]
				: []),
			[m.config_interval_label_rollup(), form.rollup_ms],
			[m.config_interval_label_retention(), form.retention_ms]
		];
		for (const [label, v] of intervals) {
			if (!Number.isFinite(v) || v < MIN_INTERVAL_MS) return m.config_validation_min({ label });
			if (v > 24 * 3600 * 1000) return m.config_validation_max({ label });
		}
		return null;
	});

	async function save() {
		if (!conn?.isAuthenticated || !dirty || validationError) return;
		saving = true;
		try {
			const updated = await conn.client.patchConfig(diff);
			original = updated;
			form = fromResponse(updated);
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

	function fmtMs(ms: number): string {
		if (ms < 1000) return `${ms}ms`;
		if (ms < 60000) return `${(ms / 1000).toFixed(ms % 1000 === 0 ? 0 : 1)}s`;
		if (ms < 3600000) return `${(ms / 60000).toFixed(ms % 60000 === 0 ? 0 : 1)}m`;
		return `${(ms / 3600000).toFixed(ms % 3600000 === 0 ? 0 : 1)}h`;
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
						hint={m.config_field_server_name_hint()}
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
							(v) => (form!.stats_ms = v)
						)}
						{@render intervalField(
							m.config_interval_label_processes(),
							m.config_interval_hint_processes(),
							'processes',
							form.processes_ms,
							(v) => (form!.processes_ms = v)
						)}
						{#if dockerEnabled}
							{@render intervalField(
								m.config_interval_label_docker(),
								m.config_interval_hint_docker(),
								'docker',
								form.docker_ms,
								(v) => (form!.docker_ms = v)
							)}
						{/if}
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
							(v) => (form!.rollup_ms = v)
						)}
						{@render intervalField(
							m.config_interval_label_retention(),
							m.config_interval_hint_retention(),
							'retention',
							form.retention_ms,
							(v) => (form!.retention_ms = v)
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
	setValue: (v: number) => void
)}
	<Field {label} {hint} for={id}>
		<div class="flex items-center gap-2">
			<Input
				{id}
				type="number"
				min="1000"
				step="100"
				{value}
				oninput={(e) => setValue(Number((e.target as HTMLInputElement).value))}
				class="w-40 font-mono"
			/>
			<span class="text-xs text-[var(--color-fg-muted)]">ms · {fmtMs(value)}</span>
		</div>
		<div class="mt-2 flex flex-wrap gap-1.5">
			{#each presets as p (p.label)}
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
