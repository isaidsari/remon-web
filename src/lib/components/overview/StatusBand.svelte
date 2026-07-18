<script lang="ts">
	import type { Connection } from '$lib/stores/connections.svelte';
	import type { SummaryResponse } from '$lib/types/api';
	import Skeleton from '$lib/components/ui/Skeleton.svelte';
	import { fmtDuration } from '$lib/utils/format';
	import { cn } from '$lib/utils/cn';
	import { m } from '$lib/paraglide/messages';
	import type { Component } from 'svelte';
	import IconTriangleAlert from '~icons/lucide/triangle-alert';
	import IconActivity from '~icons/lucide/activity';
	import IconContainer from '~icons/lucide/container';
	import IconList from '~icons/lucide/list';
	import IconBotMessageSquare from '~icons/lucide/bot-message-square';

	interface Props {
		conn: Connection | null;
	}

	let { conn }: Props = $props();

	let summary = $state<SummaryResponse | null>(null);
	let failed = $state(false);

	async function fetchSummary() {
		if (!conn?.isAuthenticated) return;
		try {
			summary = await conn.client.summary();
			failed = false;
		} catch {
			// The band degrades to links-only; widgets carry their own errors.
			failed = true;
		}
	}

	$effect(() => {
		if (!conn?.isAuthenticated) return;
		void fetchSummary();
		const t = setInterval(fetchSummary, 30_000);
		return () => clearInterval(t);
	});

	type Tone = 'ok' | 'pending' | 'firing';
	let tone = $derived<Tone>(
		summary === null
			? 'ok'
			: summary.alerts_firing > 0
				? 'firing'
				: summary.alerts_pending > 0
					? 'pending'
					: 'ok'
	);

	const TONE_COLOR: Record<Tone, string> = {
		ok: 'var(--color-success)',
		pending: 'var(--color-warning)',
		firing: 'var(--color-danger)'
	};

	let verdict = $derived(
		summary === null
			? ''
			: tone === 'firing'
				? m.overview_health_firing({ count: summary.alerts_firing })
				: tone === 'pending'
					? m.overview_health_pending({ count: summary.alerts_pending })
					: m.overview_health_ok()
	);

	interface QuickLink {
		href: string;
		label: string;
		icon: Component;
		badge?: number;
		tone?: 'danger' | 'accent';
	}

	let base = $derived(`/servers/${conn?.serverId ?? ''}`);
	let quickLinks = $derived<QuickLink[]>([
		{
			href: `${base}/alerts`,
			label: m.section_alerts(),
			icon: IconTriangleAlert,
			badge: summary?.alerts_firing || undefined,
			tone: (summary?.alerts_firing ?? 0) > 0 ? 'danger' : undefined
		},
		{ href: `${base}/services`, label: m.section_services(), icon: IconActivity },
		{ href: `${base}/docker`, label: m.section_docker(), icon: IconContainer },
		{ href: `${base}/processes`, label: m.section_processes(), icon: IconList },
		{
			href: `${base}/assistant`,
			label: m.overview_quick_ask(),
			icon: IconBotMessageSquare,
			tone: 'accent'
		}
	]);
</script>

<!-- The page's thesis: "how is this box right now" answered in one line, with
     the places you'd go next one tap away. -->
<div
	class="flex flex-col gap-3 rounded-[var(--radius-card)] bg-[var(--color-surface)] px-4 py-3.5 shadow-[var(--shadow-flat)] md:flex-row md:items-center md:justify-between md:px-5"
>
	<div class="flex min-w-0 items-center gap-3">
		{#if summary === null && !failed}
			<Skeleton class="h-9 w-56" />
		{:else if summary !== null}
			<span
				class="live-pulse relative inline-flex size-2.5 shrink-0 rounded-full"
				style="background: {TONE_COLOR[tone]}; --pulse-color: {TONE_COLOR[tone]}"
				aria-hidden="true"
			></span>
			<div class="min-w-0">
				<p
					class="truncate text-[14.5px] font-semibold tracking-tight"
					style="color: {TONE_COLOR[tone]}"
				>
					{verdict}
				</p>
				<p class="mt-0.5 truncate font-mono text-[11px] text-[var(--color-fg-subtle)]">
					up {fmtDuration(summary.uptime_secs)} · {summary.os.toLowerCase()} · remon v{summary.version}
				</p>
			</div>
		{/if}
	</div>

	<nav class="flex flex-wrap items-center gap-1.5" aria-label={m.overview_quick_aria()}>
		{#each quickLinks as link (link.href)}
			{@const Icon = link.icon}
			<a
				href={link.href}
				class={cn(
					'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-medium transition-all duration-[var(--dur-fast)]',
					link.tone === 'danger'
						? 'bg-[var(--color-danger-bg)] text-[var(--color-danger)] shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--color-danger)_35%,transparent)]'
						: link.tone === 'accent'
							? 'bg-[var(--color-accent-bg)] text-[var(--color-accent)] shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--color-accent)_35%,transparent)] hover:bg-[color-mix(in_oklab,var(--color-accent)_22%,transparent)]'
							: 'bg-[var(--color-surface-2)] text-[var(--color-fg-muted)] shadow-[inset_0_0_0_1px_var(--color-border)] hover:text-[var(--color-fg)] hover:shadow-[inset_0_0_0_1px_var(--color-border-strong)]'
				)}
			>
				<Icon class="size-3.5 shrink-0" stroke-width="2" />
				{link.label}
				{#if link.badge}
					<span
						class="rounded-full bg-[var(--color-danger)] px-1.5 text-[10px] font-semibold text-white tabular-nums"
					>
						{link.badge}
					</span>
				{/if}
			</a>
		{/each}
	</nav>
</div>
