<script lang="ts">
	import { untrack, tick } from 'svelte';
	import { page } from '$app/state';
	import Banner from '$lib/components/ui/Banner.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import { profiles } from '$lib/stores/profiles.svelte';
	import { connections } from '$lib/stores/connections.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { ApiError } from '$lib/api/error';
	import { cn } from '$lib/utils/cn';
	import { m } from '$lib/paraglide/messages';
	import type { ProposedAction } from '$lib/types/api';
	import IconSparkles from '~icons/lucide/sparkles';
	import IconArrowUp from '~icons/lucide/arrow-up';
	import IconZap from '~icons/lucide/zap';
	import IconCheck from '~icons/lucide/check';
	import IconX from '~icons/lucide/x';

	let id = $derived(page.params.id ?? '');
	let profile = $derived(id ? profiles.byId(id) : undefined);
	let conn = $derived(profile ? connections.connect(profile) : null);

	$effect(() => {
		if (!conn) return;
		untrack(() => {
			conn.ensureSignedIn().catch((e) => {
				if (e instanceof ApiError)
					toast.error(m.assistant_toast_signin_failed(), { description: e.userMessage });
			});
		});
	});

	type ProposalState = 'pending' | 'applying' | 'done' | 'failed' | 'dismissed';
	interface Proposal extends ProposedAction {
		state: ProposalState;
		error?: string;
	}
	interface Entry {
		question: string;
		answer: string;
		error: string | null;
		loading: boolean;
		proposals: Proposal[];
	}

	let entries = $state<Entry[]>([]);
	let question = $state('');
	let textarea: HTMLTextAreaElement | null = $state(null);

	let busy = $derived(entries.some((e) => e.loading));
	let canSend = $derived(!!conn?.isAuthenticated && !busy && question.trim().length > 0);

	// Starter prompts shown on the empty state to make the first ask effortless.
	let examples = $derived([
		m.assistant_example_slow(),
		m.assistant_example_memory(),
		m.assistant_example_alerts()
	]);

	async function ask(raw: string) {
		const text = raw.trim();
		if (!text || busy || !conn?.isAuthenticated) return;
		question = '';
		resizeTextarea();

		const idx = entries.length;
		entries.push({ question: text, answer: '', error: null, loading: true, proposals: [] });
		await scrollToEnd();

		try {
			const res = await conn.client.ask(text);
			entries[idx].answer = res.answer;
			entries[idx].proposals = (res.proposals ?? []).map((p) => ({ ...p, state: 'pending' }));
		} catch (e) {
			entries[idx].error = e instanceof ApiError ? e.userMessage : String(e);
		} finally {
			entries[idx].loading = false;
			await scrollToEnd();
		}
	}

	// The daemon never acts on its own: a proposal is applied only here, when
	// the operator confirms, by calling the same REST endpoint any other UI
	// control would. `path` may carry a query string (e.g. kill signal).
	async function confirm(entryIdx: number, propIdx: number) {
		const p = entries[entryIdx].proposals[propIdx];
		if (!conn?.isAuthenticated || p.state === 'applying' || p.state === 'done') return;
		p.state = 'applying';
		try {
			await conn.client.request(p.path, {
				method: p.method,
				body: p.body ?? undefined,
				bypassCache: true
			});
			p.state = 'done';
			toast.success(m.assistant_toast_action_done(), { description: p.summary });
		} catch (e) {
			p.state = 'failed';
			p.error = e instanceof ApiError ? e.userMessage : String(e);
		}
	}

	function dismiss(entryIdx: number, propIdx: number) {
		entries[entryIdx].proposals[propIdx].state = 'dismissed';
	}

	async function scrollToEnd() {
		await tick();
		window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });
	}

	function resizeTextarea() {
		const el = textarea;
		if (!el) return;
		el.style.height = 'auto';
		el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
	}

	function onKeydown(e: KeyboardEvent) {
		// Enter sends; Shift+Enter inserts a newline.
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			void ask(question);
		}
	}
</script>

<div class="px-4 py-6 md:px-8 md:py-8">
	<div class="mx-auto flex min-h-[calc(100vh-8rem)] max-w-3xl flex-col">
		<header class="mb-6">
			<h1 class="flex items-center gap-2 text-[24px] font-semibold tracking-tight">
				<span
					class="flex size-7 items-center justify-center rounded-lg bg-[color-mix(in_oklab,var(--color-accent)_16%,transparent)]"
				>
					<IconSparkles class="size-[18px] text-[var(--color-accent)]" />
				</span>
				{m.assistant_title()}
			</h1>
			<p class="mt-1.5 max-w-prose text-[12px] text-[var(--color-fg-subtle)]">
				{m.assistant_intro()}
			</p>
		</header>

		<!-- Conversation. Grows to fill height so the composer sits at the bottom
		     on an empty screen and floats as history builds. -->
		<div class="flex-1 space-y-6 pb-4">
			{#if entries.length === 0}
				<div
					class="mt-4 rounded-[var(--radius-card)] bg-[var(--color-surface)] p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.03),0_0_0_1px_var(--color-border)]"
				>
					<p class="text-[13px] text-[var(--color-fg-muted)]">{m.assistant_empty_hint()}</p>
					<div class="mt-3 flex flex-wrap gap-2">
						{#each examples as ex (ex)}
							<button
								type="button"
								onclick={() => ask(ex)}
								disabled={!conn?.isAuthenticated}
								class={cn(
									'rounded-full px-3 py-1.5 text-[12.5px] text-[var(--color-fg-muted)] transition-colors',
									'bg-[var(--color-surface-2)] shadow-[inset_0_0_0_1px_var(--color-border)]',
									'hover:bg-[var(--color-surface-3)] hover:text-[var(--color-fg)] disabled:opacity-40'
								)}
							>
								{ex}
							</button>
						{/each}
					</div>
				</div>
			{/if}

			{#each entries as entry, i (entry)}
				<div class="space-y-3">
					<!-- Operator question -->
					<div class="flex justify-end">
						<div
							class="max-w-[82%] rounded-2xl rounded-br-md bg-[var(--color-accent)] px-4 py-2.5 text-[13px] leading-relaxed whitespace-pre-wrap text-[var(--color-accent-fg)]"
						>
							{entry.question}
						</div>
					</div>

					<!-- Assistant turn -->
					<div class="flex gap-2.5">
						<span
							class="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-[color-mix(in_oklab,var(--color-accent)_16%,transparent)]"
						>
							<IconSparkles class="size-4 text-[var(--color-accent)]" />
						</span>

						<div class="min-w-0 flex-1 space-y-2.5">
							{#if entry.loading}
								<div
									class="inline-flex items-center gap-1.5 rounded-2xl rounded-bl-md bg-[var(--color-surface-2)] px-4 py-3 shadow-[inset_0_0_0_1px_var(--color-border)]"
									aria-label={m.assistant_action_applying()}
								>
									{#each [0, 1, 2] as d (d)}
										<span
											class="size-1.5 animate-bounce rounded-full bg-[var(--color-fg-subtle)]"
											style="animation-delay: {d * 0.15}s"
										></span>
									{/each}
								</div>
							{:else if entry.error}
								<Banner variant="danger">{entry.error}</Banner>
							{:else}
								<div
									class="rounded-2xl rounded-bl-md bg-[var(--color-surface-2)] px-4 py-2.5 text-[13px] leading-relaxed whitespace-pre-wrap text-[var(--color-fg)] shadow-[inset_0_0_0_1px_var(--color-border)]"
								>
									{entry.answer}
								</div>
							{/if}

							{#each entry.proposals as p, pi (pi)}
								<div
									class="overflow-hidden rounded-xl bg-[var(--color-surface)] shadow-[inset_0_0_0_1px_var(--color-border)]"
								>
									<div
										class="flex items-start gap-2.5 border-l-2 border-[var(--color-warning)] p-3"
									>
										<IconZap class="mt-0.5 size-4 shrink-0 text-[var(--color-warning)]" />
										<div class="min-w-0 flex-1">
											<p class="text-[13px] font-medium text-[var(--color-fg)]">{p.summary}</p>
											<p class="mt-1">
												<span
													class="inline-block max-w-full truncate rounded bg-[var(--color-surface-2)] px-1.5 py-0.5 font-mono text-[10.5px] text-[var(--color-fg-subtle)] align-bottom"
												>
													{p.method}
													{p.path}
												</span>
											</p>

											{#if p.state === 'pending'}
												<div class="mt-2.5 flex gap-2">
													<Button size="sm" variant="primary" onclick={() => confirm(i, pi)}>
														<IconCheck class="size-3.5" />
														{m.assistant_confirm()}
													</Button>
													<Button size="sm" variant="ghost" onclick={() => dismiss(i, pi)}>
														{m.assistant_dismiss()}
													</Button>
												</div>
											{:else if p.state === 'applying'}
												<p class="mt-2 text-[12px] text-[var(--color-fg-subtle)]">
													{m.assistant_action_applying()}
												</p>
											{:else if p.state === 'done'}
												<p
													class="mt-2 inline-flex items-center gap-1 text-[12px] font-medium text-[var(--color-success)]"
												>
													<IconCheck class="size-3.5" />
													{m.assistant_action_applied()}
												</p>
											{:else if p.state === 'dismissed'}
												<p
													class="mt-2 inline-flex items-center gap-1 text-[12px] text-[var(--color-fg-subtle)]"
												>
													<IconX class="size-3.5" />
													{m.assistant_action_dismissed()}
												</p>
											{:else if p.state === 'failed'}
												<div class="mt-2">
													<Banner variant="danger">{p.error}</Banner>
												</div>
											{/if}
										</div>
									</div>
								</div>
							{/each}
						</div>
					</div>
				</div>
			{/each}
		</div>

		<!-- Composer: sticks to the viewport bottom as the conversation scrolls. -->
		<div class="sticky bottom-4 mt-2">
			<div
				class={cn(
					'flex items-end gap-2 rounded-2xl bg-[var(--color-surface)]/95 p-2 backdrop-blur',
					'shadow-[0_1px_2px_rgba(0,0,0,0.2),0_0_0_1px_var(--color-border)] transition-shadow',
					'focus-within:shadow-[0_1px_2px_rgba(0,0,0,0.2),0_0_0_1px_var(--color-accent)]'
				)}
			>
				<textarea
					bind:this={textarea}
					bind:value={question}
					oninput={resizeTextarea}
					onkeydown={onKeydown}
					disabled={!conn?.isAuthenticated}
					rows="1"
					placeholder={m.assistant_placeholder()}
					class={cn(
						'max-h-40 min-h-[2.5rem] flex-1 resize-none bg-transparent px-2.5 py-2 text-[13px] text-[var(--color-fg)]',
						'placeholder:text-[var(--color-fg-faint)] focus:outline-none disabled:opacity-50'
					)}
				></textarea>
				<Button
					size="icon"
					class="size-9 shrink-0 rounded-xl"
					onclick={() => ask(question)}
					disabled={!canSend}
					loading={busy}
					aria-label={m.assistant_send()}
				>
					<IconArrowUp class="size-4" />
				</Button>
			</div>
			<p class="mt-1.5 px-1 text-center text-[11px] text-[var(--color-fg-subtle)]">
				{m.assistant_readonly_note()}
			</p>
		</div>
	</div>
</div>
