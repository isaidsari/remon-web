<script lang="ts">
	import { cn } from '$lib/utils/cn';
	import AutoRefreshSelect, {
		type AutoRefreshOption
	} from '$lib/components/ui/AutoRefreshSelect.svelte';
	import RefreshButton from '$lib/components/ui/RefreshButton.svelte';
	import SegmentedControl from '$lib/components/ui/SegmentedControl.svelte';
	import type { RangeKey } from './range';
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

	let refreshOpts = $derived<AutoRefreshOption[]>([
		{ value: 'off', label: m.chart_autorefresh_off() },
		{ value: '15s', label: '15s' },
		{ value: '30s', label: '30s' },
		{ value: '60s', label: '60s' }
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

<div class={cn('flex w-full flex-col gap-2 sm:w-auto lg:flex-row lg:items-center', klass)}>
	<SegmentedControl
		{value}
		options={presets.map((p) => ({ value: p.key, label: p.label }))}
		{onSelect}
		ariaLabel={m.chart_range_aria_time()}
		class="flex w-full overflow-x-auto sm:w-auto"
		buttonClass="min-w-12 flex-1 tabular-nums sm:flex-none"
	/>

	<div class="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:flex-nowrap">
		{#if onShift}
			<div
				class="inline-flex min-w-[8.75rem] flex-1 items-center rounded-[var(--radius-input)] border border-[var(--color-border)] bg-[var(--color-surface)] p-0.5 sm:flex-none"
			>
				<button
					type="button"
					onclick={() => onShift?.(-span)}
					class="grid h-7 w-8 shrink-0 place-items-center rounded-md text-[var(--color-fg-muted)] transition hover:bg-[var(--color-surface-2)] hover:text-[var(--color-fg)]"
					aria-label={m.chart_range_earlier_aria()}
					title={m.chart_range_earlier_title({ value })}
				>
					<IconChevronLeft class="size-3.5" stroke-width="2" />
				</button>
				<button
					type="button"
					onclick={() => onResetNow?.()}
					class={cn(
						'h-7 min-w-[4.75rem] flex-1 rounded-md px-2 font-mono text-[10px] tracking-wide tabular-nums transition sm:flex-none',
						offsetSecs === 0
							? 'cursor-default text-[var(--color-fg-subtle)]'
							: 'text-[var(--color-warning)] hover:bg-[var(--color-surface-2)]'
					)}
					disabled={offsetSecs === 0}
					title={offsetSecs === 0 ? m.chart_range_live_title() : m.chart_range_jump_now_title()}
				>
					<span class="block truncate">{fmtOffset(offsetSecs)}</span>
				</button>
				<button
					type="button"
					onclick={() => onShift?.(span)}
					disabled={offsetSecs === 0}
					class="grid h-7 w-8 shrink-0 place-items-center rounded-md text-[var(--color-fg-muted)] transition hover:bg-[var(--color-surface-2)] hover:text-[var(--color-fg)] disabled:cursor-not-allowed disabled:opacity-30"
					aria-label={m.chart_range_later_aria()}
					title={m.chart_range_later_title({ value })}
				>
					<IconChevronRight class="size-3.5" stroke-width="2" />
				</button>
			</div>
		{/if}

		{#if onAutoRefreshChange}
			<AutoRefreshSelect
				value={autoRefresh}
				options={refreshOpts}
				onChange={(next) => onAutoRefreshChange?.(next as RefreshInterval)}
				class="flex-[1_1_8.5rem] sm:flex-none"
			/>
		{/if}

		{#if onRefresh}
			<RefreshButton onclick={onRefresh} loading={busy} />
		{/if}
	</div>
</div>
