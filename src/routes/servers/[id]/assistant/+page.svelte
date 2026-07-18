<script lang="ts">
	import { untrack, tick } from 'svelte';
	import { page } from '$app/state';
	import Banner from '$lib/components/ui/Banner.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import { profiles } from '$lib/stores/profiles.svelte';
	import { connections } from '$lib/stores/connections.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { confirm as confirmDialog } from '$lib/stores/confirm.svelte';
	import { ApiError } from '$lib/api/error';
	import { cn } from '$lib/utils/cn';
	import { m } from '$lib/paraglide/messages';
	import type { ProposedAction, AssistantTraceStep } from '$lib/types/api';
	import Markdown from '$lib/components/assistant/Markdown.svelte';
	import IconBotMessageSquare from '~icons/lucide/bot-message-square';
	import IconArrowUp from '~icons/lucide/arrow-up';
	import IconArrowDown from '~icons/lucide/arrow-down';
	import IconSquare from '~icons/lucide/square';
	import IconZap from '~icons/lucide/zap';
	import IconCheck from '~icons/lucide/check';
	import IconX from '~icons/lucide/x';
	import IconCopy from '~icons/lucide/copy';
	import IconTrash from '~icons/lucide/trash-2';
	import IconWrench from '~icons/lucide/wrench';
	import IconGauge from '~icons/lucide/gauge';
	import IconMemoryStick from '~icons/lucide/memory-stick';
	import IconTriangleAlert from '~icons/lucide/triangle-alert';

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
	let aborter: AbortController | null = null;

	let busy = $derived(entries.some((e) => e.loading));

	// Mirrors the sidebar's connection dot so the state stays visible on
	// mobile, where the sidebar is hidden behind the drawer.
	let connectionTone = $derived(
		conn?.isAuthenticated
			? conn.live.status === 'open'
				? 'online'
				: 'idle'
			: conn?.status === 'authenticating'
				? 'connecting'
				: 'offline'
	);

	// The conversation survives navigation within the tab: persisted per
	// profile in sessionStorage. In-flight asks are dropped and transient
	// proposal states normalized, so a restore never resurrects a spinner.
	const storageKey = $derived(`remon.assistant.${id}`);

	// Tolerates stale or foreign payloads (older Entry shapes, hand-edited
	// storage): anything that doesn't look like a finished turn is dropped
	// rather than crashing the render.
	function readStoredEntries(key: string): Entry[] {
		try {
			const parsed: unknown = JSON.parse(sessionStorage.getItem(key) ?? '[]');
			if (!Array.isArray(parsed)) return [];
			return parsed
				.filter(
					(e): e is Entry =>
						!!e &&
						typeof e === 'object' &&
						typeof (e as Entry).question === 'string' &&
						typeof (e as Entry).answer === 'string'
				)
				.map((e) => ({
					...e,
					loading: false,
					error: e.error ?? null,
					proposals: Array.isArray(e.proposals) ? e.proposals : []
				}));
		} catch {
			return [];
		}
	}

	$effect(() => {
		const key = storageKey;
		untrack(() => {
			entries = readStoredEntries(key);
			if (entries.length > 0) void scrollToEnd(false);
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

	async function clearConversation() {
		const ok = await confirmDialog({
			title: m.assistant_clear_confirm_title(),
			description: m.assistant_clear_confirm_description(),
			confirmLabel: m.assistant_clear(),
			variant: 'warning'
		});
		if (!ok) return;
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
		{ label: m.assistant_example_slow(), icon: IconGauge },
		{ label: m.assistant_example_memory(), icon: IconMemoryStick },
		{ label: m.assistant_example_alerts(), icon: IconTriangleAlert }
	]);

	async function ask(raw: string) {
		const text = raw.trim();
		if (!text || busy || !conn?.isAuthenticated) return;
		question = '';
		resizeTextarea();

		// Mutate through the proxy the array hands back — not an index — so a
		// clear() while the ask is in flight detaches this turn harmlessly
		// instead of writing into whatever now occupies that slot.
		entries.push({
			question: text,
			answer: '',
			error: null,
			loading: true,
			proposals: [],
			startedAt: Date.now()
		});
		const entry = entries[entries.length - 1];
		await scrollToEnd();

		const ctrl = new AbortController();
		aborter = ctrl;
		try {
			// Replay finished turns so follow-ups ("do all of those") resolve;
			// the daemon is stateless and caps/clips what it accepts.
			const history = entries
				.filter((e) => e !== entry && !e.error && e.answer)
				.slice(-12)
				.map((e) => ({ question: e.question, answer: e.answer }));
			const res = await conn.client.ask(text, {
				history,
				signal: ctrl.signal,
				dev: devMode
					? {
							trace: true,
							system: devSystem.trim() ? devSystem : undefined,
							model: devModel.trim() ? devModel.trim() : undefined
						}
					: undefined
			});
			entry.answer = res.answer;
			entry.proposals = (res.proposals ?? []).map((p) => ({ ...p, state: 'pending' }));
			entry.trace = res.trace;
		} catch (e) {
			// A stop is not a failure: drop the pending turn and hand the
			// question back so it can be edited and re-sent.
			if (ctrl.signal.aborted) {
				const at = entries.indexOf(entry);
				if (at !== -1) entries.splice(at, 1);
				if (!question.trim()) {
					question = text;
					await tick();
					resizeTextarea();
				}
				return;
			}
			entry.error = e instanceof ApiError ? e.userMessage : String(e);
		} finally {
			if (aborter === ctrl) aborter = null;
			entry.loading = false;
		}
		// Reading back through the history is respected: only follow the
		// answer down when the view is already pinned to the end.
		if (atBottom) await scrollToEnd();
	}

	const PROPOSAL_METHODS = new Set(['POST', 'PUT', 'DELETE']);

	// The daemon never acts on its own: a proposal is applied only here, when
	// the operator confirms, by calling the same REST endpoint any other UI
	// control would. `path` may carry a query string (e.g. kill signal).
	async function applyProposal(entryIdx: number, propIdx: number) {
		const p = entries[entryIdx].proposals[propIdx];
		if (!conn?.isAuthenticated || p.state === 'applying' || p.state === 'done') return;
		// Defense in depth: the daemon builds these paths from templates, but
		// never let one retarget the confirm off this API — an absolute URL
		// would override baseUrl in `new URL(...)` and leak the bearer token.
		if (!PROPOSAL_METHODS.has(p.method) || !p.path.startsWith('/') || p.path.startsWith('//')) {
			p.state = 'failed';
			p.error = m.assistant_action_invalid_path();
			return;
		}
		p.state = 'applying';
		try {
			await conn.client.request(p.path, {
				method: p.method,
				body: p.body ?? undefined
			});
			p.state = 'done';
			toast.success(m.assistant_toast_action_done(), { description: p.summary });
		} catch (e) {
			p.state = 'failed';
			p.error = e instanceof ApiError ? e.userMessage : String(e);
		}
	}

	function dismissProposal(entryIdx: number, propIdx: number) {
		entries[entryIdx].proposals[propIdx].state = 'dismissed';
	}

	// The conversation scrolls in its own region (not the window) so the
	// composer stays docked and mobile keyboards don't fight sticky layout.
	let scroller: HTMLDivElement | null = $state(null);
	let atBottom = $state(true);

	function onScroll() {
		const el = scroller;
		if (!el) return;
		atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 96;
	}

	async function scrollToEnd(smooth = true) {
		await tick();
		scroller?.scrollTo({
			top: scroller.scrollHeight,
			behavior: smooth ? 'smooth' : 'auto'
		});
	}

	function resizeTextarea() {
		const el = textarea;
		if (!el) return;
		el.style.height = 'auto';
		el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
		// Scrollbar only once the height cap is hit — otherwise a wrapping
		// placeholder alone summons one.
		el.style.overflowY = el.scrollHeight > 160 ? 'auto' : 'hidden';
	}

	function onKeydown(e: KeyboardEvent) {
		// Enter sends; Shift+Enter inserts a newline. Enter that commits an
		// IME composition (Japanese, Chinese, …) must not send — isComposing
		// flags it.
		if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
			e.preventDefault();
			void ask(question);
		}
	}
</script>

<!-- App-frame chat: toolbar / scrolling conversation / docked composer fill
     the viewport below the 3rem app header. dvh keeps the composer above the
     collapsing URL bar on mobile. -->
<div class="flex h-[calc(100dvh-3rem)] flex-col">
	<header
		class="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-[var(--color-border)] px-3 md:px-5"
	>
		<div class="flex min-w-0 items-center gap-2">
			<IconBotMessageSquare class="size-4 shrink-0 text-[var(--color-accent)]" />
			<h1 class="truncate text-[13px] font-semibold tracking-tight">{m.assistant_title()}</h1>
			<span
				class={cn(
					'ml-0.5 size-2 shrink-0 rounded-full',
					connectionTone === 'online'
						? 'bg-[var(--color-success)] shadow-[0_0_6px_rgba(52,211,153,0.55)]'
						: connectionTone === 'connecting'
							? 'bg-[var(--color-warning)]'
							: connectionTone === 'offline'
								? 'bg-[var(--color-danger)]'
								: 'bg-[var(--color-fg-faint)]'
				)}
				title={connectionTone === 'online' ? m.detail_status_live() : connectionTone}
				aria-label={connectionTone === 'online' ? m.detail_status_live() : connectionTone}
			></span>
		</div>
		<div class="flex shrink-0 items-center gap-0.5">
			<Button
				size="icon"
				variant="ghost"
				class={cn(devMode && 'text-[var(--color-warning)]')}
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
					disabled={busy}
					aria-label={m.assistant_clear()}
					title={m.assistant_clear()}
				>
					<IconTrash class="size-4" />
				</Button>
			{/if}
		</div>
	</header>

	<div bind:this={scroller} onscroll={onScroll} class="flex-1 overflow-y-auto overscroll-contain">
		<div
			class={cn(
				'mx-auto flex min-h-full w-full max-w-3xl flex-col px-4 pt-6 pb-4 md:px-6',
				entries.length > 0 && 'gap-8'
			)}
		>
			{#if entries.length === 0}
				<div class="enter m-auto flex w-full max-w-md flex-col items-center pb-10 text-center">
					<span
						class="flex size-12 items-center justify-center rounded-2xl bg-[var(--color-accent-bg)] shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--color-accent)_25%,transparent),0_0_40px_-10px_var(--color-accent-glow)]"
					>
						<IconBotMessageSquare class="size-5 text-[var(--color-accent)]" />
					</span>
					<p class="mt-4 max-w-sm text-[13px] leading-relaxed text-[var(--color-fg-muted)]">
						{m.assistant_intro()}
					</p>
					<p class="mt-7 text-[11px] font-medium tracking-wide text-[var(--color-fg-subtle)]">
						{m.assistant_empty_hint()}
					</p>
					<div
						class="mt-3 flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:justify-center"
					>
						{#each examples as ex (ex.label)}
							{@const Icon = ex.icon}
							<button
								type="button"
								onclick={() => ask(ex.label)}
								disabled={!conn?.isAuthenticated}
								class={cn(
									'group flex items-center gap-2.5 rounded-xl bg-[var(--color-surface)] px-3.5 py-2.5 text-left text-[13px] text-[var(--color-fg-muted)]',
									'shadow-[var(--shadow-flat)] transition-all duration-[var(--dur-fast)]',
									'hover:text-[var(--color-fg)] hover:shadow-[var(--shadow-flat-hover)]',
									'disabled:cursor-not-allowed disabled:opacity-40',
									'sm:rounded-full sm:py-2'
								)}
							>
								<Icon
									class="size-4 shrink-0 text-[var(--color-fg-subtle)] transition-colors duration-[var(--dur-fast)] group-hover:text-[var(--color-accent)]"
								/>
								{ex.label}
							</button>
						{/each}
					</div>
				</div>
			{/if}

			{#each entries as entry, i (entry)}
				<div class="enter group space-y-4">
					<!-- Operator question: wears the server's accent -->
					<div class="flex justify-end">
						<div
							class="max-w-[85%] rounded-2xl rounded-br-md bg-[var(--color-accent)] px-4 py-2.5 text-[13px] leading-relaxed break-words whitespace-pre-wrap text-[var(--color-accent-fg)] md:max-w-[75%]"
						>
							{entry.question}
						</div>
					</div>

					<!-- Assistant turn: full-width prose, no bubble — markdown tables
					     and code get the whole column, which matters on mobile -->
					<div class="min-w-0 space-y-3">
						{#if entry.loading}
							<div
								class="flex items-center gap-2.5 py-1"
								role="status"
								aria-label={m.assistant_thinking()}
							>
								<span class="think-meter text-[var(--color-accent)]" aria-hidden="true">
									<i></i><i></i><i></i><i></i>
								</span>
								<span class="font-mono text-[11px] text-[var(--color-fg-subtle)] tabular-nums">
									{m.assistant_thinking()}{elapsedSeconds(entry) >= 3
										? ` · ${elapsedSeconds(entry)}s`
										: ''}
								</span>
							</div>
						{:else if entry.error}
							<Banner variant="danger">{entry.error}</Banner>
						{:else}
							<div class="text-[13.5px] leading-relaxed">
								<Markdown text={entry.answer} />
							</div>

							<div class="flex items-center gap-1">
								<button
									type="button"
									onclick={() => copyAnswer(entry.answer)}
									class={cn(
										'inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-[var(--color-fg-faint)]',
										'transition-all duration-[var(--dur-fast)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-fg)]',
										'md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100'
									)}
								>
									<IconCopy class="size-3" />
									{m.assistant_copy()}
								</button>
							</div>

							{#if entry.trace && entry.trace.length > 0}
								<details
									class="rounded-lg bg-[var(--color-surface)] px-3 py-2 shadow-[var(--shadow-flat)]"
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
															· in={step.usage.input_tokens ?? 0} out={step.usage.output_tokens ??
																0} cache_read={step.usage.cache_read_input_tokens ?? 0}{/if}</span
													>
												{/if}
											</li>
										{/each}
									</ol>
								</details>
							{/if}
						{/if}

						{#each entry.proposals as p, pi (pi)}
							<div
								class={cn(
									'overflow-hidden rounded-xl bg-[var(--color-surface)] shadow-[var(--shadow-flat)] transition-opacity duration-[var(--dur-mid)]',
									p.state === 'dismissed' && 'opacity-60'
								)}
							>
								<div class="flex items-center gap-2 bg-[var(--color-warning-bg)] px-3.5 py-2">
									<IconZap class="size-3.5 shrink-0 text-[var(--color-warning)]" />
									<span
										class="min-w-0 flex-1 truncate text-[11px] font-medium tracking-wide text-[var(--color-warning)]"
									>
										{m.assistant_action()}
									</span>
									{#if p.state === 'done'}
										<span
											class="inline-flex shrink-0 items-center gap-1 text-[11px] font-medium text-[var(--color-success)]"
										>
											<IconCheck class="size-3" />
											{m.assistant_action_applied()}
										</span>
									{:else if p.state === 'dismissed'}
										<span
											class="inline-flex shrink-0 items-center gap-1 text-[11px] text-[var(--color-fg-subtle)]"
										>
											<IconX class="size-3" />
											{m.assistant_action_dismissed()}
										</span>
									{:else if p.state === 'applying'}
										<span class="shrink-0 text-[11px] text-[var(--color-fg-subtle)]">
											{m.assistant_action_applying()}
										</span>
									{/if}
								</div>
								<div class="px-3.5 py-3">
									<p class="text-[13px] font-medium text-[var(--color-fg)]">{p.summary}</p>
									<p class="mt-1.5">
										<span
											class="inline-block max-w-full truncate rounded-md bg-[var(--color-surface-2)] px-2 py-1 align-bottom font-mono text-[10.5px] text-[var(--color-fg-subtle)]"
										>
											{p.method}
											{p.path}
										</span>
									</p>

									{#if p.body != null}
										<details class="mt-1.5">
											<summary
												class="cursor-pointer text-[11px] text-[var(--color-fg-subtle)] select-none"
											>
												{m.assistant_action_payload()}
											</summary>
											<pre
												class="mt-1 max-h-40 overflow-auto rounded-lg bg-[var(--color-surface-2)] p-2 font-mono text-[10.5px] leading-relaxed break-all whitespace-pre-wrap text-[var(--color-fg-subtle)]">{JSON.stringify(
													p.body,
													null,
													2
												)}</pre>
										</details>
									{/if}

									{#if p.state === 'pending'}
										<div class="mt-3 flex gap-2">
											<Button size="sm" variant="primary" onclick={() => applyProposal(i, pi)}>
												<IconCheck class="size-3.5" />
												{m.assistant_confirm()}
											</Button>
											<Button size="sm" variant="ghost" onclick={() => dismissProposal(i, pi)}>
												{m.assistant_dismiss()}
											</Button>
										</div>
									{:else if p.state === 'failed'}
										<div class="mt-2">
											<Banner variant="danger">{p.error}</Banner>
										</div>
									{/if}
								</div>
							</div>
						{/each}
					</div>
				</div>
			{/each}
		</div>
	</div>

	<!-- Docked composer. The gradient lets messages fade out underneath it
	     instead of clipping on a hard edge. -->
	<div class="relative shrink-0 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] md:px-6">
		<div
			class="pointer-events-none absolute inset-x-0 -top-14 h-14 bg-gradient-to-t from-[var(--color-bg)] to-transparent"
			aria-hidden="true"
		></div>

		{#if !atBottom && entries.length > 0}
			<button
				type="button"
				onclick={() => scrollToEnd()}
				aria-label={m.assistant_jump_latest()}
				title={m.assistant_jump_latest()}
				class={cn(
					'enter absolute -top-12 left-1/2 z-10 flex size-8 -translate-x-1/2 items-center justify-center rounded-full',
					'bg-[var(--color-surface-3)] text-[var(--color-fg)]',
					'shadow-[inset_0_0_0_1px_var(--color-border-strong),0_0_0_4px_var(--color-bg),0_4px_12px_rgba(0,0,0,0.5)]',
					'transition-all duration-[var(--dur-fast)] hover:bg-[var(--color-accent)] hover:text-[var(--color-accent-fg)]'
				)}
			>
				<IconArrowDown class="size-4" />
			</button>
		{/if}

		<div class="mx-auto w-full max-w-3xl">
			{#if devMode}
				<div
					class="mb-2 rounded-xl bg-[var(--color-surface)] p-2.5"
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
					'flex items-end gap-1.5 rounded-2xl bg-[var(--color-surface)] p-1.5',
					'shadow-[0_1px_2px_rgba(0,0,0,0.2),0_0_0_1px_var(--color-border)] transition-shadow duration-[var(--dur-fast)]',
					'focus-within:shadow-[0_1px_2px_rgba(0,0,0,0.2),0_0_0_1px_var(--color-accent)]'
				)}
			>
				<!-- 16px on mobile so iOS doesn't zoom the page on focus -->
				<textarea
					bind:this={textarea}
					bind:value={question}
					oninput={resizeTextarea}
					onkeydown={onKeydown}
					disabled={!conn?.isAuthenticated}
					rows="1"
					enterkeyhint="send"
					placeholder={m.assistant_placeholder()}
					class={cn(
						'max-h-40 min-h-10 flex-1 resize-none overflow-y-hidden bg-transparent px-3 py-2 text-[16px] text-[var(--color-fg)] md:text-[13.5px]',
						'placeholder:overflow-hidden placeholder:text-ellipsis placeholder:whitespace-nowrap',
						'placeholder:text-[var(--color-fg-faint)] focus:outline-none disabled:opacity-50'
					)}
				></textarea>
				<!-- While a question runs the send button becomes a stop control:
				     same footprint, so nothing shifts — and the 150 s timeout is
				     never a lock-out. -->
				{#if busy}
					<Button
						size="icon"
						class="size-9 shrink-0 rounded-xl"
						onclick={() => aborter?.abort()}
						aria-label={m.assistant_stop()}
						title={m.assistant_stop()}
					>
						<IconSquare class="size-3 fill-current" />
					</Button>
				{:else}
					<Button
						size="icon"
						class="size-9 shrink-0 rounded-xl"
						onclick={() => ask(question)}
						disabled={!canSend}
						aria-label={m.assistant_send()}
					>
						<IconArrowUp class="size-4" />
					</Button>
				{/if}
			</div>
			<p class="mt-1.5 px-1 text-center text-[10.5px] text-[var(--color-fg-subtle)] md:text-[11px]">
				{m.assistant_readonly_note()}
			</p>
		</div>
	</div>
</div>

<style>
	/* Thinking state as a live meter — the product's heartbeat/telemetry
	   vernacular instead of generic chat dots. Bars rise from the baseline
	   like an equalizer; reduced-motion (global kill) leaves them static. */
	.think-meter {
		display: inline-flex;
		align-items: flex-end;
		gap: 3px;
		height: 14px;
	}
	.think-meter i {
		width: 3px;
		height: 100%;
		border-radius: 2px;
		background: currentColor;
		transform-origin: bottom;
		animation: think-bar 900ms ease-in-out infinite;
	}
	.think-meter i:nth-child(2) {
		animation-delay: 140ms;
	}
	.think-meter i:nth-child(3) {
		animation-delay: 280ms;
	}
	.think-meter i:nth-child(4) {
		animation-delay: 420ms;
	}
	@keyframes think-bar {
		0%,
		100% {
			transform: scaleY(0.3);
			opacity: 0.6;
		}
		50% {
			transform: scaleY(1);
			opacity: 1;
		}
	}
</style>
