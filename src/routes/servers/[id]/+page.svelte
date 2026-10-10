<script lang="ts">
	import { useServer } from '$lib/server-scope';
	import { profiles } from '$lib/stores/profiles.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { confirm as confirmDialog } from '$lib/stores/confirm.svelte';
	import { ApiError } from '$lib/api/error';
	import Banner from '$lib/components/ui/Banner.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import StatusBand from '$lib/components/overview/StatusBand.svelte';
	import Markdown from '$lib/components/assistant/Markdown.svelte';
	import ScreenView from '$lib/components/screen/ScreenView.svelte';
	import { homeScreen } from '$lib/screen/home';
	import { moveAt, removeAt, type ScreenEdit } from '$lib/screen/edit';
	import { parseScreen } from '$lib/screen/spec';
	import type { Screen } from '$lib/types/screen';
	import { m } from '$lib/paraglide/messages';
	import IconPencil from '~icons/lucide/pencil';
	import IconRotateCcw from '~icons/lucide/rotate-ccw';
	import IconSparkles from '~icons/lucide/sparkles';

	// The overview is a screen: stored in the vault, changed by asking the
	// assistant (it gets the current spec and proposes the whole edited one),
	// and nudged by hand — remove a panel, move one.
	let { profile, conn } = $derived(useServer());

	let saved = $derived(homeScreen(profile.home));

	// Hand edits work on a draft until saved.
	let draft = $state<Screen | null>(null);
	let saving = $state(false);

	// An assistant edit is previewed in place until applied or discarded.
	let request = $state('');
	let asking = $state(false);
	let proposal = $state<{ raw: unknown; screen: Screen; answer: string } | null>(null);
	let reply = $state<{ text: string; error: boolean } | null>(null);

	let shown = $derived(proposal?.screen ?? draft ?? saved);
	let empty = $derived(shown.root.type === 'grid' && shown.root.children.length === 0);

	const edit: ScreenEdit = {
		remove: (path) => draft && (draft = removeAt(draft, path)),
		move: (path, delta) => draft && (draft = moveAt(draft, path, delta))
	};

	function startEditing() {
		proposal = null;
		draft = structuredClone($state.snapshot(saved)) as Screen;
	}

	async function save(next: unknown | null) {
		saving = true;
		try {
			await profiles.setHome(profile.id, next);
			toast.success(m.dashboard_toast_saved());
			return true;
		} catch (e) {
			toast.error(m.dashboard_toast_save_failed(), {
				description: e instanceof Error ? e.message : undefined
			});
			return false;
		} finally {
			saving = false;
		}
	}

	async function saveDraft() {
		if (draft && (await save($state.snapshot(draft)))) draft = null;
	}

	async function reset() {
		const ok = await confirmDialog({
			title: m.home_reset_confirm_title(),
			description: m.home_reset_confirm_description(),
			confirmLabel: m.dashboard_reset(),
			variant: 'warning'
		});
		if (!ok) return;
		if (await save(null)) draft = null;
	}

	async function askToChange() {
		const text = request.trim();
		if (!text || asking) return;
		asking = true;
		reply = null;
		proposal = null;
		try {
			const res = await conn.client.ask(text, { screen: $state.snapshot(draft ?? saved) });
			const raw = res.screens?.[0]?.screen;
			const screen = raw ? parseScreen(raw) : null;
			if (screen) {
				proposal = { raw, screen, answer: res.answer };
				request = '';
			} else {
				// Asked about the page rather than to change it.
				reply = { text: res.answer || m.home_no_change(), error: false };
			}
		} catch (e) {
			reply = { text: e instanceof ApiError ? e.userMessage : String(e), error: true };
		} finally {
			asking = false;
		}
	}

	async function applyProposal() {
		if (!proposal) return;
		if (await save(proposal.raw)) {
			proposal = null;
			draft = null;
		}
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.isComposing) {
			e.preventDefault();
			void askToChange();
		}
	}
</script>

<div class="px-4 py-6 md:px-8 md:py-8">
	<PageHeader title={m.section_overview()}>
		{#if draft}
			<Button variant="ghost" size="sm" onclick={reset}>
				<IconRotateCcw class="size-4" stroke-width="2" />
				{m.dashboard_reset()}
			</Button>
			<Button variant="ghost" size="sm" onclick={() => (draft = null)}>{m.common_cancel()}</Button>
			<Button variant="primary" size="sm" onclick={saveDraft} loading={saving}>
				{m.dashboard_save()}
			</Button>
		{:else if !proposal}
			<Button variant="secondary" size="sm" onclick={startEditing}>
				<IconPencil class="size-4" stroke-width="2" />
				{m.dashboard_edit()}
			</Button>
		{/if}
	</PageHeader>

	<div class="mb-4">
		<StatusBand {conn} />
	</div>

	<Card padding="none" class="mb-4 flex items-center gap-2 p-2 ring-1 ring-[var(--color-border)]">
		<IconSparkles class="ml-2 size-4 shrink-0 text-[var(--color-fg-subtle)]" />
		<!-- 16px on mobile so iOS doesn't zoom the page on focus -->
		<input
			bind:value={request}
			onkeydown={onKeydown}
			disabled={asking || !conn.isAuthenticated}
			placeholder={m.home_ask_placeholder()}
			aria-label={m.home_ask_placeholder()}
			enterkeyhint="send"
			class="md:text-md min-w-0 flex-1 bg-transparent px-1 py-1.5 text-base text-[var(--color-fg)] placeholder:text-[var(--color-fg-faint)] focus:outline-none disabled:opacity-50"
		/>
		<Button size="sm" onclick={askToChange} loading={asking} disabled={!request.trim()}>
			{m.home_ask_submit()}
		</Button>
	</Card>

	{#if reply}
		<div class="mb-4">
			<Banner variant={reply.error ? 'danger' : 'info'}>{reply.text}</Banner>
		</div>
	{/if}

	{#if proposal}
		<Card padding="sm" class="mb-4 space-y-3 ring-1 ring-[var(--color-accent)]">
			<p class="text-2xs font-medium tracking-wide text-[var(--color-accent)]">
				{m.home_preview()}
			</p>
			{#if proposal.answer}
				<div class="text-md leading-relaxed">
					<Markdown text={proposal.answer} />
				</div>
			{/if}
			<div class="flex gap-2">
				<Button size="sm" variant="primary" onclick={applyProposal} loading={saving}>
					{m.home_apply()}
				</Button>
				<Button size="sm" variant="ghost" onclick={() => (proposal = null)}>
					{m.home_discard()}
				</Button>
			</div>
		</Card>
	{/if}

	{#if empty}
		<EmptyState description={m.dashboard_empty()} />
	{:else}
		<ScreenView screen={shown} {conn} edit={draft && !proposal ? edit : undefined} />
	{/if}
</div>
