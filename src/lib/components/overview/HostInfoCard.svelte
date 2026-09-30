<script lang="ts">
	import type { Snippet } from 'svelte';
	import { fmtBytes, fmtDuration } from '$lib/utils/format';
	import { currentLocale } from '$lib/utils/lang';
	import { m } from '$lib/paraglide/messages';
	import { cn } from '$lib/utils/cn';
	import { toast } from '$lib/stores/toast.svelte';
	import type { SystemInfoResponse } from '$lib/types/api';
	import Skeleton from '$lib/components/ui/Skeleton.svelte';
	import OsIcon from './OsIcon.svelte';
	import CpuIcon from './CpuIcon.svelte';
	import IconServer from '~icons/lucide/server';
	import IconMemoryStick from '~icons/lucide/memory-stick';

	interface Props {
		info: SystemInfoResponse | null;
		/** Epoch ms when `info` was fetched. Used to advance uptime locally without re-hitting the server. */
		fetchedAt?: number;
		/** Card chrome comes from the caller: embedded in StatusBand it wants a top
		 *  border, standing alone as a widget it wants the rounded ring. */
		class?: string;
	}

	let { info, fetchedAt = 0, class: klass = '' }: Props = $props();

	let now = $state(Date.now());
	$effect(() => {
		const t = setInterval(() => (now = Date.now()), 1000);
		return () => clearInterval(t);
	});

	let liveUptime = $derived(
		info && fetchedAt > 0 ? info.description.uptime_secs + Math.floor((now - fetchedAt) / 1000) : 0
	);

	let osLabel = $derived.by(() => {
		if (!info) return '';
		const { os, os_version } = info.description;
		if (!os_version || os_version === 'unknown') return os.toLowerCase();
		const candidate = os_version.toLowerCase().includes(os.toLowerCase())
			? os_version
			: `${os} ${os_version}`;
		return candidate.toLowerCase();
	});
	let startedAt = $derived(
		info && fetchedAt > 0
			? new Date(fetchedAt - info.description.uptime_secs * 1000).toLocaleString(currentLocale(), {
					dateStyle: 'medium',
					timeStyle: 'short'
				})
			: null
	);

	// One entry per physical device: a device mounted twice would count twice.
	let diskLine = $derived.by(() => {
		if (!info) return '';
		const sizes = new Map<string, number>();
		for (const d of info.hardware.disks) {
			if (d.is_removable || d.total_bytes <= 0) continue;
			sizes.set(d.device_name, Math.max(sizes.get(d.device_name) ?? 0, d.total_bytes));
		}
		if (sizes.size === 0) return '';
		const size = fmtBytes([...sizes.values()].reduce((a, b) => a + b, 0));
		return sizes.size === 1
			? m.overview_host_disk({ size })
			: m.overview_host_disks({ size, count: sizes.size });
	});

	async function copyHostname() {
		if (!info) return;
		try {
			await navigator.clipboard.writeText(info.description.hostname);
			toast.success(m.overview_host_copied());
		} catch {
			// clipboard denied; the name is still selectable
		}
	}
</script>

<div class={cn('@container overflow-hidden', klass)}>
	<!-- Columns track the card's own width, not the viewport: the same card is a
	     half-width dashboard widget in one place and a full-width strip in another. -->
	<div class="hairline-grid h-full grid-cols-1 @sm:grid-cols-2 @5xl:grid-cols-4">
		{@render cell(m.overview_host_hostname(), hostnameMark, hostnameValue, hostnameSub)}
		{@render cell(m.overview_host_os(), osMark, osValue, osSub)}
		{@render cell(m.overview_metric_cpu_label(), cpuMark, cpuValue, cpuSub)}
		{@render cell(m.overview_metric_memory_label(), memoryMark, memoryValue, memorySub)}
	</div>
</div>

{#snippet cell(label: string, mark: Snippet, value: Snippet, sub: Snippet)}
	<div
		class="relative flex flex-col justify-center gap-1.5 overflow-hidden bg-[var(--color-surface)] px-4 py-3.5"
	>
		{@render mark()}
		<span
			class="text-2xs relative font-mono font-medium tracking-[0.08em] text-[var(--color-fg-muted)]"
		>
			{label}
		</span>
		{#if info}
			{@render value()}
			<span class="text-2xs relative truncate font-mono text-[var(--color-fg-subtle)]">
				{@render sub()}
			</span>
		{:else}
			<Skeleton class="h-[18px] w-32" />
			<Skeleton class="h-3 w-20" />
		{/if}
	</div>
{/snippet}

{#snippet hostnameMark()}
	<IconServer
		class="pointer-events-none absolute top-1/2 right-2 size-16 -translate-y-1/2 opacity-[0.15]"
		stroke-width="1"
	/>
{/snippet}
{#snippet hostnameValue()}
	<button
		type="button"
		onclick={copyHostname}
		title={m.overview_host_copy()}
		aria-label={m.overview_host_copy()}
		class="text-md relative -mx-1 max-w-[calc(100%+0.5rem)] self-start truncate rounded px-1 text-left font-mono font-medium text-[var(--color-fg)] transition-colors hover:text-[var(--color-accent)]"
	>
		{info?.description.hostname}
	</button>
{/snippet}
{#snippet hostnameSub()}
	<span title={startedAt ? m.overview_uptime_since({ date: startedAt }) : undefined}>
		{m.overview_host_uptime({ duration: fmtDuration(liveUptime) })}
	</span>
{/snippet}

{#snippet osMark()}
	{#if info}
		<OsIcon
			os={info.description.os}
			version={info.description.os_version}
			class="pointer-events-none absolute top-1/2 right-2 size-16 -translate-y-1/2 opacity-[0.28]"
		/>
	{/if}
{/snippet}
{#snippet osValue()}
	<span
		class="text-md relative truncate font-mono font-medium text-[var(--color-fg)]"
		title={osLabel}
	>
		{osLabel}
	</span>
{/snippet}
{#snippet osSub()}
	{m.overview_host_kernel({ version: info?.description.kernel ?? '' })}
{/snippet}

{#snippet cpuMark()}
	{#if info}
		<CpuIcon
			model={info.hardware.cpu_model}
			class="pointer-events-none absolute top-1/2 right-2 size-16 -translate-y-1/2 opacity-[0.28]"
		/>
	{/if}
{/snippet}
{#snippet cpuValue()}
	<span
		class="text-md relative truncate font-mono font-medium text-[var(--color-fg)]"
		title={info?.hardware.cpu_model ?? ''}
	>
		{info?.hardware.cpu_model}
	</span>
{/snippet}
{#snippet cpuSub()}
	{info?.hardware.cpu_cores}c · {info?.hardware.cpu_threads}t
{/snippet}

{#snippet memoryMark()}
	<IconMemoryStick
		class="pointer-events-none absolute top-1/2 right-2 size-16 -translate-y-1/2 opacity-[0.15]"
		stroke-width="1"
	/>
{/snippet}
{#snippet memoryValue()}
	<span class="text-md relative truncate font-mono font-medium text-[var(--color-fg)]">
		{info ? fmtBytes(info.hardware.total_memory_bytes) : ''}
	</span>
{/snippet}
{#snippet memorySub()}
	{diskLine || ' '}
{/snippet}
