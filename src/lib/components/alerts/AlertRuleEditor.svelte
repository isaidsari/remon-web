<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import Field from '$lib/components/ui/Field.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import type {
		AlertRuleDto,
		AlertSeverity,
		AlertsSchemaResponse,
		LabelSchema,
		NamespaceSchema,
		MetricSchema,
		ProbeDetail
	} from '$lib/types/api';
	import type { Connection } from '$lib/stores/connections.svelte';
	import {
		ALERT_TEMPLATES,
		buildExpression,
		parseExpression,
		walkJsonPath,
		type AlertTemplate,
		type ParsedExpression
	} from '$lib/utils/alertExpression';
	import { cn } from '$lib/utils/cn';
	import { m } from '$lib/paraglide/messages';

	// Template IDs are stable constants; localized labels come from the message catalogue.
	function templateTitle(id: string): string {
		switch (id) {
			case 'cpu-high':
				return m.alerts_template_cpu_high_title();
			case 'mem-pressure':
				return m.alerts_template_mem_pressure_title();
			case 'disk-full':
				return m.alerts_template_disk_full_title();
			case 'inode-full':
				return m.alerts_template_inode_full_title();
			case 'swap-active':
				return m.alerts_template_swap_active_title();
			case 'load-high':
				return m.alerts_template_load_high_title();
			case 'pressure-cpu':
				return m.alerts_template_pressure_cpu_title();
			case 'service-down':
				return m.alerts_template_service_down_title();
			default:
				return id;
		}
	}
	function templateSummary(id: string): string {
		switch (id) {
			case 'cpu-high':
				return m.alerts_template_cpu_high_summary();
			case 'mem-pressure':
				return m.alerts_template_mem_pressure_summary();
			case 'disk-full':
				return m.alerts_template_disk_full_summary();
			case 'inode-full':
				return m.alerts_template_inode_full_summary();
			case 'swap-active':
				return m.alerts_template_swap_active_summary();
			case 'load-high':
				return m.alerts_template_load_high_summary();
			case 'pressure-cpu':
				return m.alerts_template_pressure_cpu_summary();
			case 'service-down':
				return m.alerts_template_service_down_summary();
			default:
				return '';
		}
	}

	interface Props {
		initial: AlertRuleDto | null;
		conn: Connection;

		// Bindable form state (the parent owns persistence)
		name: string;
		description: string;
		expression: string;
		severity: AlertSeverity;
		enabled: boolean;
		for_duration_secs: number;
		eval_interval_secs: number;
		cooldown_secs: number;
	}

	let {
		initial,
		conn,
		name = $bindable(),
		description = $bindable(),
		expression = $bindable(),
		severity = $bindable(),
		enabled = $bindable(),
		for_duration_secs = $bindable(),
		eval_interval_secs = $bindable(),
		cooldown_secs = $bindable()
	}: Props = $props();

	let schema = $state<AlertsSchemaResponse | null>(null);
	let schemaError = $state<string | null>(null);

	onMount(() => {
		(async () => {
			try {
				schema = await conn.client.alertsSchema();
			} catch (e) {
				schemaError = e instanceof Error ? e.message : String(e);
			}
		})();
	});

	type Mode = 'templates' | 'builder' | 'raw';
	// initial is read once at construct; parent re-mounts the component for a different rule.
	let mode = $state<Mode>(
		untrack(() =>
			initial ? (parseExpression(initial.expression) ? 'builder' : 'raw') : 'templates'
		)
	);

	// Builder parts mirror what `buildExpression()` consumes.
	let builder = $state<ParsedExpression>({
		namespace: '',
		field: '',
		labels: {},
		comparator: '>',
		threshold: ''
	});

	$effect(() => {
		if (!initial) return;
		untrack(() => {
			const parsed = parseExpression(initial.expression);
			if (parsed) builder = parsed;
		});
	});

	// Whenever the builder pieces change AND we're in builder mode, reflect to
	// the bound `expression` so the parent submits the latest assembly.
	$effect(() => {
		if (mode !== 'builder') return;
		expression = buildExpression(builder);
	});

	function switchTo(next: Mode) {
		if (next === 'builder' && mode === 'raw') {
			const parsed = parseExpression(expression);
			if (parsed) builder = parsed;
		}
		if (next === 'raw' && mode === 'builder') {
			// Re-stamp the expression so the textarea shows the assembled one.
			expression = buildExpression(builder);
		}
		mode = next;
	}

	function applyTemplate(t: AlertTemplate) {
		builder = { ...t.parts, labels: { ...t.parts.labels } };
		severity = t.severity;
		if (t.for_duration_secs !== undefined) for_duration_secs = t.for_duration_secs;
		if (t.cooldown_secs !== undefined) cooldown_secs = t.cooldown_secs;
		// Default a name if the user hasn't filled one yet
		if (!name) name = t.title;
		mode = 'builder';
	}

	let currentNamespace = $derived<NamespaceSchema | null>(
		schema?.namespaces.find((n) => n.name === builder.namespace) ?? null
	);
	let currentMetric = $derived<MetricSchema | null>(
		currentNamespace?.metrics.find((m) => m.name === builder.field) ?? null
	);
	let currentLabels = $derived<LabelSchema[]>(currentNamespace?.labels ?? []);

	// Promise-cached by endpoint::json_path so multiple label inputs share one fetch.
	const sourceCache = new Map<string, Promise<string[]>>();
	function fetchSource(endpoint: string, jsonPath: string): Promise<string[]> {
		const key = `${endpoint}::${jsonPath}`;
		let p = sourceCache.get(key);
		if (!p) {
			p = (async () => {
				const data = await conn.client.request<unknown>(endpoint);
				const arr = walkJsonPath(data, jsonPath);
				// dedupe & sort for a stable dropdown
				return [...new Set(arr)].sort();
			})();
			sourceCache.set(key, p);
		}
		return p;
	}

	// $derived can't be async, so we resolve async label fetches into $state.
	let labelOptions = $state<Record<string, string[]>>({});
	$effect(() => {
		const labels = currentLabels;
		for (const l of labels) {
			if (l.values && l.values.length > 0) {
				labelOptions[l.name] = l.values;
				continue;
			}
			if (l.source) {
				const src = l.source;
				fetchSource(src.endpoint, src.json_path)
					.then((opts) => {
						labelOptions = { ...labelOptions, [l.name]: opts };
					})
					.catch(() => {
						// Network failure → leave options empty; the input
						// stays free-form so the user can still type.
						labelOptions = { ...labelOptions, [l.name]: [] };
					});
			}
		}
	});

	function selectNamespace(ns: string) {
		builder = {
			namespace: ns,
			field: '',
			labels: {},
			comparator: '>',
			threshold: ''
		};
	}
	function selectField(field: string) {
		builder = { ...builder, field };
	}

	let isBool = $derived(currentMetric?.value_type === 'bool');

	// "Dynamic-metric" namespaces (today: `probe`) expose a runtime-defined
	// metric list rather than a server-side whitelist. Schema marks them
	// with `dynamic_metrics: true`. We treat the namespace's first label as
	// the "selector" — the user picks an instance (a specific probe), and
	// we then fetch that instance's emitted metrics. Generalising on schema
	// flags keeps this code working if a second dynamic-metric namespace
	// ever joins the schema.
	let isDynamicMetricNs = $derived<boolean>(currentNamespace?.dynamic_metrics === true);
	let selectorLabel = $derived<LabelSchema | null>(
		isDynamicMetricNs ? (currentLabels[0] ?? null) : null
	);
	let selectorValue = $derived<string>(
		selectorLabel ? (builder.labels[selectorLabel.name] ?? '') : ''
	);

	// The instance-detail fetcher is genuinely namespace-specific (probe today),
	// so it stays a switch keyed on namespace name. New dynamic namespaces would
	// add a branch here. Everything ABOVE this is schema-driven and generic.
	let probeDetail = $state<ProbeDetail | null>(null);
	const probeDetailCache = new Map<string, Promise<ProbeDetail | null>>();
	function fetchProbeDetail(probeName: string): Promise<ProbeDetail | null> {
		let p = probeDetailCache.get(probeName);
		if (!p) {
			p = conn.client.getProbe(probeName).catch(() => null);
			probeDetailCache.set(probeName, p);
		}
		return p;
	}
	$effect(() => {
		if (!isDynamicMetricNs || !selectorValue) {
			probeDetail = null;
			return;
		}
		if (builder.namespace === 'probe') {
			fetchProbeDetail(selectorValue).then((d) => {
				probeDetail = d;
			});
		}
		// Future dynamic-metric namespaces: add their fetcher here.
	});

	let dynamicMetricOptions = $derived<string[]>(
		probeDetail ? [...new Set(probeDetail.last_metrics.map((mm) => mm.name))].sort() : []
	);

	type DynamicLabel = { name: string; values: string[] };
	// Inspect the rows matching the chosen metric and project them into a
	// (label_key → observed_values) list. The user picks one value per key
	// to scope the rule to a single stream (e.g. `drive=C:`).
	let dynamicScopeLabels = $derived.by<DynamicLabel[]>(() => {
		if (!probeDetail || !builder.field) return [];
		const matching = probeDetail.last_metrics.filter((mm) => mm.name === builder.field);
		const byKey = new Map<string, Set<string>>();
		for (const entry of matching) {
			for (const [k, v] of Object.entries(entry.labels ?? {})) {
				let set = byKey.get(k);
				if (!set) {
					set = new Set();
					byKey.set(k, set);
				}
				set.add(v);
			}
		}
		return [...byKey.entries()]
			.sort((a, b) => a[0].localeCompare(b[0]))
			.map(([name, values]) => ({ name, values: [...values].sort() }));
	});

	function setLabel(key: string, value: string) {
		const next = { ...builder.labels };
		if (value === '') delete next[key];
		else next[key] = value;
		builder = { ...builder, labels: next };
	}

	// The selector label is rendered on its own row before the metric field;
	// pull it out of the generic labels block so it isn't drawn twice.
	let staticLabelsExcludingSelector = $derived<LabelSchema[]>(
		selectorLabel ? currentLabels.filter((l) => l.name !== selectorLabel!.name) : currentLabels
	);

	function setBoolShortcut(want: 'up' | 'down') {
		builder = {
			...builder,
			comparator: '==',
			threshold: want === 'up' ? '1' : '0'
		};
	}
</script>

<div class="flex flex-col gap-5">
	<div
		class="inline-flex self-start rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-0.5"
	>
		{#each ['templates', 'builder', 'raw'] as const as modeKey (modeKey)}
			<button
				type="button"
				onclick={() => switchTo(modeKey)}
				class={cn(
					'rounded-[6px] px-3 py-1.5 text-xs font-medium tracking-wide capitalize transition',
					mode === modeKey
						? 'bg-[var(--color-surface-2)] text-[var(--color-fg)] shadow-sm'
						: 'text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]'
				)}
			>
				{modeKey === 'templates'
					? m.alerts_editor_mode_templates()
					: modeKey === 'builder'
						? m.alerts_editor_mode_builder()
						: m.alerts_editor_mode_raw()}
			</button>
		{/each}
	</div>

	{#if schemaError}
		<p class="text-xs text-[var(--color-danger)]">
			{m.alerts_editor_schema_failed({ error: schemaError })}
		</p>
	{/if}

	{#if mode === 'templates'}
		<div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
			{#each ALERT_TEMPLATES as t (t.id)}
				<button
					type="button"
					onclick={() => applyTemplate(t)}
					class="flex flex-col gap-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-left transition hover:border-[var(--color-accent)] hover:bg-[var(--color-surface-2)]"
				>
					<div class="flex items-center justify-between">
						<span class="text-sm font-medium text-[var(--color-fg)]">{templateTitle(t.id)}</span>
						<span
							class={cn(
								'rounded-full px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide',
								t.severity === 'crit'
									? 'bg-[var(--color-danger)]/10 text-[var(--color-danger)]'
									: 'bg-[var(--color-warning)]/10 text-[var(--color-warning)]'
							)}
						>
							{t.severity}
						</span>
					</div>
					<span class="text-[11px] leading-relaxed text-[var(--color-fg-muted)]"
						>{templateSummary(t.id)}</span
					>
				</button>
			{/each}
		</div>
		<p class="text-[11px] text-[var(--color-fg-subtle)]">
			{m.alerts_editor_templates_footer()}
		</p>
	{:else if mode === 'builder'}
		{@const metricDisabledByGate = isDynamicMetricNs && selectorValue === ''}
		<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
			<Field label={m.alerts_editor_field_resource()}>
				<select
					value={builder.namespace}
					onchange={(e) => selectNamespace((e.currentTarget as HTMLSelectElement).value)}
					class="h-9 w-full rounded-[var(--radius-input)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-[13px] focus:border-[var(--color-accent)] focus:outline-none"
				>
					<option value="" disabled>{m.alerts_editor_select_resource()}</option>
					{#each schema?.namespaces ?? [] as ns (ns.name)}
						<option value={ns.name}>{ns.name}</option>
					{/each}
				</select>
				{#if currentNamespace}
					<p class="mt-1 text-[11px] leading-relaxed text-[var(--color-fg-muted)]">
						{currentNamespace.description}
					</p>
				{/if}
			</Field>

			{#if selectorLabel}
				<Field label={selectorLabel.name}>
					{#if labelOptions[selectorLabel.name]?.length}
						<select
							value={selectorValue}
							onchange={(e) =>
								setLabel(selectorLabel!.name, (e.currentTarget as HTMLSelectElement).value)}
							class="h-9 w-full rounded-[var(--radius-input)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-[13px] focus:border-[var(--color-accent)] focus:outline-none"
						>
							<option value="">{m.alerts_editor_label_pick_one()}</option>
							{#each labelOptions[selectorLabel.name] as opt (opt)}
								<option value={opt}>{opt}</option>
							{/each}
						</select>
					{:else}
						<Input
							value={selectorValue}
							oninput={(e) =>
								setLabel(selectorLabel!.name, (e.currentTarget as HTMLInputElement).value)}
							placeholder={m.alerts_editor_label_required_placeholder()}
							class="font-mono text-[12px]"
						/>
					{/if}
				</Field>
			{:else}
				<Field label={m.alerts_editor_field_metric()}>
					{#if currentNamespace?.dynamic_metrics && dynamicMetricOptions.length > 0}
						<select
							value={builder.field}
							onchange={(e) => selectField((e.currentTarget as HTMLSelectElement).value)}
							class="h-9 w-full rounded-[var(--radius-input)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-[13px] focus:border-[var(--color-accent)] focus:outline-none"
						>
							<option value="" disabled>{m.alerts_editor_select_metric()}</option>
							{#each dynamicMetricOptions as opt (opt)}
								<option value={opt}>{opt}</option>
							{/each}
						</select>
					{:else if currentNamespace?.dynamic_metrics}
						<Input
							value={builder.field}
							oninput={(e) => selectField((e.currentTarget as HTMLInputElement).value)}
							placeholder={m.alerts_editor_metric_dynamic_placeholder()}
							class="font-mono text-[12px]"
						/>
					{:else}
						<select
							value={builder.field}
							disabled={!currentNamespace}
							onchange={(e) => selectField((e.currentTarget as HTMLSelectElement).value)}
							class="h-9 w-full rounded-[var(--radius-input)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-[13px] focus:border-[var(--color-accent)] focus:outline-none disabled:opacity-50"
						>
							<option value="" disabled>{m.alerts_editor_select_metric()}</option>
							{#each currentNamespace?.metrics ?? [] as opt (opt.name)}
								<option value={opt.name}>{opt.name}{opt.unit ? ` (${opt.unit})` : ''}</option>
							{/each}
						</select>
					{/if}
					{#if currentMetric?.description}
						<p class="mt-1 text-[11px] leading-relaxed text-[var(--color-fg-muted)]">
							{currentMetric.description}
						</p>
					{/if}
				</Field>
			{/if}
		</div>

		{#if isDynamicMetricNs}
			<Field label={m.alerts_editor_field_metric()}>
				{#if metricDisabledByGate}
					<select
						disabled
						class="h-9 w-full rounded-[var(--radius-input)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-[13px] opacity-50"
					>
						<option
							>{m.alerts_editor_metric_pick_selector_first({
								label: selectorLabel?.name ?? ''
							})}</option
						>
					</select>
				{:else if dynamicMetricOptions.length > 0}
					<select
						value={builder.field}
						onchange={(e) => selectField((e.currentTarget as HTMLSelectElement).value)}
						class="h-9 w-full rounded-[var(--radius-input)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-[13px] focus:border-[var(--color-accent)] focus:outline-none"
					>
						<option value="" disabled>{m.alerts_editor_select_metric()}</option>
						{#each dynamicMetricOptions as opt (opt)}
							<option value={opt}>{opt}</option>
						{/each}
					</select>
				{:else}
					<Input
						value={builder.field}
						oninput={(e) => selectField((e.currentTarget as HTMLInputElement).value)}
						placeholder={m.alerts_editor_metric_dynamic_placeholder()}
						class="font-mono text-[12px]"
					/>
					<p class="mt-1 text-[11px] leading-relaxed text-[var(--color-fg-muted)]">
						{m.alerts_editor_metric_no_snapshot()}
					</p>
				{/if}
			</Field>

			{#if dynamicScopeLabels.length > 0}
				<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
					{#each dynamicScopeLabels as label (label.name)}
						<Field label={label.name}>
							<select
								value={builder.labels[label.name] ?? ''}
								onchange={(e) => setLabel(label.name, (e.currentTarget as HTMLSelectElement).value)}
								class="h-9 w-full rounded-[var(--radius-input)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-[13px] focus:border-[var(--color-accent)] focus:outline-none"
							>
								<option value="">{m.alerts_editor_label_any()}</option>
								{#each label.values as opt (opt)}
									<option value={opt}>{opt}</option>
								{/each}
							</select>
						</Field>
					{/each}
				</div>
			{/if}
		{/if}

		{#if staticLabelsExcludingSelector.length > 0}
			<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
				{#each staticLabelsExcludingSelector as label (label.name)}
					<Field label={`${label.name}${label.required ? ' *' : ''}`}>
						{#if labelOptions[label.name]?.length}
							<select
								value={builder.labels[label.name] ?? ''}
								onchange={(e) => setLabel(label.name, (e.currentTarget as HTMLSelectElement).value)}
								class="h-9 w-full rounded-[var(--radius-input)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-[13px] focus:border-[var(--color-accent)] focus:outline-none"
							>
								<option value=""
									>{label.required
										? m.alerts_editor_label_pick_one()
										: m.alerts_editor_label_any()}</option
								>
								{#each labelOptions[label.name] as opt (opt)}
									<option value={opt}>{opt}</option>
								{/each}
							</select>
						{:else}
							<Input
								value={builder.labels[label.name] ?? ''}
								oninput={(e) => setLabel(label.name, (e.currentTarget as HTMLInputElement).value)}
								placeholder={label.required
									? m.alerts_editor_label_required_placeholder()
									: m.alerts_editor_label_optional_placeholder()}
								class="font-mono text-[12px]"
							/>
						{/if}
					</Field>
				{/each}
			</div>
		{/if}

		<div class="grid grid-cols-1 gap-4 sm:grid-cols-[140px_1fr]">
			<Field label={m.alerts_editor_field_comparator()}>
				<select
					value={builder.comparator}
					onchange={(e) => {
						builder = { ...builder, comparator: (e.currentTarget as HTMLSelectElement).value };
					}}
					class="h-9 w-full rounded-[var(--radius-input)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-[13px] focus:border-[var(--color-accent)] focus:outline-none"
				>
					{#each schema?.comparators ?? [] as c (c.op)}
						<option value={c.op}>{c.op}</option>
					{/each}
				</select>
			</Field>
			<Field
				label={currentMetric?.unit
					? m.alerts_editor_field_threshold_with_unit({ unit: currentMetric.unit })
					: m.alerts_editor_field_threshold()}
			>
				<Input
					value={builder.threshold}
					oninput={(e) => {
						builder = {
							...builder,
							threshold: (e.currentTarget as HTMLInputElement).value
						};
					}}
					type="number"
					placeholder="0"
				/>
				{#if isBool}
					<div class="mt-2 flex gap-2">
						<Button
							type="button"
							variant="secondary"
							size="sm"
							onclick={() => setBoolShortcut('down')}
						>
							{m.alerts_editor_bool_down()}
						</Button>
						<Button
							type="button"
							variant="secondary"
							size="sm"
							onclick={() => setBoolShortcut('up')}
						>
							{m.alerts_editor_bool_up()}
						</Button>
					</div>
				{/if}
			</Field>
		</div>

		<div
			class="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2"
		>
			<div class="mb-0.5 text-[10px] uppercase tracking-wide text-[var(--color-fg-subtle)]">
				{m.alerts_editor_expression_preview_label()}
			</div>
			<code class="block font-mono text-[12px] text-[var(--color-fg)]">{expression || '—'}</code>
		</div>
	{:else}
		<Field label={m.alerts_form_expression_label()} required>
			<Input
				bind:value={expression}
				placeholder="cpu.usage_percent > 80"
				class="font-mono text-[12px]"
			/>
			<p class="mt-1 text-[11px] leading-relaxed text-[var(--color-fg-muted)]">
				{m.alerts_editor_raw_help_prefix()}
				<code class="font-mono">namespace.field&#123;label="value"&#125; comparator number</code>.
				{m.alerts_editor_raw_help_suffix()}
			</p>
		</Field>
	{/if}

	<div class="border-t border-[var(--color-border)] pt-4">
		<div class="grid grid-cols-1 gap-4">
			<Field label={m.alerts_form_name_label()} required>
				<Input bind:value={name} placeholder={m.alerts_form_name_placeholder()} />
			</Field>

			<Field label={m.alerts_form_description_label()}>
				<Input bind:value={description} placeholder={m.alerts_form_description_placeholder()} />
			</Field>

			<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
				<Field label={m.alerts_form_severity_label()}>
					<select
						bind:value={severity}
						class="h-9 w-full rounded-[var(--radius-input)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-[13px] focus:border-[var(--color-accent)] focus:outline-none"
					>
						<option value="warn">{m.alerts_severity_warn()}</option>
						<option value="crit">{m.alerts_severity_crit()}</option>
					</select>
				</Field>
				<Field label={m.alerts_form_enabled_label()}>
					<label class="flex h-9 cursor-pointer items-center gap-2 text-sm">
						<input type="checkbox" bind:checked={enabled} class="accent-[var(--color-accent)]" />
						<span class="text-[var(--color-fg-muted)]">{m.alerts_form_run_on_every_tick()}</span>
					</label>
				</Field>
			</div>

			<div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
				<Field label={m.alerts_form_for_seconds_label()}>
					<Input type="number" bind:value={for_duration_secs} min={0} max={3600} />
				</Field>
				<Field label={m.alerts_form_eval_interval_label()}>
					<Input type="number" bind:value={eval_interval_secs} min={3} max={3600} />
				</Field>
				<Field label={m.alerts_form_cooldown_label()}>
					<Input type="number" bind:value={cooldown_secs} min={0} max={86400} />
				</Field>
			</div>
		</div>
	</div>
</div>
