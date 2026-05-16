<script lang="ts">
	import { cn } from '$lib/utils/cn';
	import type { RangeKey } from './range';
	import IconRefresh from '~icons/lucide/refresh-cw';
	import IconChevronLeft from '~icons/lucide/chevron-left';
	import IconChevronRight from '~icons/lucide/chevron-right';
	import { m } from '$lib/paraglide/messages';
	import { currentLocale } from '$lib/utils/lang';

	export type RefreshInterval = 'off' | '15s' | '30s' | '60s';

	interface Props {
		value: RangeKey;
		onSelect: (key: RangeKey) => void;
		onRefresh?: () => void;
		busy?: boolean;
		/**
		 * Auto-refresh interval. The parent owns the actual setInterval and
		 * calls `onRefresh` on each tick — we just render the toggle and
		 * notify of changes.
		 */
		autoRefresh?: RefreshInterval;
		onAutoRefreshChange?: (i: RefreshInterval) => void;
		/**
		 * Time-travel offset. The parent treats the visible window as
		 * `[now - span - offset, now - offset]`. When 0, "live (now)" mode.
		 * `onShift` returns the requested delta in seconds (negative = back,
		 * positive = forward). Optional — when not supplied, nav buttons hide.
		 */
		offsetSecs?: number;
		onShift?: (deltaSecs: number) => void;
		onResetNow?: () => void;
		class?: string;
	}

	let {
		value,
		onSelect,
		onRefresh,
		busy = false,
		autoRefresh = 'off',
		onAutoRefreshChange,
		offsetSecs = 0,
		onShift,
		onResetNow,
		class: klass = ''
	}: Props = $props();

	const presets: { key: RangeKey; label: string }[] = [
		{ key: '30m', label: '30m' },
		{ key: '1h', label: '1h' },
		{ key: '6h', label: '6h' },
		{ key: '24h', label: '24h' },
		{ key: '7d', label: '7d' },
		{ key: '30d', label: '30d' }
	];

	let refreshOpts = $derived<{ key: RefreshInterval; label: string }[]>([
		{ key: 'off', label: m.chart_autorefresh_off() },
		{ key: '15s', label: '15s' },
		{ key: '30s', label: '30s' },
		{ key: '60s', label: '60s' }
	]);

	import { RANGE_SECONDS } from './range';
	let span = $derived(RANGE_SECONDS[value]);

	// Locale-aware "n minutes ago" via Intl.RelativeTimeFormat. Pass a
	// negative value so we get the "ago" form natively in every locale.
	function fmtOffset(secs: number): string {
		if (secs === 0) return m.chart_range_now();
		const rtf = new Intl.RelativeTimeFormat(currentLocale(), {
			numeric: 'auto',
			style: 'short'
		});
		const abs = Math.abs(secs);
		if (abs >= 86400) return rtf.format(-Math.round(abs / 86400), 'day');
		if (abs >= 3600) return rtf.format(-Math.round(abs / 3600), 'hour');
		return rtf.format(-Math.round(abs / 60), 'minute');
	}
</script>

<div class={cn('flex flex-wrap items-center gap-2', klass)}>
	<div
		class="inline-flex items-center rounded-[var(--radius-input)] border border-[var(--color-border)] bg-[var(--color-surface)] p-0.5"
		role="tablist"
		aria-label={m.chart_range_aria_time()}
	>
		{#each presets as p (p.key)}
			<button
				type="button"
				role="tab"
				aria-selected={value === p.key}
				onclick={() => onSelect(p.key)}
				class={cn(
					'rounded-md px-3 py-1.5 text-xs font-medium tabular-nums transition',
					value === p.key
						? 'bg-[var(--color-surface-3)] text-[var(--color-fg)]'
						: 'text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]'
				)}
			>
				{p.label}
			</button>
		{/each}
	</div>

	{#if onShift}
		<div class="inline-flex items-center gap-1 rounded-[var(--radius-input)] border border-[var(--color-border)] bg-[var(--color-surface)] p-0.5">
			<button
				type="button"
				onclick={() => onShift?.(-span)}
				class="grid h-8 w-8 place-items-center rounded-md text-[var(--color-fg-muted)] transition hover:bg-[var(--color-surface-2)] hover:text-[var(--color-fg)]"
				aria-label={m.chart_range_earlier_aria()}
				title={m.chart_range_earlier_title({ value })}
			>
				<IconChevronLeft class="size-3.5" stroke-width="2" />
			</button>
			<button
				type="button"
				onclick={() => onResetNow?.()}
				class={cn(
					'h-8 px-2 font-mono text-[10px] tracking-wide tabular-nums transition',
					offsetSecs === 0
						? 'cursor-default text-[var(--color-fg-subtle)]'
						: 'rounded-md text-[var(--color-warning)] hover:bg-[var(--color-surface-2)]'
				)}
				disabled={offsetSecs === 0}
				title={offsetSecs === 0 ? m.chart_range_live_title() : m.chart_range_jump_now_title()}
			>
				{fmtOffset(offsetSecs)}
			</button>
			<button
				type="button"
				onclick={() => onShift?.(span)}
				disabled={offsetSecs === 0}
				class="grid h-8 w-8 place-items-center rounded-md text-[var(--color-fg-muted)] transition hover:bg-[var(--color-surface-2)] hover:text-[var(--color-fg)] disabled:cursor-not-allowed disabled:opacity-30"
				aria-label={m.chart_range_later_aria()}
				title={m.chart_range_later_title({ value })}
			>
				<IconChevronRight class="size-3.5" stroke-width="2" />
			</button>
		</div>
	{/if}

	{#if onAutoRefreshChange}
		<div
			class="inline-flex items-center rounded-[var(--radius-input)] border border-[var(--color-border)] bg-[var(--color-surface)] p-0.5"
			role="tablist"
			aria-label={m.chart_autorefresh_aria()}
			title={m.chart_autorefresh_title()}
		>
			<span
				class="px-2 text-[11px] tracking-[0.06em] text-[var(--color-fg-muted)]"
			>
				auto
			</span>
			{#each refreshOpts as o (o.key)}
				<button
					type="button"
					role="tab"
					aria-selected={autoRefresh === o.key}
					onclick={() => onAutoRefreshChange?.(o.key)}
					class={cn(
						'rounded-md px-2 py-1.5 text-xs font-medium tabular-nums transition',
						autoRefresh === o.key
							? 'bg-[var(--color-surface-3)] text-[var(--color-fg)]'
							: 'text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]'
					)}
				>
					{o.label}
				</button>
			{/each}
		</div>
	{/if}

	{#if onRefresh}
		<button
			type="button"
			onclick={onRefresh}
			disabled={busy}
			class="grid h-8 w-8 place-items-center rounded-[var(--radius-input)] border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-fg-muted)] transition hover:border-[var(--color-border-strong)] hover:text-[var(--color-fg)] disabled:cursor-not-allowed disabled:opacity-50"
			aria-label={m.chart_refresh_aria()}
			title={m.chart_refresh_aria()}
		>
			<IconRefresh class={cn('size-[14px]', busy && 'animate-spin')} stroke-width="2" />
		</button>
	{/if}
</div>
