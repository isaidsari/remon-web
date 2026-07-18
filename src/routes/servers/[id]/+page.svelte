<script lang="ts">
	import { untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { profiles } from '$lib/stores/profiles.svelte';
	import { connections } from '$lib/stores/connections.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { ApiError } from '$lib/api/error';
	import Card from '$lib/components/ui/Card.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import DashboardGrid from '$lib/components/dashboard/DashboardGrid.svelte';
	import WidgetEditorModal from '$lib/components/dashboard/WidgetEditorModal.svelte';
	import StatusBand from '$lib/components/overview/StatusBand.svelte';
	import { defaultDashboard, normalizeDashboard, widgetId } from '$lib/dashboard/defaults';
	import { layoutNeedsLive, WIDGET_META } from '$lib/dashboard/registry';
	import type { DashboardLayout, WidgetConfig } from '$lib/types/dashboard';
	import { m } from '$lib/paraglide/messages';
	import IconPencil from '~icons/lucide/pencil';
	import IconPlus from '~icons/lucide/plus';
	import IconRotateCcw from '~icons/lucide/rotate-ccw';

	let id = $derived(page.params.id ?? '');
	let profile = $derived(id ? profiles.byId(id) : undefined);
	let conn = $derived(profile ? connections.connect(profile) : null);
	let live = $derived(conn?.live);

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
	// What the grid renders: the editable draft while editing, else the saved layout.
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

	// untrack: ensureSignedIn is idempotent; without it, status flicker retriggers the effect.
	$effect(() => {
		if (!conn) return;
		untrack(() => {
			conn.ensureSignedIn().catch((e) => {
				if (e instanceof ApiError) {
					toast.error(m.overview_toast_signin_failed(), { description: e.userMessage });
				}
			});
		});
	});

	$effect(() => {
		if (!conn || !live) return;
		if (!conn.isAuthenticated || !needsLive) return;
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
		draft = { ...draft, widgets: draft.widgets.filter((w) => w.id !== wid) };
	}

	function onEditorSave(config: WidgetConfig) {
		if (!draft) return;
		if (editorTarget) {
			draft = {
				...draft,
				widgets: draft.widgets.map((w) => (w.id === editorTarget ? { ...w, config } : w))
			};
		} else {
			const bottom = draft.widgets.reduce((max, w) => Math.max(max, w.y + w.h), 0);
			const size = WIDGET_META[config.kind]?.defaultSize ?? { w: 4, h: 3 };
			draft = {
				...draft,
				widgets: [
					...draft.widgets,
					{ id: widgetId(), x: 0, y: bottom, w: size.w, h: size.h, config }
				]
			};
		}
		editorOpen = false;
		editorTarget = null;
	}

	async function manualSignIn() {
		if (!conn) return;
		try {
			await conn.login();
			toast.success(m.overview_toast_signed_in());
		} catch (e) {
			if (e instanceof ApiError) {
				toast.error(m.overview_toast_signin_failed(), { description: e.userMessage });
			}
		}
	}
</script>

{#if profile}
	<div class="px-4 py-6 md:px-8 md:py-8">
		<header class="mb-6 flex items-center justify-between gap-3">
			<h1 class="text-[24px] font-semibold tracking-tight">{m.section_overview()}</h1>
			{#if conn?.isAuthenticated}
				<div class="flex items-center gap-2">
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
				</div>
			{/if}
		</header>

		{#if !conn?.isAuthenticated}
			{@const needsRepair = conn?.error?.needsRepair === true}
			<Card padding="lg" class="mb-6 border-[var(--color-warning)]/30">
				<div class="flex items-start justify-between gap-4">
					<div>
						<p class="font-medium">
							{conn?.status === 'authenticating'
								? m.overview_auth_signing_in()
								: needsRepair
									? m.overview_auth_credential_rejected()
									: m.overview_auth_not_signed_in()}
						</p>
						<p class="mt-1 text-sm text-[var(--color-fg-muted)]">
							{#if needsRepair}
								{m.overview_auth_needs_repair_body()}
							{:else}
								{m.overview_auth_signin_prompt()}
							{/if}
						</p>
						{#if conn?.error}
							<p class="mt-1 text-sm text-[var(--color-danger)]">{conn.error.userMessage}</p>
						{/if}
					</div>
					<div class="flex flex-shrink-0 items-center gap-2">
						{#if needsRepair}
							<Button variant="primary" onclick={() => goto(`/servers/new?replace=${id}`)}>
								{m.overview_auth_repair_button()}
							</Button>
							<Button
								variant="ghost"
								onclick={manualSignIn}
								loading={conn?.status === 'authenticating'}
							>
								{m.overview_auth_retry_button()}
							</Button>
						{:else}
							<Button onclick={manualSignIn} loading={conn?.status === 'authenticating'}>
								{m.overview_auth_signin_button()}
							</Button>
						{/if}
					</div>
				</div>
			</Card>
		{/if}

		{#if conn?.isAuthenticated}
			<div class="mb-4">
				<StatusBand {conn} />
			</div>
			{#if editing && layout.widgets.length === 0}
				<Card padding="lg" class="border-dashed text-center">
					<p class="text-sm text-[var(--color-fg-muted)]">{m.dashboard_empty()}</p>
				</Card>
			{/if}
			<DashboardGrid
				{layout}
				{conn}
				{editing}
				onConfigure={openConfigure}
				onRemove={removeWidget}
			/>
		{/if}
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
{/if}
