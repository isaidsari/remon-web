<script lang="ts">
	import { untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { m } from '$lib/paraglide/messages';
	import Card from '$lib/components/ui/Card.svelte';
	import Skeleton from '$lib/components/ui/Skeleton.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Tabs from '$lib/components/layout/Tabs.svelte';
	import StateBadge from '$lib/components/docker/StateBadge.svelte';
	import { profiles } from '$lib/stores/profiles.svelte';
	import { connections } from '$lib/stores/connections.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { confirm } from '$lib/stores/confirm.svelte';
	import { ApiError } from '$lib/api/error';
	import { fmtBytes, fmtRelative, shortId } from '$lib/utils/format';
	import { cn } from '$lib/utils/cn';
	import type { Component } from 'svelte';
	import type {
		ContainerInfo,
		DockerStatusResponse,
		ImageInfo
	} from '$lib/types/api';
	import IconPlay from '~icons/lucide/play';
	import IconPause from '~icons/lucide/pause';
	import IconSquare from '~icons/lucide/square';
	import IconRefresh from '~icons/lucide/refresh-cw';
	import IconTrash from '~icons/lucide/trash-2';

	let id = $derived(page.params.id ?? '');
	let profile = $derived(id ? profiles.byId(id) : undefined);
	let conn = $derived(profile ? connections.connect(profile) : null);

	$effect(() => {
		if (!conn) return;
		untrack(() => {
			conn.ensureSignedIn().catch((e) => {
				if (e instanceof ApiError) toast.error(m.docker_toast_signin_failed(), { description: e.userMessage });
			});
		});
	});

	type TabKey = 'containers' | 'images';
	let tab = $derived<TabKey>(
		(page.url.searchParams.get('tab') as TabKey | null) === 'images' ? 'images' : 'containers'
	);

	let status = $state<DockerStatusResponse | null>(null);
	let containers = $state<ContainerInfo[]>([]);
	let images = $state<ImageInfo[]>([]);
	let busy = $state(false);
	let lastFetched = $state<number | null>(null);
	let q = $state('');
	let autoRefresh = $state(true);
	let acting = $state<string | null>(null);

	async function fetchAll() {
		if (!conn?.isAuthenticated) return;
		busy = true;
		try {
			const [s, c, i] = await Promise.all([
				conn.client.dockerStatus(),
				conn.client.listContainers().catch(() => ({ containers: [] })),
				conn.client.listImages().catch(() => ({ images: [] }))
			]);
			status = s;
			containers = c.containers;
			images = i.images;
			lastFetched = Date.now();
		} catch (e) {
			if (e instanceof ApiError) {
				toast.error(m.docker_toast_fetch_failed(), { description: e.userMessage });
			}
		} finally {
			busy = false;
		}
	}

	$effect(() => {
		if (conn?.isAuthenticated) fetchAll();
	});

	$effect(() => {
		if (!autoRefresh || !conn?.isAuthenticated) return;
		const t = setInterval(fetchAll, 5000);
		return () => clearInterval(t);
	});

	function setTab(t: TabKey) {
		const url = new URL(page.url);
		url.searchParams.set('tab', t);
		goto(url, { replaceState: true, keepFocus: true });
	}

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

	async function withAction<T>(
		key: string,
		successMsg: string,
		fn: () => Promise<T>
	) {
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
		withAction(`start:${c.id}`, m.docker_toast_started({ name: name(c) }), () => conn!.client.startContainer(c.id));
	const stop = (c: ContainerInfo) =>
		withAction(`stop:${c.id}`, m.docker_toast_stopped({ name: name(c) }), () => conn!.client.stopContainer(c.id));
	const restart = (c: ContainerInfo) =>
		withAction(`restart:${c.id}`, m.docker_toast_restarted({ name: name(c) }), () =>
			conn!.client.restartContainer(c.id)
		);
	const pause = (c: ContainerInfo) =>
		withAction(`pause:${c.id}`, m.docker_toast_paused({ name: name(c) }), () => conn!.client.pauseContainer(c.id));
	const unpause = (c: ContainerInfo) =>
		withAction(`unpause:${c.id}`, m.docker_toast_resumed({ name: name(c) }), () =>
			conn!.client.unpauseContainer(c.id)
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
			conn!.client.deleteContainer(c.id, force)
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
			const res = await conn!.client.pruneContainers();
			toast.success(
				m.docker_toast_pruned_containers({ count: res.containers_deleted.length, size: fmtBytes(res.space_reclaimed) })
			);
			fetchAll();
		} catch (e) {
			if (e instanceof ApiError) toast.error(m.docker_toast_prune_failed(), { description: e.userMessage });
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
			await conn!.client.deleteImage(img.id, false);
			toast.success(m.docker_toast_image_deleted({ label }));
			fetchAll();
		} catch (e) {
			if (e instanceof ApiError) toast.error(m.docker_toast_delete_failed(), { description: e.userMessage });
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
			const res = await conn!.client.pruneImages();
			toast.success(
				m.docker_toast_pruned_images({ count: res.containers_deleted.length, size: fmtBytes(res.space_reclaimed) })
			);
			fetchAll();
		} catch (e) {
			if (e instanceof ApiError) toast.error(m.docker_toast_prune_failed(), { description: e.userMessage });
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

{#snippet iconBtn(label: string, onclick: () => void, disabled: boolean, busy: boolean, Icon: Component, color?: string)}
	<button
		type="button"
		{onclick}
		{disabled}
		title={label}
		aria-label={label}
		class={cn(
			'grid h-8 w-8 place-items-center rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] transition disabled:cursor-not-allowed disabled:opacity-30',
			'hover:border-[var(--color-border-strong)]',
			color === 'danger' && 'hover:border-[var(--color-danger)]/50 hover:text-[var(--color-danger)]',
			color !== 'danger' && 'hover:text-[var(--color-fg)]',
			'text-[var(--color-fg-muted)]'
		)}
	>
		{#if busy}
			<span
				class="h-3 w-3 animate-spin rounded-full border-2 border-current border-r-transparent"
				aria-hidden="true"
			></span>
		{:else}
			<Icon class="size-[14px]" stroke-width="2" />
		{/if}
	</button>
{/snippet}

{#if profile}
	<div class="px-4 py-6 md:px-8 md:py-8">
		<header class="mb-6 flex items-end justify-between gap-4">
			<div>
				<h1 class="text-[24px] font-semibold tracking-tight">Docker</h1>
				<p class="mt-1.5 text-[12px] text-[var(--color-fg-muted)]">
					{#if status?.available}
						{#if status.version}<span class="text-[var(--color-fg)]">{status.version}</span>{/if}
						{#if status.os}<span class="text-[var(--color-fg-subtle)]"> · {status.os}/{status.arch}</span>{/if}
					{:else}
						<span class="text-[var(--color-warning)]">{m.docker_daemon_unavailable()}</span>
					{/if}
					{#if lastFetched}<span class="text-[var(--color-fg-subtle)]"> · {m.docker_updated_at({ time: new Date(lastFetched).toLocaleTimeString() })}</span>{/if}
				</p>
			</div>
			<div class="flex items-center gap-2">
				<label class="flex items-center gap-2 text-xs text-[var(--color-fg-muted)]">
					<input type="checkbox" bind:checked={autoRefresh} class="accent-[var(--color-accent)]" />
					{m.docker_auto_refresh()}
				</label>
				<Button variant="secondary" size="sm" onclick={fetchAll} loading={busy}>{m.docker_action_refresh()}</Button>
			</div>
		</header>

		{#if !conn?.isAuthenticated}
			<Card padding="lg" class="border-[var(--color-warning)]/30">
				<p class="text-sm text-[var(--color-fg-muted)]">
					{m.docker_signin_required()}
				</p>
			</Card>
		{:else if status && !status.available}
			<Card padding="lg">
				<p class="font-medium">{m.docker_unavailable_title()}</p>
				<p class="mt-1 text-sm text-[var(--color-fg-muted)]">
					{m.docker_unavailable_description()}
				</p>
			</Card>
		{:else}
			<div class="mb-4 flex items-center justify-between gap-4">
				<Tabs tabs={tabsConfig} value={tab} onSelect={setTab} />
				<div class="flex items-center gap-2">
					<Input
						placeholder={tab === 'containers'
							? m.docker_filter_containers_placeholder()
							: m.docker_filter_images_placeholder()}
						bind:value={q}
						class="w-72 text-sm"
					/>
					{#if tab === 'containers'}
						<Button variant="ghost" size="sm" onclick={pruneContainers}>{m.docker_action_prune_stopped()}</Button>
					{:else}
						<Button variant="ghost" size="sm" onclick={pruneImages}>{m.docker_action_prune_dangling()}</Button>
					{/if}
				</div>
			</div>

			{#if tab === 'containers'}
				<Card padding="none" class="overflow-hidden">
					<div class="max-h-[calc(100vh-22rem)] overflow-auto">
						<table class="w-full text-sm">
							<thead
								class="sticky top-0 z-10 bg-[var(--color-surface-2)] text-xs tracking-wide text-[var(--color-fg-muted)]"
							>
								<tr>
									<th class="px-3 py-2.5 text-left font-medium">{m.docker_th_name()}</th>
									<th class="px-3 py-2.5 text-left font-medium">{m.docker_th_image()}</th>
									<th class="px-3 py-2.5 text-left font-medium">{m.docker_th_state()}</th>
									<th class="px-3 py-2.5 text-left font-medium">{m.docker_th_status()}</th>
									<th class="px-3 py-2.5 text-right font-medium">{m.docker_th_actions()}</th>
								</tr>
							</thead>
							<tbody>
								{#if busy && containers.length === 0}
									{#each { length: 6 } as _, i (i)}
										<tr class="border-t border-[var(--color-border)]">
											<td class="px-3 py-2.5"><Skeleton class="h-3 w-32" /></td>
											<td class="px-3 py-2.5"><Skeleton class="h-3 w-44" /></td>
											<td class="px-3 py-2.5"><Skeleton class="h-5 w-16" rounded="full" /></td>
											<td class="px-3 py-2.5"><Skeleton class="h-3 w-24" /></td>
											<td class="px-3 py-2.5"><Skeleton class="ml-auto h-6 w-16" /></td>
										</tr>
									{/each}
								{:else}
								{#each filteredContainers as c (c.id)}
									{@const running = c.state === 'running'}
									{@const paused = c.state === 'paused'}
									{@const stopped = !running && !paused}
									<tr
										class="cursor-pointer border-t border-[var(--color-border)] transition hover:bg-[var(--color-surface-2)]/40"
										onclick={() => openContainer(c)}
									>
										<td class="px-3 py-2.5">
											<div class="flex flex-col">
												<span class="font-medium text-[var(--color-fg)]">{name(c)}</span>
												<span class="font-mono text-[10px] text-[var(--color-fg-subtle)]"
													>{shortId(c.id)}</span
												>
											</div>
										</td>
										<td class="px-3 py-2.5 font-mono text-xs text-[var(--color-fg-muted)]"
											>{c.image}</td
										>
										<td class="px-3 py-2.5"><StateBadge state={c.state} /></td>
										<td class="px-3 py-2.5 text-xs text-[var(--color-fg-muted)]">
											<span title={c.status}>{c.status}</span>
											<span class="block text-[10px] text-[var(--color-fg-subtle)]"
												>{m.docker_created_at({ time: fmtRelative(c.created) })}</span
											>
										</td>
										<td class="px-3 py-2.5">
											<div
												class="flex items-center justify-end gap-1.5"
												onclickcapture={(e) => e.stopPropagation()}
												role="presentation"
											>
												{#if stopped}
													{@render iconBtn(
														m.docker_action_start(),
														() => start(c),
														acting !== null,
														acting === `start:${c.id}`,
														IconPlay
													)}
												{/if}
												{#if running}
													{@render iconBtn(
														m.docker_action_pause(),
														() => pause(c),
														acting !== null,
														acting === `pause:${c.id}`,
														IconPause
													)}
													{@render iconBtn(
														m.docker_action_stop(),
														() => stop(c),
														acting !== null,
														acting === `stop:${c.id}`,
														IconSquare
													)}
												{/if}
												{#if paused}
													{@render iconBtn(
														m.docker_action_resume(),
														() => unpause(c),
														acting !== null,
														acting === `unpause:${c.id}`,
														IconPlay
													)}
												{/if}
												{#if running || paused}
													{@render iconBtn(
														m.docker_action_restart(),
														() => restart(c),
														acting !== null,
														acting === `restart:${c.id}`,
														IconRefresh
													)}
												{/if}
												{@render iconBtn(
													m.docker_action_delete(),
													() => remove(c),
													acting !== null,
													acting === `delete:${c.id}`,
													IconTrash,
													'danger'
												)}
											</div>
										</td>
									</tr>
								{/each}
								{#if filteredContainers.length === 0}
									<tr>
										<td colspan="5" class="px-3 py-8 text-center text-sm text-[var(--color-fg-subtle)]"
											>{m.docker_empty_containers()}</td
										>
									</tr>
								{/if}
								{/if}
							</tbody>
						</table>
					</div>
				</Card>
			{:else}
				<Card padding="none" class="overflow-hidden">
					<div class="max-h-[calc(100vh-22rem)] overflow-auto">
						<table class="w-full text-sm">
							<thead
								class="sticky top-0 z-10 bg-[var(--color-surface-2)] text-xs tracking-wide text-[var(--color-fg-muted)]"
							>
								<tr>
									<th class="px-3 py-2.5 text-left font-medium">{m.docker_th_tag()}</th>
									<th class="px-3 py-2.5 text-left font-medium">{m.docker_th_id()}</th>
									<th class="px-3 py-2.5 text-right font-medium">{m.docker_th_size()}</th>
									<th class="px-3 py-2.5 text-left font-medium">{m.docker_th_created()}</th>
									<th class="px-3 py-2.5 text-right font-medium">{m.docker_th_actions()}</th>
								</tr>
							</thead>
							<tbody>
								{#if busy && images.length === 0}
									{#each { length: 5 } as _, i (i)}
										<tr class="border-t border-[var(--color-border)]">
											<td class="px-3 py-2.5"><Skeleton class="h-3 w-40" /></td>
											<td class="px-3 py-2.5"><Skeleton class="h-3 w-20" /></td>
											<td class="px-3 py-2.5"><Skeleton class="ml-auto h-3 w-16" /></td>
											<td class="px-3 py-2.5"><Skeleton class="h-3 w-24" /></td>
											<td class="px-3 py-2.5"><Skeleton class="ml-auto h-6 w-8" /></td>
										</tr>
									{/each}
								{:else}
								{#each filteredImages as img (img.id)}
									<tr class="border-t border-[var(--color-border)] transition hover:bg-[var(--color-surface-2)]/40">
										<td class="px-3 py-2.5">
											{#if img.tags.length === 0}
												<span class="text-[var(--color-fg-subtle)]">{m.docker_image_no_tag()}</span>
											{:else}
												<div class="flex flex-col gap-0.5">
													{#each img.tags as t (t)}
														<span class="font-mono text-xs text-[var(--color-fg)]">{t}</span>
													{/each}
												</div>
											{/if}
										</td>
										<td class="px-3 py-2.5 font-mono text-xs text-[var(--color-fg-muted)]">
											{shortId(img.id)}
										</td>
										<td class="px-3 py-2.5 text-right font-mono text-xs">
											{fmtBytes(img.size)}
										</td>
										<td class="px-3 py-2.5 text-xs text-[var(--color-fg-muted)]">
											{fmtRelative(img.created)}
										</td>
										<td class="px-3 py-2.5">
											<div class="flex items-center justify-end gap-1.5">
												{@render iconBtn(
													m.docker_action_delete(),
													() => deleteImage(img),
													acting !== null,
													acting === `image-delete:${img.id}`,
													IconTrash,
													'danger'
												)}
											</div>
										</td>
									</tr>
								{/each}
								{#if filteredImages.length === 0}
									<tr>
										<td colspan="5" class="px-3 py-8 text-center text-sm text-[var(--color-fg-subtle)]"
											>{m.docker_empty_images()}</td
										>
									</tr>
								{/if}
								{/if}
							</tbody>
						</table>
					</div>
				</Card>
			{/if}
		{/if}
	</div>
{/if}
