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
	import type { ProposedAction, AssistantTraceStep } from '$lib/types/api';
	import Markdown from '$lib/components/assistant/Markdown.svelte';
	import IconSparkles from '~icons/lucide/sparkles';
	import IconArrowUp from '~icons/lucide/arrow-up';
	import IconZap from '~icons/lucide/zap';
	import IconCheck from '~icons/lucide/check';
	import IconX from '~icons/lucide/x';
	import IconCopy from '~icons/lucide/copy';
	import IconTrash from '~icons/lucide/trash-2';
	import IconWrench from '~icons/lucide/wrench';

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
		startedAt?: number;
		trace?: AssistantTraceStep[];
	}

	let entries = $state<Entry[]>([]);
	let question = $state('');
	let textarea: HTMLTextAreaElement | null = $state(null);

	let busy = $derived(entries.some((e) => e.loading));

	// The conversation survives navigation within the tab: persisted per
	// profile in sessionStorage. In-flight asks are dropped and transient
	// proposal states normalized, so a restore never resurrects a spinner.
	const storageKey = $derived(`remon.assistant.${id}`);

	$effect(() => {
		const key = storageKey;
		untrack(() => {
			try {
				const raw = sessionStorage.getItem(key);
				entries = raw ? (JSON.parse(raw) as Entry[]) : [];
			} catch {
				entries = [];
			}
		});
	});

	$effect(() => {
		const snapshot = JSON.stringify(
			entries
				.filter((e) => !e.loading)
				.map((e) => ({
					...e,
					proposals: e.proposals.map((p) =>
						p.state === 'applying' ? { ...p, state: 'pending' as const } : p
					)
				}))
		);
		untrack(() => {
			try {
				sessionStorage.setItem(storageKey, snapshot);
			} catch {
				// storage unavailable — the conversation just won't persist
			}
		});
	});

	// Coarse clock driving the "thinking · Ns" label while a question runs.
	let now = $state(Date.now());
	$effect(() => {
		if (!busy) return;
		const timer = setInterval(() => (now = Date.now()), 1000);
		return () => clearInterval(timer);
	});

	function elapsedSeconds(entry: Entry): number {
		return Math.max(0, Math.floor((now - (entry.startedAt ?? now)) / 1000));
	}

	// Dev mode: per-tab toggle (sessionStorage) that asks the server for the
	// loop trace and lets a custom system prompt be tried without a rebuild.
	// The server refuses overrides unless [assistant] dev = true, so leaving
	// this on against a locked-down daemon just yields a clear 403.
	let devMode = $state(false);
	let devSystem = $state('');
	let devModel = $state('');
	$effect(() => {
		untrack(() => {
			devMode = sessionStorage.getItem('remon.assistant.dev') === '1';
		});
	});
	function toggleDev() {
		devMode = !devMode;
		try {
			sessionStorage.setItem('remon.assistant.dev', devMode ? '1' : '0');
		} catch {
			// fine — the toggle just won't stick
		}
	}

	async function copyAnswer(text: string) {
		try {
			await navigator.clipboard.writeText(text);
			toast.success(m.assistant_copied());
		} catch {
			toast.error(m.assistant_copy_failed());
		}
	}

	function clearConversation() {
		entries = [];
		try {
			sessionStorage.removeItem(storageKey);
		} catch {
			// nothing to clean up
		}
	}
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
		entries.push({
			question: text,
			answer: '',
			error: null,
			loading: true,
			proposals: [],
			startedAt: Date.now()
		});
		await scrollToEnd();

		try {
			// Replay finished turns so follow-ups ("do all of those") resolve;
			// the daemon is stateless and caps/clips what it accepts.
			const history = entries
				.slice(0, idx)
				.filter((e) => !e.error && e.answer)
				.slice(-12)
				.map((e) => ({ question: e.question, answer: e.answer }));
			const res = await conn.client.ask(text, {
				history,
				dev: devMode
					? {
							trace: true,
							system: devSystem.trim() ? devSystem : undefined,
							model: devModel.trim() ? devModel.trim() : undefined
						}
					: undefined
			});
			entries[idx].answer = res.answer;
			entries[idx].proposals = (res.proposals ?? []).map((p) => ({ ...p, state: 'pending' }));
			entries[idx].trace = res.trace;
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
		<header class="mb-6 flex items-start justify-between gap-3">
			<div>
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
			</div>
			<div class="flex shrink-0 items-center gap-1">
				<Button
					size="icon"
					variant="ghost"
					class={devMode ? 'text-[var(--color-warning)]' : ''}
					onclick={toggleDev}
					aria-label={m.assistant_dev()}
					title={m.assistant_dev()}
				>
					<IconWrench class="size-4" />
				</Button>
				{#if entries.length > 0}
					<Button
						size="icon"
						variant="ghost"
						onclick={clearConversation}
						aria-label={m.assistant_clear()}
						title={m.assistant_clear()}
					>
						<IconTrash class="size-4" />
					</Button>
				{/if}
			</div>
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
									class="inline-flex items-center gap-2 rounded-2xl rounded-bl-md bg-[var(--color-surface-2)] px-4 py-3 shadow-[inset_0_0_0_1px_var(--color-border)]"
									aria-label={m.assistant_thinking()}
								>
									<span class="inline-flex items-center gap-1.5">
										{#each [0, 1, 2] as d (d)}
											<span
												class="size-1.5 animate-bounce rounded-full bg-[var(--color-fg-subtle)]"
												style="animation-delay: {d * 0.15}s"
											></span>
										{/each}
									</span>
									{#if elapsedSeconds(entry) >= 3}
										<span class="text-[11px] text-[var(--color-fg-subtle)]">
											{m.assistant_thinking()} · {elapsedSeconds(entry)}s
										</span>
									{/if}
								</div>
							{:else if entry.error}
								<Banner variant="danger">{entry.error}</Banner>
							{:else}
								<div>
									<div
										class="rounded-2xl rounded-bl-md bg-[var(--color-surface-2)] px-4 py-2.5 text-[13px] leading-relaxed text-[var(--color-fg)] shadow-[inset_0_0_0_1px_var(--color-border)]"
									>
										<Markdown text={entry.answer} />
									</div>
									<button
										type="button"
										onclick={() => copyAnswer(entry.answer)}
										class="mt-1 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-[var(--color-fg-faint)] transition-colors hover:text-[var(--color-fg)]"
									>
										<IconCopy class="size-3" />
										{m.assistant_copy()}
									</button>

									{#if entry.trace && entry.trace.length > 0}
										<details
											class="mt-1 rounded-xl bg-[var(--color-surface)] px-3 py-2 shadow-[inset_0_0_0_1px_var(--color-border)]"
										>
											<summary
												class="cursor-pointer text-[11px] text-[var(--color-fg-subtle)] select-none"
											>
												{m.assistant_trace()} · {entry.trace.length}
											</summary>
											<ol class="mt-2 space-y-1.5 font-mono text-[10.5px] leading-relaxed">
												{#each entry.trace as step, si (si)}
													<li class="text-[var(--color-fg-muted)]">
														{#if step.type === 'tool'}
															<span class="text-[var(--color-accent)]">{step.name}</span>
															<span class="text-[var(--color-fg-faint)]"
																>{JSON.stringify(step.args)} · {step.ms}ms</span
															>
															{#if step.result_preview}
																<div
																	class="mt-0.5 max-h-24 overflow-y-auto rounded bg-[var(--color-surface-2)] p-1.5 break-all whitespace-pre-wrap text-[var(--color-fg-subtle)]"
																>
																	{step.result_preview}
																</div>
															{/if}
														{:else}
															<span class="text-[var(--color-fg-subtle)]"
																>model · {step.ms}ms{#if step.usage}
																	· in={step.usage.input_tokens ?? 0} out={step.usage
																		.output_tokens ?? 0} cache_read={step.usage
																		.cache_read_input_tokens ?? 0}{/if}</span
															>
														{/if}
													</li>
												{/each}
											</ol>
										</details>
									{/if}
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
			{#if devMode}
				<div
					class="mb-2 rounded-xl bg-[var(--color-surface)]/95 p-2.5 backdrop-blur"
					style="box-shadow: inset 0 0 0 1px var(--color-warning)"
				>
					<p class="mb-1.5 text-[11px] font-medium text-[var(--color-warning)]">
						{m.assistant_dev()}
					</p>
					<textarea
						bind:value={devSystem}
						rows="2"
						placeholder={m.assistant_dev_system_placeholder()}
						class="w-full resize-y rounded-lg bg-[var(--color-surface-2)] px-2.5 py-2 font-mono text-[11.5px] text-[var(--color-fg)] placeholder:text-[var(--color-fg-faint)] focus:outline-none"
					></textarea>
					<input
						bind:value={devModel}
						placeholder={m.assistant_dev_model_placeholder()}
						class="mt-1.5 w-full rounded-lg bg-[var(--color-surface-2)] px-2.5 py-1.5 font-mono text-[11.5px] text-[var(--color-fg)] placeholder:text-[var(--color-fg-faint)] focus:outline-none"
					/>
					<p class="mt-1 text-[10.5px] text-[var(--color-fg-faint)]">
						{m.assistant_dev_note()}
					</p>
				</div>
			{/if}
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
				<!-- No `loading` swap here: the icon flipping to a spinner mid-send
				     reads as flicker. The thinking bubble already signals progress;
				     the button just disables. -->
				<Button
					size="icon"
					class="size-9 shrink-0 rounded-xl"
					onclick={() => ask(question)}
					disabled={!canSend}
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
