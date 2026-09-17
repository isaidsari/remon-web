<script lang="ts">
	import { useServer } from '$lib/server-scope';
	import { profiles } from '$lib/stores/profiles.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import DashboardGrid from '$lib/components/dashboard/DashboardGrid.svelte';
	import WidgetEditorModal from '$lib/components/dashboard/WidgetEditorModal.svelte';
	import StatusBand from '$lib/components/overview/StatusBand.svelte';
	import { defaultDashboard, normalizeDashboard, widgetId } from '$lib/dashboard/defaults';
	import { compact, findSlot } from '$lib/dashboard/layout';
	import { layoutNeedsLive, WIDGET_META } from '$lib/dashboard/registry';
	import type { DashboardLayout, Widget, WidgetConfig } from '$lib/types/dashboard';
	import { m } from '$lib/paraglide/messages';
	import IconPencil from '~icons/lucide/pencil';
	import IconPlus from '~icons/lucide/plus';
	import IconRotateCcw from '~icons/lucide/rotate-ccw';

	let { profile, conn } = $derived(useServer());
	let live = $derived(conn.live);

	let editing = $state(false);
	let draft = $state<DashboardLayout | null>(null);
	let saving = $state(false);
	let editorOpen = $state(false);
	// Widget id being configured, or null when adding a new one.
	let editorTarget = $state<string | null>(null);
	let fallbackProfileId = $state<string | null>(null);
	let fallbackDashboard = $state<DashboardLayout>(defaultDashboard());

	// Saved layout (or a generated default for v1 / fresh profiles).
	let saved = $derived(
		profile?.dashboard ? normalizeDashboard(profile.dashboard) : fallbackDashboard
	);
	let layout = $derived(editing && draft ? draft : saved);
	let needsLive = $derived(layoutNeedsLive(layout));

	let editorInitial = $derived<WidgetConfig | null>(
		editorTarget && draft
			? (draft.widgets.find((w) => w.id === editorTarget)?.config ?? null)
			: null
	);

	$effect(() => {
		const nextProfileId = profile?.id ?? null;
		if (nextProfileId === fallbackProfileId) return;
		fallbackProfileId = nextProfileId;
		fallbackDashboard = defaultDashboard();
	});

	$effect(() => {
		if (!needsLive) return;
		live.acquire();
		return () => live.release();
	});

	function enterEdit() {
		draft = structuredClone($state.snapshot(saved)) as DashboardLayout;
		editing = true;
	}

	function cancelEdit() {
		editing = false;
		draft = null;
	}

	async function saveEdit() {
		if (!draft || !profile) return;
		saving = true;
		try {
			await profiles.setDashboard(profile.id, normalizeDashboard($state.snapshot(draft)));
			toast.success(m.dashboard_toast_saved());
			editing = false;
			draft = null;
		} catch (e) {
			toast.error(m.dashboard_toast_save_failed(), {
				description: e instanceof Error ? e.message : undefined
			});
		} finally {
			saving = false;
		}
	}

	function resetDefault() {
		draft = defaultDashboard();
	}

	function openAdd() {
		editorTarget = null;
		editorOpen = true;
	}

	function openConfigure(wid: string) {
		editorTarget = wid;
		editorOpen = true;
	}

	function removeWidget(wid: string) {
		if (!draft) return;
		draft = { ...draft, widgets: compact(draft.widgets.filter((w) => w.id !== wid)) };
	}

	function applyLayout(widgets: Widget[]) {
		if (!draft) return;
		draft = { ...draft, widgets };
	}

	function onEditorSave(config: WidgetConfig) {
		if (!draft) return;
		if (editorTarget) {
			draft = {
				...draft,
				widgets: draft.widgets.map((w) => (w.id === editorTarget ? { ...w, config } : w))
			};
		} else {
			const size = WIDGET_META[config.kind]?.defaultSize ?? { w: 4, h: 3 };
			const slot = findSlot(draft.widgets, size.w, size.h);
			draft = {
				...draft,
				widgets: [
					...draft.widgets,
					{ id: widgetId(), x: slot.x, y: slot.y, w: size.w, h: size.h, config }
				]
			};
		}
		editorOpen = false;
		editorTarget = null;
	}
</script>

<div class="px-4 py-6 md:px-8 md:py-8">
	<PageHeader title={m.section_overview()}>
		{#if editing}
			<Button variant="secondary" size="sm" onclick={openAdd}>
				<IconPlus class="size-4" stroke-width="2" />
				{m.dashboard_add_widget()}
			</Button>
			<Button variant="ghost" size="sm" onclick={resetDefault}>
				<IconRotateCcw class="size-4" stroke-width="2" />
				{m.dashboard_reset()}
			</Button>
			<Button variant="ghost" size="sm" onclick={cancelEdit}>{m.common_cancel()}</Button>
			<Button variant="primary" size="sm" onclick={saveEdit} loading={saving}>
				{m.dashboard_save()}
			</Button>
		{:else}
			<Button variant="secondary" size="sm" onclick={enterEdit}>
				<IconPencil class="size-4" stroke-width="2" />
				{m.dashboard_edit()}
			</Button>
		{/if}
	</PageHeader>

	<div class="mb-4">
		<StatusBand {conn} />
	</div>
	{#if editing && layout.widgets.length === 0}
		<EmptyState description={m.dashboard_empty()} />
	{/if}
	<DashboardGrid
		{layout}
		{conn}
		{editing}
		onConfigure={openConfigure}
		onRemove={removeWidget}
		onLayoutChange={applyLayout}
	/>
</div>

<WidgetEditorModal
	open={editorOpen}
	{conn}
	initial={editorInitial}
	onSave={onEditorSave}
	onClose={() => {
		editorOpen = false;
		editorTarget = null;
	}}
/>
