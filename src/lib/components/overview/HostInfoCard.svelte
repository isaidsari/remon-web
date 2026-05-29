<script lang="ts">
	import { fmtBytes, fmtDuration } from '$lib/utils/format';
	import { cn } from '$lib/utils/cn';
	import type { SystemInfoResponse } from '$lib/types/api';
	import OsIcon from './OsIcon.svelte';
	import CpuIcon from './CpuIcon.svelte';
	import IconServer from '~icons/lucide/server';
	import IconMemoryStick from '~icons/lucide/memory-stick';

	interface Props {
		info: SystemInfoResponse | null;
		/** Epoch ms when `info` was fetched. Used to advance uptime locally without re-hitting the server. */
		fetchedAt?: number;
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
		if (!info) return '—';
		const { os, os_version } = info.description;
		if (!os_version || os_version === 'unknown') return os.toLowerCase();
		const candidate = os_version.toLowerCase().includes(os.toLowerCase())
			? os_version
			: `${os} ${os_version}`;
		return candidate.toLowerCase();
	});
</script>

<div
	class={cn(
		'overflow-hidden rounded-[var(--radius-card)] shadow-[inset_0_1px_0_rgba(255,255,255,0.03),0_0_0_1px_var(--color-border)]',
		'hairline-grid',
		'grid-cols-2 lg:grid-cols-4',
		klass
	)}
>
	{@render hostnameCell()}
	{@render osCell()}
	{@render cpuCell()}
	{@render memoryCell()}
</div>

{#snippet hostnameCell()}
	<div class="relative flex flex-col gap-1.5 overflow-hidden bg-[var(--color-surface)] px-4 py-3.5">
		<IconServer
			class="pointer-events-none absolute right-2 top-1/2 size-16 -translate-y-1/2 opacity-[0.15]"
			stroke-width="1"
		/>
		<span
			class="relative font-mono text-[11px] font-medium tracking-[0.08em] text-[var(--color-fg-muted)]"
		>
			hostname
		</span>
		<span
			class="relative truncate font-mono text-[13px] font-medium text-[var(--color-fg)]"
			title={info?.description.hostname ?? ''}
		>
			{info?.description.hostname ?? '—'}
		</span>
		{#if info}
			<span class="relative truncate font-mono text-[11px] text-[var(--color-fg-subtle)]">
				up {fmtDuration(liveUptime)}
			</span>
		{/if}
	</div>
{/snippet}

{#snippet memoryCell()}
	<div class="relative flex flex-col gap-1.5 overflow-hidden bg-[var(--color-surface)] px-4 py-3.5">
		<IconMemoryStick
			class="pointer-events-none absolute right-2 top-1/2 size-16 -translate-y-1/2 opacity-[0.15]"
			stroke-width="1"
		/>
		<span
			class="relative font-mono text-[11px] font-medium tracking-[0.08em] text-[var(--color-fg-muted)]"
		>
			memory
		</span>
		<span class="relative truncate font-mono text-[13px] font-medium text-[var(--color-fg)]">
			{info ? fmtBytes(info.hardware.total_memory_bytes) : '—'}
		</span>
	</div>
{/snippet}

{#snippet cpuCell()}
	<div class="relative flex flex-col gap-1.5 overflow-hidden bg-[var(--color-surface)] px-4 py-3.5">
		{#if info}
			<CpuIcon
				model={info.hardware.cpu_model}
				class="pointer-events-none absolute right-2 top-1/2 size-16 -translate-y-1/2 opacity-[0.28]"
			/>
		{/if}
		<span
			class="relative font-mono text-[11px] font-medium tracking-[0.08em] text-[var(--color-fg-muted)]"
		>
			cpu
		</span>
		<span
			class="relative truncate font-mono text-[13px] font-medium text-[var(--color-fg)]"
			title={info?.hardware.cpu_model ?? ''}
		>
			{info?.hardware.cpu_model ?? '—'}
		</span>
		{#if info}
			<span class="relative truncate font-mono text-[11px] text-[var(--color-fg-subtle)]">
				{info.hardware.cpu_cores}c · {info.hardware.cpu_threads}t
			</span>
		{/if}
	</div>
{/snippet}

{#snippet osCell()}
	<div class="relative flex flex-col gap-1.5 overflow-hidden bg-[var(--color-surface)] px-4 py-3.5">
		{#if info}
			<OsIcon
				os={info.description.os}
				version={info.description.os_version}
				class="pointer-events-none absolute right-2 top-1/2 size-16 -translate-y-1/2 opacity-[0.28]"
			/>
		{/if}
		<span
			class="relative font-mono text-[11px] font-medium tracking-[0.08em] text-[var(--color-fg-muted)]"
		>
			os
		</span>
		<span
			class="relative truncate font-mono text-[13px] font-medium text-[var(--color-fg)]"
			title={osLabel}
		>
			{osLabel}
		</span>
		{#if info}
			<span class="relative truncate font-mono text-[11px] text-[var(--color-fg-subtle)]">
				kernel {info.description.kernel}
			</span>
		{/if}
	</div>
{/snippet}
