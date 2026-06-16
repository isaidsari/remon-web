<script lang="ts">
	import Modal from '$lib/components/ui/Modal.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Field from '$lib/components/ui/Field.svelte';
	import type { Connection } from '$lib/stores/connections.svelte';
	import type { WidgetConfig, WidgetKind } from '$lib/types/dashboard';
	import type { ProbeListEntry, ProbeMetric } from '$lib/types/api';
	import { labelKey, formatLabels } from '$lib/utils/probeMetrics';
	import { m } from '$lib/paraglide/messages';

	interface Props {
		open: boolean;
		conn: Connection | null;
		/** Existing config to edit, or null to create a new widget. */
		initial: WidgetConfig | null;
		onSave: (config: WidgetConfig) => void;
		onClose: () => void;
	}

	let { open, conn, initial, onSave, onClose }: Props = $props();

	// Local form state, seeded whenever the modal opens.
	let kind = $state<WidgetKind>('live-kpi');
	let liveSource = $state<'cpu' | 'memory' | 'disk-io' | 'network'>('cpu');
	let histResource = $state<'cpu' | 'memory' | 'disk' | 'network'>('cpu');
	let histRange = $state<'30m' | '1h' | '6h' | '24h' | '7d' | '30d'>('1h');
	let summary = $state<'host' | 'services' | 'containers' | 'alerts'>('host');
	let probe = $state('');
	let metric = $state('');
	// '' = auto (widget falls back to the most-populated label-set).
	let labelSel = $state('');
	let viz = $state<'scalar' | 'chart'>('chart');
	// Unit captured at pick time; history API doesn't echo it back, so keep it in form state.
	let unitSel = $state<string | undefined>(undefined);

	// Probe picker data
	let probeList = $state<ProbeListEntry[]>([]);
	let metricsForProbe = $state<ProbeMetric[]>([]);
	let probesLoading = $state(false);
	let metricsLoading = $state(false);

	// Seed form from `initial` each time the modal opens.
	let lastOpen = false;
	$effect(() => {
		if (open && !lastOpen) {
			seed();
			void loadProbes();
		}
		lastOpen = open;
	});

	function seed() {
		// Reset every field first so stale values can't leak across widget kinds.
		kind = 'live-kpi';
		liveSource = 'cpu';
		histResource = 'cpu';
		histRange = '1h';
		summary = 'host';
		probe = '';
		metric = '';
		labelSel = '';
		viz = 'chart';
		unitSel = undefined;
		metricsForProbe = [];
		if (!initial) return;
		kind = initial.kind;
		if (initial.kind === 'live-kpi') liveSource = initial.source;
		else if (initial.kind === 'history-chart') {
			histResource = initial.resource;
			histRange = initial.range;
		} else if (initial.kind === 'status-summary') summary = initial.summary;
		else if (initial.kind === 'probe-metric') {
			probe = initial.probe;
			metric = initial.metric;
			labelSel = initial.labelKey ?? '';
			viz = initial.viz;
			unitSel = initial.unit;
			void loadMetrics(initial.probe);
		}
	}

	async function loadProbes() {
		if (!conn?.isAuthenticated || probeList.length > 0) return;
		probesLoading = true;
		try {
			const res = await conn.client.listProbes();
			probeList = res.probes;
		} catch {
			// leave empty; the field just shows no options
		} finally {
			probesLoading = false;
		}
	}

	async function loadMetrics(name: string) {
		if (!conn?.isAuthenticated || !name) {
			metricsForProbe = [];
			return;
		}
		metricsLoading = true;
		try {
			const detail = await conn.client.getProbe(name);
			// Keep every (name × label-set) entry — label options come from these.
			metricsForProbe = detail.last_metrics;
		} catch {
			metricsForProbe = [];
		} finally {
			metricsLoading = false;
		}
	}

	function onProbeChange(name: string) {
		probe = name;
		metric = '';
		labelSel = '';
		unitSel = undefined;
		void loadMetrics(name);
	}

	function onMetricChange(name: string) {
		metric = name;
		labelSel = '';
		// Capture the unit now, while we still have the probe's metric list.
		unitSel = metricsForProbe.find((mt) => mt.name === name)?.unit;
	}

	// Unique metric names for the metric dropdown.
	let metricNames = $derived([...new Set(metricsForProbe.map((mt) => mt.name))]);
	// Entries (one per label-set) for the chosen metric name.
	let labelEntries = $derived(metricsForProbe.filter((mt) => mt.name === metric));
	let labelOptions = $derived(
		labelEntries.map((mt) => ({ key: labelKey(mt.labels ?? {}), label: formatLabels(mt.labels) }))
	);
	let showLabelPicker = $derived(labelOptions.length > 1);

	let canSave = $derived(kind !== 'probe-metric' || (probe !== '' && metric !== ''));

	function build(): WidgetConfig {
		switch (kind) {
			case 'live-kpi':
				return { kind: 'live-kpi', source: liveSource };
			case 'history-chart':
				return { kind: 'history-chart', resource: histResource, range: histRange };
			case 'status-summary':
				return { kind: 'status-summary', summary };
			case 'memory-detail':
				return { kind: 'memory-detail' };
			case 'cpu-detail':
				return { kind: 'cpu-detail' };
			case 'probe-metric':
				return {
					kind: 'probe-metric',
					probe,
					metric,
					unit: unitSel,
					labelKey: labelSel || undefined,
					viz
				};
		}
	}

	function save() {
		if (!canSave) return;
		onSave(build());
	}

	const KIND_OPTS: { value: WidgetKind; label: () => string }[] = [
		{ value: 'live-kpi', label: () => m.dashboard_widget_live_kpi() },
		{ value: 'history-chart', label: () => m.dashboard_widget_history_chart() },
		{ value: 'probe-metric', label: () => m.dashboard_widget_probe_metric() },
		{ value: 'status-summary', label: () => m.dashboard_widget_status_summary() },
		{ value: 'memory-detail', label: () => m.dashboard_widget_memory_detail() },
		{ value: 'cpu-detail', label: () => m.dashboard_widget_cpu_detail() }
	];

	const selectCls =
		'w-full rounded-[var(--radius-input)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2.5 py-2 text-sm text-[var(--color-fg)] focus:border-[var(--color-accent)] focus:outline-none';
</script>

<Modal
	{open}
	{onClose}
	title={initial ? m.dashboard_edit_widget_title() : m.dashboard_add_widget_title()}
	width="sm"
>
	<div class="flex flex-col gap-4">
		<Field label={m.dashboard_field_kind()}>
			<select
				class={selectCls}
				value={kind}
				onchange={(e) => (kind = e.currentTarget.value as WidgetKind)}
			>
				{#each KIND_OPTS as o (o.value)}
					<option value={o.value}>{o.label()}</option>
				{/each}
			</select>
		</Field>

		{#if kind === 'live-kpi'}
			<Field label={m.dashboard_field_source()}>
				<select
					class={selectCls}
					value={liveSource}
					onchange={(e) => (liveSource = e.currentTarget.value as typeof liveSource)}
				>
					<option value="cpu">{m.overview_metric_cpu_label()}</option>
					<option value="memory">{m.overview_metric_memory_label()}</option>
					<option value="disk-io">{m.overview_metric_disk_io_label()}</option>
					<option value="network">{m.overview_metric_network_label()}</option>
				</select>
			</Field>
		{:else if kind === 'history-chart'}
			<Field label={m.dashboard_field_resource()}>
				<select
					class={selectCls}
					value={histResource}
					onchange={(e) => (histResource = e.currentTarget.value as typeof histResource)}
				>
					<option value="cpu">{m.metrics_card_cpu_title()}</option>
					<option value="memory">{m.metrics_card_memory_title()}</option>
					<option value="disk">{m.metrics_card_disk_title()}</option>
					<option value="network">{m.metrics_card_network_title()}</option>
				</select>
			</Field>
			<Field label={m.dashboard_field_range()}>
				<select
					class={selectCls}
					value={histRange}
					onchange={(e) => (histRange = e.currentTarget.value as typeof histRange)}
				>
					{#each ['30m', '1h', '6h', '24h', '7d', '30d'] as r (r)}
						<option value={r}>{r}</option>
					{/each}
				</select>
			</Field>
		{:else if kind === 'status-summary'}
			<Field label={m.dashboard_field_summary()}>
				<select
					class={selectCls}
					value={summary}
					onchange={(e) => (summary = e.currentTarget.value as typeof summary)}
				>
					<option value="host">{m.dashboard_summary_host()}</option>
					<option value="services">{m.section_services()}</option>
					<option value="containers">{m.section_docker()}</option>
					<option value="alerts">{m.section_alerts()}</option>
				</select>
			</Field>
		{:else if kind === 'probe-metric'}
			<Field label={m.dashboard_field_probe()}>
				<select
					class={selectCls}
					value={probe}
					onchange={(e) => onProbeChange(e.currentTarget.value)}
					disabled={probesLoading}
				>
					<option value="" disabled
						>{probesLoading ? m.dashboard_loading() : m.dashboard_pick_probe()}</option
					>
					{#each probeList as p (p.name)}
						<option value={p.name}>{p.name}</option>
					{/each}
				</select>
			</Field>
			{#if probe}
				<Field label={m.dashboard_field_metric()}>
					<select
						class={selectCls}
						value={metric}
						onchange={(e) => onMetricChange(e.currentTarget.value)}
						disabled={metricsLoading}
					>
						<option value="" disabled
							>{metricsLoading ? m.dashboard_loading() : m.dashboard_pick_metric()}</option
						>
						{#each metricNames as name (name)}
							{@const unit = metricsForProbe.find((mt) => mt.name === name)?.unit}
							<option value={name}>{name}{unit ? ` (${unit})` : ''}</option>
						{/each}
					</select>
				</Field>
			{/if}
			{#if showLabelPicker}
				<Field label={m.dashboard_field_label()} hint={m.dashboard_label_auto_hint()}>
					<select
						class={selectCls}
						value={labelSel}
						onchange={(e) => (labelSel = e.currentTarget.value)}
					>
						<option value="">{m.dashboard_label_auto()}</option>
						{#each labelOptions as o (o.key)}
							<option value={o.key}>{o.label}</option>
						{/each}
					</select>
				</Field>
			{/if}
			<Field label={m.dashboard_field_viz()}>
				<select
					class={selectCls}
					value={viz}
					onchange={(e) => (viz = e.currentTarget.value as typeof viz)}
				>
					<option value="chart">{m.dashboard_viz_chart()}</option>
					<option value="scalar">{m.dashboard_viz_scalar()}</option>
				</select>
			</Field>
		{/if}
	</div>

	{#snippet footer()}
		<Button variant="ghost" size="sm" onclick={onClose}>{m.common_cancel()}</Button>
		<Button variant="primary" size="sm" onclick={save} disabled={!canSave}>
			{initial ? m.dashboard_save() : m.dashboard_add_widget()}
		</Button>
	{/snippet}
</Modal>
