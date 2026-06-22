<script lang="ts">
	import Card from '$lib/components/ui/Card.svelte';
	import Skeleton from '$lib/components/ui/Skeleton.svelte';
	import MountIcon from '$lib/components/overview/MountIcon.svelte';
	import type { Connection } from '$lib/stores/connections.svelte';
	import type { DiskStats } from '$lib/types/api';
	import { isContainerMount } from '$lib/utils/netClassify';
	import { fmtBps, fmtBytes, fmtPercent } from '$lib/utils/format';
	import { m } from '$lib/paraglide/messages';

	interface Props {
		conn: Connection | null;
		// Config-less widget; accepted for a uniform widget signature.
		config?: unknown;
	}

	let { conn }: Props = $props();

	let disks = $derived(conn?.live?.disks ?? []);
	// Real host mounts lead; container-runtime overlay mounts collapse so a
	// Docker host's per-layer overlays don't bury the actual filesystems.
	let mainDisks = $derived(disks.filter((d) => !isContainerMount(d.mount_point)));
	let dockerDisks = $derived(disks.filter((d) => isContainerMount(d.mount_point)));

	function diskPct(used: number, total: number): number {
		return total > 0 ? (used / total) * 100 : 0;
	}

	// Trim docker overlay SHA segments to 12 chars; full path stays in the title.
	function shortenMount(path: string): string {
		const segs = path.split('/').filter(Boolean);
		const last = segs[segs.length - 1] ?? '';
		if (/^[a-f0-9]{32,}$/.test(last)) {
			const head = segs.slice(0, -1).join('/');
			return `/${head}/${last.slice(0, 12)}…`;
		}
		return path;
	}
</script>

{#snippet diskRow(d: DiskStats)}
	{@const pct = diskPct(d.used_bytes, d.total_bytes)}
	<div>
		<div class="mb-1.5 flex flex-col gap-0.5 text-sm">
			<div class="flex items-baseline justify-between gap-2">
				<span class="flex min-w-0 items-center gap-2 text-[var(--color-fg)]" title={d.mount_point}>
					<MountIcon
						path={d.mount_point}
						class="size-[12px] shrink-0 text-[var(--color-fg-subtle)]"
					/>
					<span class="truncate font-mono">{shortenMount(d.mount_point)}</span>
				</span>
				<span class="shrink-0 text-xs tabular-nums text-[var(--color-fg-muted)]">
					R {fmtBps(d.read_bytes_per_sec, 0)} · W {fmtBps(d.write_bytes_per_sec, 0)}
				</span>
			</div>
			<div
				class="flex items-baseline justify-between pl-[20px] text-xs tabular-nums text-[var(--color-fg-muted)]"
			>
				<span class="font-medium text-[var(--color-fg)]">
					{fmtBytes(d.used_bytes)} / {fmtBytes(d.total_bytes)}
				</span>
				<span>{fmtPercent(pct, 0)}</span>
			</div>
		</div>
		<div class="h-1.5 overflow-hidden rounded-full bg-[var(--color-surface-3)]">
			<div
				class="h-full rounded-full transition-all"
				style="width: {Math.min(100, pct)}%; background: {pct > 90
					? 'var(--color-danger)'
					: pct > 75
						? 'var(--color-warning)'
						: 'var(--color-info)'};"
			></div>
		</div>
	</div>
{/snippet}

<Card class="flex h-full flex-col">
	<p class="mb-4 text-xs tracking-wide text-[var(--color-fg-muted)]">
		{m.overview_card_storage_title()}
	</p>

	{#if disks.length > 0}
		<div class="flex flex-col gap-4">
			{#each mainDisks as d (d.mount_point)}
				{@render diskRow(d)}
			{/each}
			{#if dockerDisks.length > 0}
				<details class="border-t border-[var(--color-border)] pt-3">
					<summary
						class="cursor-pointer font-mono text-[10px] tracking-[0.08em] text-[var(--color-fg-subtle)] select-none hover:text-[var(--color-fg-muted)]"
					>
						{m.overview_storage_container_layers({ count: dockerDisks.length })}
					</summary>
					<div class="mt-3 flex flex-col gap-4">
						{#each dockerDisks as d (d.mount_point)}
							{@render diskRow(d)}
						{/each}
					</div>
				</details>
			{/if}
		</div>
	{:else}
		<div class="flex flex-col gap-4">
			{#each Array(3) as _, i (i)}
				<div>
					<div class="mb-1.5 flex items-baseline justify-between gap-3">
						<Skeleton class="h-3 w-32" />
						<Skeleton class="h-3 w-20" />
					</div>
					<Skeleton class="h-1.5 w-full" rounded="full" />
				</div>
			{/each}
		</div>
	{/if}
</Card>
