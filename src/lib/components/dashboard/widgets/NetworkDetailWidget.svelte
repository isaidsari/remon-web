<script lang="ts">
	import Card from '$lib/components/ui/Card.svelte';
	import Skeleton from '$lib/components/ui/Skeleton.svelte';
	import IfaceIcon from '$lib/components/overview/IfaceIcon.svelte';
	import type { Connection } from '$lib/stores/connections.svelte';
	import type { NetworkStats } from '$lib/types/api';
	import { classifyInterface } from '$lib/utils/netClassify';
	import { fmtBps, fmtBytes } from '$lib/utils/format';
	import { m } from '$lib/paraglide/messages';

	interface Props {
		conn: Connection | null;
		// Config-less widget; accepted for a uniform widget signature.
		config?: unknown;
	}

	let { conn }: Props = $props();

	let network = $derived(conn?.live?.network ?? []);

	// Physical NICs lead; container/virtual links collapse behind a disclosure
	// so a Docker host's dozens of veth pairs don't bury the real interfaces.
	let physicalNet = $derived(network.filter((n) => classifyInterface(n.interface) === 'physical'));
	let containerNet = $derived(
		network.filter((n) => classifyInterface(n.interface) === 'container')
	);
	let virtualNet = $derived(network.filter((n) => classifyInterface(n.interface) === 'virtual'));
</script>

{#snippet ifaceRow(n: NetworkStats)}
	<li class="flex items-center justify-between text-sm">
		<span class="flex min-w-0 items-center gap-2 text-[var(--color-fg-muted)]">
			<IfaceIcon name={n.interface} class="size-[12px] shrink-0 text-[var(--color-fg-subtle)]" />
			<span class="truncate font-mono text-xs">{n.interface}</span>
		</span>
		<span class="flex flex-col items-end gap-0.5 tabular-nums">
			<span class="flex items-center gap-3 text-xs">
				<span class="text-[var(--color-info)]" title={m.overview_iface_receive()}>
					↓ {fmtBps(n.rx_bytes_per_sec)}
				</span>
				<span class="text-[var(--color-success)]" title={m.overview_iface_transmit()}>
					↑ {fmtBps(n.tx_bytes_per_sec)}
				</span>
			</span>
			<span class="flex items-center gap-3 text-[10px] text-[var(--color-fg-subtle)]">
				<span title={m.overview_iface_total_rx()}>↓ {fmtBytes(n.rx_bytes_total)}</span>
				<span title={m.overview_iface_total_tx()}>↑ {fmtBytes(n.tx_bytes_total)}</span>
			</span>
		</span>
	</li>
{/snippet}

<Card class="flex h-full flex-col">
	<p class="mb-4 text-xs tracking-wide text-[var(--color-fg-muted)]">
		{m.overview_card_network_title()}
	</p>

	{#if network.length > 0}
		<ul class="flex flex-col gap-2.5">
			{#each physicalNet as n (n.interface)}
				{@render ifaceRow(n)}
			{/each}
		</ul>
		{#if containerNet.length > 0}
			<details class="mt-3 border-t border-[var(--color-border)] pt-3">
				<summary
					class="cursor-pointer font-mono text-[10px] tracking-[0.08em] text-[var(--color-fg-subtle)] select-none hover:text-[var(--color-fg-muted)]"
				>
					{m.overview_network_group_container({ count: containerNet.length })}
				</summary>
				<ul class="mt-2.5 flex flex-col gap-2.5">
					{#each containerNet as n (n.interface)}
						{@render ifaceRow(n)}
					{/each}
				</ul>
			</details>
		{/if}
		{#if virtualNet.length > 0}
			<details class="mt-2">
				<summary
					class="cursor-pointer font-mono text-[10px] tracking-[0.08em] text-[var(--color-fg-subtle)] select-none hover:text-[var(--color-fg-muted)]"
				>
					{m.overview_network_group_virtual({ count: virtualNet.length })}
				</summary>
				<ul class="mt-2.5 flex flex-col gap-2.5">
					{#each virtualNet as n (n.interface)}
						{@render ifaceRow(n)}
					{/each}
				</ul>
			</details>
		{/if}
	{:else}
		<ul class="flex flex-col gap-3">
			{#each Array(4) as _, i (i)}
				<li class="flex items-center justify-between">
					<Skeleton class="h-3 w-20" />
					<div class="flex items-center gap-3">
						<Skeleton class="h-3 w-14" />
						<Skeleton class="h-3 w-14" />
					</div>
				</li>
			{/each}
		</ul>
	{/if}
</Card>
