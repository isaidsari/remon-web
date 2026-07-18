<script lang="ts">
	import Card from '$lib/components/ui/Card.svelte';
	import Skeleton from '$lib/components/ui/Skeleton.svelte';
	import type { Connection } from '$lib/stores/connections.svelte';
	import type { AlertEventDto } from '$lib/types/api';
	import { fmtRelative } from '$lib/utils/format';
	import { cn } from '$lib/utils/cn';
	import { m } from '$lib/paraglide/messages';
	import IconHistory from '~icons/lucide/history';
	import IconArrowRight from '~icons/lucide/arrow-right';

	interface Props {
		conn: Connection | null;
	}

	let { conn }: Props = $props();

	let events = $state<AlertEventDto[] | null>(null);
	let ruleNames = $state<Map<number, string>>(new Map());

	// Events carry only rule_id; rule names come from the rules list. A rule
	// deleted since the event fired simply shows its id.
	async function fetchData() {
		if (!conn?.isAuthenticated) return;
		try {
			const [ev, rules] = await Promise.all([
				conn.client.alertEvents(30),
				conn.client.listAlertRules()
			]);
			ruleNames = new Map(rules.rules.map((r) => [r.id, r.name]));
			events = ev.events;
		} catch {
			// keep the stale feed on a transient failure
		}
	}

	$effect(() => {
		if (!conn?.isAuthenticated) return;
		void fetchData();
		const t = setInterval(fetchData, 30_000);
		return () => clearInterval(t);
	});

	// Re-render relative timestamps once a minute.
	let now = $state(Date.now());
	$effect(() => {
		const t = setInterval(() => (now = Date.now()), 60_000);
		return () => clearInterval(t);
	});

	function labelSuffix(labelSet: string): string {
		if (!labelSet || labelSet === '{}') return '';
		try {
			const parsed = JSON.parse(labelSet) as Record<string, string>;
			const vals = Object.values(parsed);
			return vals.length > 0 ? ` · ${vals.join(' ')}` : '';
		} catch {
			return '';
		}
	}
</script>

<Card class="flex h-full flex-col overflow-hidden" padding="none">
	<div class="flex items-center gap-2 px-4 pt-3.5 pb-2.5">
		<IconHistory class="size-[15px] shrink-0 text-[var(--color-fg-subtle)]" stroke-width="2" />
		<h2 class="flex-1 text-sm font-medium text-[var(--color-fg)]">{m.overview_events_title()}</h2>
		<a
			href={conn ? `/servers/${conn.serverId}/alerts` : '#'}
			class="group inline-flex items-center gap-1 text-[11px] text-[var(--color-fg-subtle)] transition-colors hover:text-[var(--color-fg)]"
		>
			{m.overview_events_all()}
			<IconArrowRight
				class="size-3 transition-transform duration-[var(--dur-fast)] group-hover:translate-x-0.5"
			/>
		</a>
	</div>

	{#if events === null}
		<div class="space-y-2 px-4 pb-4">
			<Skeleton class="h-4 w-full" />
			<Skeleton class="h-4 w-3/4" />
			<Skeleton class="h-4 w-5/6" />
		</div>
	{:else if events.length === 0}
		<div class="flex flex-1 flex-col items-center justify-center gap-1 px-4 pb-6 text-center">
			<span class="relative inline-flex size-2 rounded-full bg-[var(--color-success)]"></span>
			<p class="mt-2 text-[12.5px] text-[var(--color-fg-muted)]">{m.overview_events_empty()}</p>
		</div>
	{:else}
		<!-- Timeline: hairline rail on the left, one row per fire/resolve. -->
		<ol class="min-h-0 flex-1 overflow-y-auto px-4 pb-3">
			{#each events as ev (ev.id)}
				<li
					class="relative flex items-baseline gap-2.5 border-l border-[var(--color-border)] py-1.5 pl-4"
				>
					<span
						class={cn(
							'absolute top-1/2 -left-[3.5px] size-[7px] -translate-y-1/2 rounded-full',
							ev.event_type === 'resolved'
								? 'bg-[var(--color-success)]'
								: ev.severity === 'crit'
									? 'bg-[var(--color-danger)]'
									: 'bg-[var(--color-warning)]'
						)}
					></span>
					<span class="min-w-0 flex-1 truncate text-[12.5px] text-[var(--color-fg)]">
						{ruleNames.get(ev.rule_id) ?? `#${ev.rule_id}`}<span
							class="text-[var(--color-fg-subtle)]">{labelSuffix(ev.label_set)}</span
						>
						<span
							class={cn(
								'ml-1 text-[11px]',
								ev.event_type === 'resolved'
									? 'text-[var(--color-success)]'
									: ev.severity === 'crit'
										? 'text-[var(--color-danger)]'
										: 'text-[var(--color-warning)]'
							)}
						>
							{ev.event_type === 'resolved'
								? m.overview_event_resolved()
								: m.overview_event_fired()}
						</span>
					</span>
					<span class="shrink-0 font-mono text-[10.5px] text-[var(--color-fg-faint)] tabular-nums">
						{fmtRelative(ev.occurred_at, now)}
					</span>
				</li>
			{/each}
		</ol>
	{/if}
</Card>
