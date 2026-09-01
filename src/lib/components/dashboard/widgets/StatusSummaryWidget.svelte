<script lang="ts">
	import HostInfoCard from '$lib/components/overview/HostInfoCard.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import Skeleton from '$lib/components/ui/Skeleton.svelte';
	import type { Connection } from '$lib/stores/connections.svelte';
	import type { AlertSeverity } from '$lib/types/api';
	import type { StatusSummaryConfig } from '$lib/types/dashboard';
	import { m } from '$lib/paraglide/messages';
	import IconActivity from '~icons/lucide/activity';
	import IconContainer from '~icons/lucide/container';
	import IconTriangleAlert from '~icons/lucide/triangle-alert';

	interface Props {
		conn: Connection | null;
		config: StatusSummaryConfig;
	}

	let { conn, config }: Props = $props();

	let counts = $state<{ active: number; total: number } | null>(null);
	let loading = $state(true);

	async function fetchData() {
		if (!conn?.isAuthenticated) return;
		try {
			if (config.summary === 'services') {
				const res = await conn.client.listServices();
				counts = {
					active: res.services.filter((s) => s.state === 'running').length,
					total: res.services.length
				};
			} else if (config.summary === 'containers') {
				const res = await conn.client.listContainers();
				counts = {
					active: res.containers.filter((c) => c.state === 'running').length,
					total: res.containers.length
				};
			} else if (config.summary === 'alerts') {
				const res = await conn.client.alertState();
				counts = {
					active: res.states.filter((s) => s.state === 'firing').length,
					total: res.states.length
				};
			}
		} catch {
			// keep stale counts on transient failure
		} finally {
			loading = false;
		}
	}

	/** `firing: null` until the first poll lands, so the bar keeps its height. */
	let health = $state<{ firing: number | null; severity: AlertSeverity | null }>({
		firing: null,
		severity: null
	});

	async function fetchHealth() {
		if (!conn?.isAuthenticated) return;
		try {
			const res = await conn.client.alertState();
			const firing = res.states.filter((s) => s.state === 'firing');
			health = {
				firing: firing.length,
				severity: firing.some((s) => s.severity === 'crit')
					? 'crit'
					: firing.length > 0
						? 'warn'
						: null
			};
		} catch {
			// keep the last known state on transient failure
		}
	}

	$effect(() => {
		void config.summary;
		if (!conn?.isAuthenticated) return;
		if (config.summary === 'host') {
			void conn.fetchSystemInfo();
			loading = false;
			void fetchHealth();
			const th = setInterval(fetchHealth, 30_000);
			return () => clearInterval(th);
		}
		loading = true;
		void fetchData();
		const t = setInterval(fetchData, 30_000);
		return () => clearInterval(t);
	});

	let meta = $derived(
		config.summary === 'services'
			? { label: m.section_services(), Icon: IconActivity, accent: 'var(--color-success)' }
			: config.summary === 'containers'
				? { label: m.section_docker(), Icon: IconContainer, accent: 'var(--color-info)' }
				: { label: m.section_alerts(), Icon: IconTriangleAlert, accent: 'var(--color-warning)' }
	);
</script>

{#if config.summary === 'host'}
	<HostInfoCard
		class="h-full"
		info={conn?.systemInfo?.data ?? null}
		fetchedAt={conn?.systemInfo?.fetchedAt ?? 0}
		{health}
	/>
{:else}
	{@const Icon = meta.Icon}
	<Card class="flex h-full flex-col">
		<div class="mb-2 flex items-center gap-2">
			<Icon class="size-[15px] shrink-0" style="color: {meta.accent}" stroke-width="2" />
			<h2 class="text-sm font-medium text-[var(--color-fg)]">{meta.label}</h2>
		</div>
		{#if loading && !counts}
			<Skeleton class="h-8 w-24" />
		{:else if counts}
			<div class="flex flex-1 items-baseline gap-2">
				<span
					class="font-mono text-[30px] leading-none font-semibold tabular-nums"
					style="color: {meta.accent}"
				>
					{counts.active}
				</span>
				<span class="font-mono text-[13px] text-[var(--color-fg-muted)]">
					/ {counts.total}
					<span class="ml-1 text-[var(--color-fg-subtle)]">
						{config.summary === 'alerts'
							? m.dashboard_summary_firing()
							: m.dashboard_summary_active()}
					</span>
				</span>
			</div>
		{/if}
	</Card>
{/if}
