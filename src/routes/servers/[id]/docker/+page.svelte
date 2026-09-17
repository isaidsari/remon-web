<script lang="ts">
	import { useServer } from '$lib/server-scope';
	import { tabParam } from '$lib/utils/tab';
	import { goto } from '$app/navigation';
	import { m } from '$lib/paraglide/messages';
	import Button from '$lib/components/ui/Button.svelte';
	import DataTable from '$lib/components/ui/DataTable.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import IconButton from '$lib/components/ui/IconButton.svelte';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Select from '$lib/components/ui/Select.svelte';
	import RefreshButton from '$lib/components/ui/RefreshButton.svelte';
	import Tabs from '$lib/components/layout/Tabs.svelte';
	import StateBadge from '$lib/components/docker/StateBadge.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { confirm } from '$lib/stores/confirm.svelte';
	import { ApiError } from '$lib/api/error';
	import { fmtBytes, fmtRelative, shortId } from '$lib/utils/format';
	import type { ContainerInfo, DockerStatusResponse, ImageInfo } from '$lib/types/api';
	import IconPlay from '~icons/lucide/play';
	import IconPause from '~icons/lucide/pause';
	import IconSquare from '~icons/lucide/square';
	import IconRefresh from '~icons/lucide/refresh-cw';
	import IconTrash from '~icons/lucide/trash-2';

	let { id, conn } = $derived(useServer());

	const tabs = tabParam(['containers', 'images'] as const, 'containers');
	let tab = $derived(tabs.current);

	let status = $state<DockerStatusResponse | null>(null);
	/** Built without the feature — distinct from a daemon answering `available: false`. */
	let dockerUnsupported = $state(false);

	/** "podman 5.2", or just the version when the daemon does not name itself. */
	let engineLabel = $derived([status?.backend, status?.version].filter(Boolean).join(' ') || null);
	let containers = $state<ContainerInfo[]>([]);
	let images = $state<ImageInfo[]>([]);
	let busy = $state(false);
	let lastFetched = $state<number | null>(null);
	let q = $state('');
	let autoRefresh = $state(true);
	let acting = $state<string | null>(null);

	/** `background` = the 5s auto-refresh: it neither spins the Refresh button
	 *  nor toasts, or a server that keeps failing raises a toast every 5s. */
	async function fetchAll(background = false) {
		if (!conn.isAuthenticated) return;
		if (!background) busy = true;
		try {
			const [s, c, i] = await Promise.all([
				conn.client.dockerStatus(),
				conn.client.listContainers().catch(() => ({ containers: [] })),
				conn.client.listImages().catch(() => ({ images: [] }))
			]);
			status = s;
			dockerUnsupported = false;
			containers = c.containers;
			images = i.images;
			lastFetched = Date.now();
		} catch (e) {
			// No routes at all, so the 404 has no error envelope. Same answer for
			// the operator as an absent daemon.
			if (e instanceof ApiError && e.status === 404) {
				dockerUnsupported = true;
				status = {
					available: false,
					version: null,
					backend: null,
					api_version: null,
					os: null,
					arch: null
				};
			} else if (!background && e instanceof ApiError) {
				toast.error(m.docker_toast_fetch_failed(), { description: e.userMessage });
			}
		} finally {
			if (!background) busy = false;
		}
	}

	$effect(() => {
		if (conn.isAuthenticated) fetchAll();
	});

	$effect(() => {
		// Nothing to poll for on a daemon that has no Docker routes — the answer
		// can only change by reinstalling the server.
		if (!autoRefresh || !conn.isAuthenticated || dockerUnsupported) return;
		const t = setInterval(() => void fetchAll(true), 5000);
		return () => clearInterval(t);
	});

	let filteredContainers = $derived.by(() => {
		const needle = q.trim().toLowerCase();
		const list = needle
			? containers.filter(
					(c) =>
						c.names.some((n) => n.toLowerCase().includes(needle)) ||
						c.image.toLowerCase().includes(needle) ||
						c.id.toLowerCase().includes(needle)
				)
			: containers;
		return [...list].sort((a, b) => {
			const aRun = a.state === 'running' ? 0 : 1;
			const bRun = b.state === 'running' ? 0 : 1;
			if (aRun !== bRun) return aRun - bRun;
			return b.created - a.created;
		});
	});

	let filteredImages = $derived.by(() => {
		const needle = q.trim().toLowerCase();
		const list = needle
			? images.filter(
					(i) =>
						i.tags.some((t) => t.toLowerCase().includes(needle)) ||
						i.id.toLowerCase().includes(needle)
				)
			: images;
		return [...list].sort((a, b) => b.created - a.created);
	});

	function name(c: ContainerInfo): string {
		return c.names[0]?.replace(/^\//, '') ?? shortId(c.id);
	}

	async function withAction<T>(key: string, successMsg: string, fn: () => Promise<T>) {
		acting = key;
		try {
			await fn();
			toast.success(successMsg);
			fetchAll();
		} catch (e) {
			if (e instanceof ApiError) {
				toast.error(m.docker_toast_action_failed(), { description: e.userMessage });
			}
		} finally {
			acting = null;
		}
	}

	const start = (c: ContainerInfo) =>
		withAction(`start:${c.id}`, m.docker_toast_started({ name: name(c) }), () =>
			conn.client.startContainer(c.id)
		);
	const stop = (c: ContainerInfo) =>
		withAction(`stop:${c.id}`, m.docker_toast_stopped({ name: name(c) }), () =>
			conn.client.stopContainer(c.id)
		);
	const restart = (c: ContainerInfo) =>
		withAction(`restart:${c.id}`, m.docker_toast_restarted({ name: name(c) }), () =>
			conn.client.restartContainer(c.id)
		);
	const pause = (c: ContainerInfo) =>
		withAction(`pause:${c.id}`, m.docker_toast_paused({ name: name(c) }), () =>
			conn.client.pauseContainer(c.id)
		);
	const unpause = (c: ContainerInfo) =>
		withAction(`unpause:${c.id}`, m.docker_toast_resumed({ name: name(c) }), () =>
			conn.client.unpauseContainer(c.id)
		);

	async function remove(c: ContainerInfo) {
		const force = c.state === 'running' || c.state === 'paused' || c.state === 'restarting';
		const ok = await confirm({
			title: force ? m.docker_confirm_force_delete_title() : m.docker_confirm_delete_title(),
			description: force
				? m.docker_confirm_force_delete_description({ name: name(c), state: c.state })
				: m.docker_confirm_delete_description({ name: name(c) }),
			confirmLabel: force ? m.docker_action_force_delete() : m.docker_action_delete(),
			variant: 'danger'
		});
		if (!ok) return;
		await withAction(`delete:${c.id}`, m.docker_toast_deleted({ name: name(c) }), () =>
			conn.client.deleteContainer(c.id, force)
		);
	}

	async function pruneContainers() {
		const ok = await confirm({
			title: m.docker_confirm_prune_containers_title(),
			description: m.docker_confirm_prune_containers_description(),
			confirmLabel: m.docker_action_prune(),
			variant: 'warning'
		});
		if (!ok) return;
		try {
			busy = true;
			const res = await conn.client.pruneContainers();
			toast.success(
				m.docker_toast_pruned_containers({
					count: res.containers_deleted.length,
					size: fmtBytes(res.space_reclaimed)
				})
			);
			fetchAll();
		} catch (e) {
			if (e instanceof ApiError)
				toast.error(m.docker_toast_prune_failed(), { description: e.userMessage });
		} finally {
			busy = false;
		}
	}

	async function deleteImage(img: ImageInfo) {
		const label = img.tags[0] ?? shortId(img.id);
		const ok = await confirm({
			title: m.docker_confirm_delete_image_title(),
			description: m.docker_confirm_delete_image_description({ label }),
			confirmLabel: m.docker_action_delete(),
			variant: 'danger'
		});
		if (!ok) return;
		try {
			acting = `image-delete:${img.id}`;
			await conn.client.deleteImage(img.id, false);
			toast.success(m.docker_toast_image_deleted({ label }));
			fetchAll();
		} catch (e) {
			if (e instanceof ApiError)
				toast.error(m.docker_toast_delete_failed(), { description: e.userMessage });
		} finally {
			acting = null;
		}
	}

	async function pruneImages() {
		const ok = await confirm({
			title: m.docker_confirm_prune_images_title(),
			description: m.docker_confirm_prune_images_description(),
			confirmLabel: m.docker_action_prune(),
			variant: 'warning'
		});
		if (!ok) return;
		try {
			busy = true;
			const res = await conn.client.pruneImages();
			toast.success(
				m.docker_toast_pruned_images({
					count: res.containers_deleted.length,
					size: fmtBytes(res.space_reclaimed)
				})
			);
			fetchAll();
		} catch (e) {
			if (e instanceof ApiError)
				toast.error(m.docker_toast_prune_failed(), { description: e.userMessage });
		} finally {
			busy = false;
		}
	}

	function openContainer(c: ContainerInfo) {
		goto(`/servers/${id}/docker/containers/${c.id}`);
	}

	const tabsConfig = $derived([
		{ key: 'containers' as const, label: m.docker_tab_containers(), count: containers.length },
		{ key: 'images' as const, label: m.docker_tab_images(), count: images.length }
	]);
</script>

{#snippet containerActions(c: ContainerInfo)}
	{@const running = c.state === 'running'}
	{@const paused = c.state === 'paused'}
	{@const busy = acting !== null}
	{#if !running && !paused}
		<IconButton
			label={m.docker_action_start()}
			onclick={() => start(c)}
			disabled={busy}
			loading={acting === `start:${c.id}`}
		>
			<IconPlay class="size-[14px]" stroke-width="2" />
		</IconButton>
	{/if}
	{#if running}
		<IconButton
			label={m.docker_action_pause()}
			onclick={() => pause(c)}
			disabled={busy}
			loading={acting === `pause:${c.id}`}
		>
			<IconPause class="size-[14px]" stroke-width="2" />
		</IconButton>
		<IconButton
			label={m.docker_action_stop()}
			onclick={() => stop(c)}
			disabled={busy}
			loading={acting === `stop:${c.id}`}
		>
			<IconSquare class="size-[14px]" stroke-width="2" />
		</IconButton>
	{/if}
	{#if paused}
		<IconButton
			label={m.docker_action_resume()}
			onclick={() => unpause(c)}
			disabled={busy}
			loading={acting === `unpause:${c.id}`}
		>
			<IconPlay class="size-[14px]" stroke-width="2" />
		</IconButton>
	{/if}
	{#if running || paused}
		<IconButton
			label={m.docker_action_restart()}
			onclick={() => restart(c)}
			disabled={busy}
			loading={acting === `restart:${c.id}`}
		>
			<IconRefresh class="size-[14px]" stroke-width="2" />
		</IconButton>
	{/if}
	<IconButton
		tone="danger"
		label={m.docker_action_delete()}
		onclick={() => remove(c)}
		disabled={busy}
		loading={acting === `delete:${c.id}`}
	>
		<IconTrash class="size-[14px]" stroke-width="2" />
	</IconButton>
{/snippet}

<div class="px-4 py-6 md:px-8 md:py-8">
	<PageHeader title={m.section_containers()}>
		{#snippet meta()}
			{#if status?.available}
				<!-- The daemon may be podman; say which one rather than assuming docker. -->
				{#if engineLabel}<span class="text-[var(--color-fg)]">{engineLabel}</span>{/if}
				{#if status.os}<span class="text-[var(--color-fg-subtle)]">
						· {status.os}/{status.arch}</span
					>{/if}
			{:else}
				<span class="text-[var(--color-warning)]">{m.docker_daemon_unavailable()}</span>
			{/if}
		{/snippet}
		{#if lastFetched}
			<span class="text-2xs mr-1 text-[var(--color-fg-subtle)] tabular-nums">
				{m.docker_updated_at({ time: new Date(lastFetched).toLocaleTimeString() })}
			</span>
		{/if}
		<Select
			value={autoRefresh ? '5s' : 'off'}
			onchange={(e) => (autoRefresh = e.currentTarget.value !== 'off')}
			class="w-28"
		>
			<option value="off">{m.chart_autorefresh_off()}</option>
			<option value="5s">5s</option>
		</Select>
		<!-- Wrapped, not passed by reference: the click event would land in
			     `background` and silence the very feedback the button is for. -->
		<RefreshButton onclick={() => fetchAll()} loading={busy} label={m.docker_action_refresh()} />
	</PageHeader>

	{#if status && !status.available}
		<EmptyState
			title={m.docker_unavailable_title()}
			description={dockerUnsupported
				? m.docker_unsupported_description()
				: m.docker_unavailable_description()}
		/>
	{:else}
		<div class="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
			<Tabs tabs={tabsConfig} value={tab} onSelect={tabs.set} />
			<div class="flex items-center gap-2">
				<Input
					placeholder={tab === 'containers'
						? m.docker_filter_containers_placeholder()
						: m.docker_filter_images_placeholder()}
					bind:value={q}
					class="w-full sm:w-64"
				/>
				{#if tab === 'containers'}
					<Button variant="ghost" size="sm" onclick={pruneContainers} class="shrink-0">
						{m.docker_action_prune_stopped()}
					</Button>
				{:else}
					<Button variant="ghost" size="sm" onclick={pruneImages} class="shrink-0">
						{m.docker_action_prune_dangling()}
					</Button>
				{/if}
			</div>
		</div>

		{#if tab === 'containers'}
			<DataTable
				loading={busy && containers.length === 0}
				empty={filteredContainers.length === 0 ? m.docker_empty_containers() : undefined}
			>
				{#snippet head()}
					<th>{m.docker_th_name()}</th>
					<th>{m.docker_th_image()}</th>
					<th>{m.docker_th_state()}</th>
					<th>{m.docker_th_status()}</th>
					<th class="text-right">{m.docker_th_actions()}</th>
				{/snippet}
				{#each filteredContainers as c (c.id)}
					<!-- The row is the click target; the link inside keeps the same
						     destination reachable by keyboard and middle-click. -->
					<tr class="cursor-pointer" onclick={() => openContainer(c)}>
						<td class="md:whitespace-nowrap">
							<a
								href={`/servers/${id}/docker/containers/${c.id}`}
								onclick={(e) => e.stopPropagation()}
								class="font-medium break-all text-[var(--color-fg)]"
							>
								{name(c)}
							</a>
							<span class="text-3xs ml-2 font-mono text-[var(--color-fg-subtle)]">
								{shortId(c.id)}
							</span>
						</td>
						<!-- md:max-w-0: registry refs run long, and in auto table layout the
							     cell's max-content would set the column width. -->
						<td
							data-label={m.docker_th_image()}
							class="font-mono text-xs break-all text-[var(--color-fg-muted)] md:w-full md:max-w-0 md:truncate"
							title={c.image}
						>
							{c.image}
						</td>
						<td data-label={m.docker_th_state()}><StateBadge state={c.state} /></td>
						<td
							data-label={m.docker_th_status()}
							class="text-xs text-[var(--color-fg-muted)] md:whitespace-nowrap"
						>
							<span>
								{c.status}
								<span class="text-3xs ml-1.5 text-[var(--color-fg-subtle)]">
									{m.docker_created_at({ time: fmtRelative(c.created) })}
								</span>
							</span>
						</td>
						<td class="actions">
							<div
								class="flex items-center gap-1.5 md:justify-end"
								onclickcapture={(e) => e.stopPropagation()}
								role="presentation"
							>
								{@render containerActions(c)}
							</div>
						</td>
					</tr>
				{/each}
			</DataTable>
		{:else}
			<DataTable
				loading={busy && images.length === 0}
				empty={filteredImages.length === 0 ? m.docker_empty_images() : undefined}
			>
				{#snippet head()}
					<th>{m.docker_th_tag()}</th>
					<th class="text-right">{m.docker_th_size()}</th>
					<th>{m.docker_th_created()}</th>
					<th class="text-right">{m.docker_th_actions()}</th>
				{/snippet}
				{#each filteredImages as img (img.id)}
					<tr>
						<!-- Only the tag truncates, so the id beside it never disappears. -->
						<td class="md:w-full md:max-w-0">
							<div class="flex items-baseline gap-2">
								{#if img.tags.length === 0}
									<span class="text-xs text-[var(--color-fg-subtle)] md:truncate">
										{m.docker_image_no_tag()}
									</span>
								{:else}
									<span
										class="font-mono text-xs break-all text-[var(--color-fg)] md:truncate"
										title={img.tags.join('\n')}
									>
										{img.tags[0]}
									</span>
								{/if}
								<span class="text-3xs shrink-0 font-mono text-[var(--color-fg-subtle)]">
									{shortId(img.id)}
								</span>
								{#if img.tags.length > 1}
									<span
										class="text-3xs shrink-0 font-mono text-[var(--color-fg-subtle)]"
										title={img.tags.slice(1).join('\n')}
									>
										+{img.tags.length - 1}
									</span>
								{/if}
							</div>
						</td>
						<td data-label={m.docker_th_size()} class="font-mono text-xs md:text-right">
							{fmtBytes(img.size)}
						</td>
						<td data-label={m.docker_th_created()} class="text-xs text-[var(--color-fg-muted)]">
							{fmtRelative(img.created)}
						</td>
						<td class="actions">
							<div class="flex items-center gap-1.5 md:justify-end">
								<IconButton
									tone="danger"
									label={m.docker_action_delete()}
									onclick={() => deleteImage(img)}
									disabled={acting !== null}
									loading={acting === `image-delete:${img.id}`}
								>
									<IconTrash class="size-[14px]" stroke-width="2" />
								</IconButton>
							</div>
						</td>
					</tr>
				{/each}
			</DataTable>
		{/if}
	{/if}
</div>
