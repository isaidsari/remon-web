<script lang="ts">
	import { untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import Card from '$lib/components/ui/Card.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import StateBadge from '$lib/components/docker/StateBadge.svelte';
	import LogStream from '$lib/components/common/LogStream.svelte';
	import StatsPanel from '$lib/components/docker/StatsPanel.svelte';
	import Terminal from '$lib/components/docker/Terminal.svelte';
	import Banner from '$lib/components/ui/Banner.svelte';
	import { profiles } from '$lib/stores/profiles.svelte';
	import { connections } from '$lib/stores/connections.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { confirm } from '$lib/stores/confirm.svelte';
	import IconChevronLeft from '~icons/lucide/chevron-left';
	import { ApiError } from '$lib/api/error';
	import { shortId } from '$lib/utils/format';
	import type { ContainerInspectInfo } from '$lib/types/api';
	import { m } from '$lib/paraglide/messages';

	let id = $derived(page.params.id ?? '');
	let cid = $derived(page.params.cid ?? '');
	let profile = $derived(id ? profiles.byId(id) : undefined);
	let conn = $derived(profile ? connections.connect(profile) : null);

	$effect(() => {
		if (!conn) return;
		untrack(() => {
			conn.ensureSignedIn().catch((e) => {
				if (e instanceof ApiError)
					toast.error(m.docker_container_toast_signin_failed(), { description: e.userMessage });
			});
		});
	});

	let inspect = $state<ContainerInspectInfo | null>(null);
	let inspectError = $state<string | null>(null);
	let busy = $state(false);
	let acting = $state<string | null>(null);
	let retryTimers: ReturnType<typeof setTimeout>[] = [];

	async function fetchInspect() {
		if (!conn?.isAuthenticated || !cid) return;
		busy = true;
		try {
			const next = await conn.client.inspectContainer(cid);
			inspect = next;
			inspectError = null;
		} catch (e) {
			if (e instanceof ApiError) {
				inspectError = e.userMessage;
				if (e.code === 'NOT_FOUND') inspect = null;
			}
		} finally {
			busy = false;
		}
	}

	/**
	 * Re-fetch inspect a few times after an action — Docker's transitional
	 * state often takes a beat to settle (e.g., a "stopped" container needs
	 * a couple hundred ms after `start` before inspect reports "running").
	 * Cancel any pending retry chain on each new call so back-to-back
	 * actions don't pile up overlapping fetches.
	 */
	function refetchSoon() {
		retryTimers.forEach(clearTimeout);
		retryTimers = [];
		fetchInspect();
		retryTimers.push(setTimeout(fetchInspect, 250));
		retryTimers.push(setTimeout(fetchInspect, 800));
		retryTimers.push(setTimeout(fetchInspect, 2200));
	}

	$effect(() => {
		if (conn?.isAuthenticated && cid) fetchInspect();
		return () => {
			retryTimers.forEach(clearTimeout);
			retryTimers = [];
		};
	});

	$effect(() => {
		if (!conn?.isAuthenticated) return;
		const t = setInterval(fetchInspect, 5000);
		return () => clearInterval(t);
	});

	let displayName = $derived(inspect?.name ?? shortId(cid));
	let stateStr = $derived(inspect?.state?.status ?? 'unknown');

	async function withAction<T>(key: string, msg: string, fn: () => Promise<T>) {
		acting = key;
		try {
			await fn();
			toast.success(msg);
			refetchSoon();
		} catch (e) {
			if (e instanceof ApiError)
				toast.error(m.docker_container_toast_action_failed(), { description: e.userMessage });
		} finally {
			acting = null;
		}
	}

	const start = () =>
		withAction('start', m.docker_container_toast_started({ name: displayName }), () =>
			conn!.client.startContainer(cid)
		);
	const stop = () =>
		withAction('stop', m.docker_container_toast_stopped({ name: displayName }), () =>
			conn!.client.stopContainer(cid)
		);
	const restart = () =>
		withAction('restart', m.docker_container_toast_restarted({ name: displayName }), () =>
			conn!.client.restartContainer(cid)
		);
	const pause = () =>
		withAction('pause', m.docker_container_toast_paused({ name: displayName }), () =>
			conn!.client.pauseContainer(cid)
		);
	const unpause = () =>
		withAction('unpause', m.docker_container_toast_resumed({ name: displayName }), () =>
			conn!.client.unpauseContainer(cid)
		);

	async function remove() {
		const force = inspect?.state?.running || inspect?.state?.paused || inspect?.state?.restarting;
		const ok = await confirm({
			title: force
				? m.docker_container_confirm_force_delete_title()
				: m.docker_container_confirm_delete_title(),
			description: force
				? m.docker_container_confirm_force_delete_desc({ name: displayName })
				: m.docker_container_confirm_delete_desc({ name: displayName }),
			confirmLabel: force
				? m.docker_container_action_force_delete()
				: m.docker_container_action_delete(),
			variant: 'danger'
		});
		if (!ok) return;
		try {
			acting = 'delete';
			await conn!.client.deleteContainer(cid, !!force);
			toast.success(m.docker_container_toast_deleted({ name: displayName }));
			goto(`/servers/${id}/docker`);
		} catch (e) {
			if (e instanceof ApiError)
				toast.error(m.docker_container_toast_delete_failed(), { description: e.userMessage });
		} finally {
			acting = null;
		}
	}

	let running = $derived(inspect?.state?.running === true);
	let paused = $derived(inspect?.state?.paused === true);
	let stopped = $derived(!running && !paused);
</script>

{#if profile}
	<div class="px-4 py-6 md:px-8 md:py-8">
		<button
			type="button"
			onclick={() => goto(`/servers/${id}/docker`)}
			class="mb-5 inline-flex items-center gap-1.5 text-xs text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]"
		>
			<IconChevronLeft class="size-[14px]" stroke-width="2" />
			{m.docker_container_back_all_containers()}
		</button>

		<header class="mb-8 flex items-start justify-between gap-4">
			<div class="min-w-0 flex-1">
				<div class="flex items-center gap-3">
					<h1 class="truncate text-[24px] font-semibold tracking-tight">{displayName}</h1>
					<StateBadge state={stateStr} />
				</div>
				<p class="mt-1 flex items-center gap-3 font-mono text-xs text-[var(--color-fg-muted)]">
					<span>{shortId(cid)}</span>
					{#if inspect?.image}
						<span class="text-[var(--color-fg-subtle)]">·</span>
						<span class="truncate">{inspect.image}</span>
					{/if}
				</p>
			</div>

			<div class="flex shrink-0 flex-wrap items-center justify-end gap-2">
				{#if stopped}
					<Button size="sm" onclick={start} loading={acting === 'start'} disabled={!!acting}>
						{m.docker_container_action_start()}
					</Button>
				{/if}
				{#if running}
					<Button
						variant="secondary"
						size="sm"
						onclick={pause}
						loading={acting === 'pause'}
						disabled={!!acting}
					>
						{m.docker_container_action_pause()}
					</Button>
					<Button
						variant="secondary"
						size="sm"
						onclick={stop}
						loading={acting === 'stop'}
						disabled={!!acting}
					>
						{m.docker_container_action_stop()}
					</Button>
				{/if}
				{#if paused}
					<Button size="sm" onclick={unpause} loading={acting === 'unpause'} disabled={!!acting}>
						{m.docker_container_action_resume()}
					</Button>
				{/if}
				{#if running || paused}
					<Button
						variant="secondary"
						size="sm"
						onclick={restart}
						loading={acting === 'restart'}
						disabled={!!acting}
					>
						{m.docker_container_action_restart()}
					</Button>
				{/if}
				<Button
					variant="danger"
					size="sm"
					onclick={remove}
					loading={acting === 'delete'}
					disabled={!!acting}
				>
					{m.docker_container_action_delete()}
				</Button>
			</div>
		</header>

		{#if inspectError}
			<Banner
				variant={inspect ? 'warning' : 'danger'}
				title={inspect
					? m.docker_container_inspect_refresh_failed()
					: m.docker_container_inspect_failed()}
				class="mb-4"
			>
				{inspectError}
				{#snippet actions()}
					<Button variant="secondary" size="sm" onclick={fetchInspect} loading={busy}>
						{m.common_retry()}
					</Button>
				{/snippet}
			</Banner>
		{/if}

		{#if inspect}
			<div class="grid grid-cols-1 gap-4 lg:grid-cols-3">
				<Card>
					<p class="mb-4 text-xs tracking-wide text-[var(--color-fg-muted)]">
						{m.docker_container_section_state()}
					</p>
					<dl class="grid gap-2.5 text-sm">
						<div class="flex items-baseline justify-between gap-3">
							<dt class="text-[var(--color-fg-muted)]">{m.docker_container_field_status()}</dt>
							<dd class="text-[var(--color-fg)]">{inspect.state?.status ?? '—'}</dd>
						</div>
						{#if inspect.state?.started_at}
							<div class="flex items-baseline justify-between gap-3">
								<dt class="text-[var(--color-fg-muted)]">{m.docker_container_field_started()}</dt>
								<dd class="font-mono text-xs text-[var(--color-fg)]">
									{inspect.state.started_at}
								</dd>
							</div>
						{/if}
						{#if inspect.state?.finished_at && inspect.state.finished_at !== '0001-01-01T00:00:00Z'}
							<div class="flex items-baseline justify-between gap-3">
								<dt class="text-[var(--color-fg-muted)]">{m.docker_container_field_finished()}</dt>
								<dd class="font-mono text-xs text-[var(--color-fg)]">
									{inspect.state.finished_at}
								</dd>
							</div>
						{/if}
						{#if inspect.state?.exit_code !== null && inspect.state?.exit_code !== undefined}
							<div class="flex items-baseline justify-between gap-3">
								<dt class="text-[var(--color-fg-muted)]">{m.docker_container_field_exit_code()}</dt>
								<dd
									class="font-mono"
									class:text-[var(--color-success)]={inspect.state.exit_code === 0}
									class:text-[var(--color-danger)]={(inspect.state.exit_code ?? 0) !== 0}
								>
									{inspect.state.exit_code}
								</dd>
							</div>
						{/if}
						{#if inspect.state?.health}
							<div class="flex items-baseline justify-between gap-3">
								<dt class="text-[var(--color-fg-muted)]">{m.docker_container_field_health()}</dt>
								<dd class="text-[var(--color-fg)]">{inspect.state.health}</dd>
							</div>
						{/if}
						{#if inspect.restart_count !== null && inspect.restart_count !== undefined}
							<div class="flex items-baseline justify-between gap-3">
								<dt class="text-[var(--color-fg-muted)]">
									{m.docker_container_field_restart_count()}
								</dt>
								<dd class="font-mono">{inspect.restart_count}</dd>
							</div>
						{/if}
						{#if inspect.created}
							<div class="flex items-baseline justify-between gap-3">
								<dt class="text-[var(--color-fg-muted)]">{m.docker_container_field_created()}</dt>
								<dd class="text-xs text-[var(--color-fg)]">{inspect.created}</dd>
							</div>
						{/if}
					</dl>
				</Card>

				<Card>
					<p class="mb-4 text-xs tracking-wide text-[var(--color-fg-muted)]">
						{m.docker_container_section_ports()}
					</p>
					{#if inspect.ports.length === 0}
						<p class="text-sm text-[var(--color-fg-subtle)]">
							{m.docker_container_ports_empty()}
						</p>
					{:else}
						<ul class="flex flex-col gap-2 text-sm">
							{#each inspect.ports as p (p.container_port + p.protocol + (p.host_port ?? ''))}
								<li class="flex items-center justify-between gap-2 font-mono text-xs">
									<span class="text-[var(--color-fg-muted)]">
										{p.container_port}/{p.protocol}
									</span>
									{#if p.host_port}
										<span class="text-[var(--color-fg)]"
											>→ {m.docker_container_ports_host({ port: p.host_port })}</span
										>
									{:else}
										<span class="text-[var(--color-fg-subtle)]"
											>{m.docker_container_ports_unbound()}</span
										>
									{/if}
								</li>
							{/each}
						</ul>
					{/if}
				</Card>

				<Card>
					<p class="mb-4 text-xs tracking-wide text-[var(--color-fg-muted)]">
						{m.docker_container_section_networks()}
					</p>
					{#if inspect.networks.length === 0}
						<p class="text-sm text-[var(--color-fg-subtle)]">
							{m.docker_container_networks_empty()}
						</p>
					{:else}
						<ul class="flex flex-col gap-2 text-sm">
							{#each inspect.networks as n (n.name)}
								<li class="flex flex-col gap-0.5">
									<span class="text-[var(--color-fg)]">{n.name}</span>
									{#if n.network_id}
										<span class="font-mono text-[11px] text-[var(--color-fg-subtle)]"
											>{shortId(n.network_id)}</span
										>
									{/if}
								</li>
							{/each}
						</ul>
					{/if}
				</Card>
			</div>

			{#if conn?.isAuthenticated}
				<div class="mt-4">
					<StatsPanel {conn} containerId={cid} paused={!running} />
				</div>
			{/if}

			<Card class="mt-4">
				<div class="mb-3 flex items-center justify-between">
					<h2 class="text-sm font-medium text-[var(--color-fg)]">
						{m.docker_container_section_logs()}
					</h2>
					<span class="text-xs text-[var(--color-fg-subtle)]">
						{m.docker_container_logs_via_sse()} · /sse/docker/containers/{shortId(cid)}/logs/stream
					</span>
				</div>
				{#if conn?.isAuthenticated}
					<LogStream {conn} path={`/docker/containers/${cid}/logs/stream`} />
				{/if}
			</Card>

			<Card class="mt-4">
				<div class="mb-3 flex items-center justify-between">
					<h2 class="text-sm font-medium text-[var(--color-fg)]">
						{m.docker_container_section_console()}
					</h2>
					<span class="text-xs text-[var(--color-fg-subtle)]">
						{m.docker_container_console_via_ws()} · /ws/docker/containers/{shortId(cid)}/exec
					</span>
				</div>
				{#if conn?.isAuthenticated && running}
					<Terminal {conn} containerId={cid} />
				{:else if !running}
					<p class="text-sm text-[var(--color-fg-subtle)]">
						{m.docker_container_console_not_running()}
					</p>
				{/if}
			</Card>
		{:else if busy && !inspectError}
			<Card padding="lg">
				<p class="text-sm text-[var(--color-fg-muted)]">{m.docker_container_loading()}</p>
			</Card>
		{/if}
	</div>
{/if}
