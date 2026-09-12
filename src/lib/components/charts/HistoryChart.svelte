<script lang="ts" module>
	import type { TimeSeries } from '$lib/stores/livestats.svelte';
	import type { ObservedBucket } from '$lib/charts/cpu-history';

	export interface Series {
		name: string;
		data: TimeSeries;
		color: string;
		fill?: boolean;
		/** Aligned to data; NULL entries are raw points or explicit gaps. */
		buckets?: (ObservedBucket | null)[];
		summary?: {
			current: number | null;
			avg: number | null;
			min: number | null;
			max: number | null;
			p95: number | null;
		};
		showPercentile?: boolean;
	}

	/** An instant, or a shaded band when `endTs` is set. Unix seconds. */
	export interface ChartAnnotation {
		ts: number;
		endTs?: number;
		label: string;
		severity: 'info' | 'warn' | 'error';
	}

	// Canvas needs literal colors (CSS vars don't resolve inside ECharts);
	// these mirror the app's danger/warning/neutral tones.
	const ANNOTATION_COLORS: Record<ChartAnnotation['severity'], string> = {
		info: 'rgb(148, 163, 184)',
		warn: 'rgb(251, 191, 36)',
		error: 'rgb(248, 113, 113)'
	};
</script>

<script lang="ts">
	import { onMount } from 'svelte';
	import type { ECharts, EChartsCoreOption, LinearGradientObject } from 'echarts/core';
	import { loadEcharts } from '$lib/charts/echarts-lazy';
	import { chartPalette } from '$lib/charts/chart-theme';
	import { rgbAt } from '$lib/charts/color';
	import { tabVisible } from '$lib/utils/visibility.svelte';
	import { m } from '$lib/paraglide/messages';

	interface Props {
		series: Series[];
		height?: number;
		yMin?: number;
		yMax?: number;
		/** Let the y-axis fit the data range instead of anchoring at zero — surfaces small changes on a large baseline. */
		relativeScale?: boolean;
		valueFormatter?: (v: number | null) => string;
		/** Axis ticks want round numbers where the tooltip wants precision, so a
		 *  percent chart reads "%80" on the axis and "%80,4" under the crosshair.
		 *  Falls back to `valueFormatter`. */
		axisFormatter?: (v: number | null) => string;
		axisLabel?: string;
		/** Same string on every chart on the page to sync crosshair hover. */
		group?: string;
		/** Host-event overlay: instants as dashed lines, ranges as shaded bands. */
		annotations?: ChartAnnotation[];
		class?: string;
	}

	let {
		series,
		height = 280,
		yMin,
		yMax,
		relativeScale = false,
		valueFormatter,
		axisFormatter,
		axisLabel,
		group,
		annotations = [],
		class: klass = ''
	}: Props = $props();

	let tickFormatter = $derived(axisFormatter ?? valueFormatter);
	let rangeMode = $state<'auto' | 'hide'>('auto');
	let focusedSeries = $state(0);
	let hasRanges = $derived(series.some((s) => s.buckets?.some((b) => b != null)));
	let showRanges = $derived(rangeMode !== 'hide');

	let container: HTMLDivElement | null = $state(null);
	let chart: ECharts | null = null;
	let observer: ResizeObserver | null = null;

	function gradientFor(c: string): LinearGradientObject {
		return {
			type: 'linear',
			x: 0,
			y: 0,
			x2: 0,
			y2: 1,
			colorStops: [
				{ offset: 0, color: rgbAt(c, 0.45) },
				{ offset: 0.6, color: rgbAt(c, 0.12) },
				{ offset: 1, color: rgbAt(c, 0) }
			],
			global: false
		};
	}

	function zip(xs: number[], ys: number[]): [number, number | null][] {
		const len = Math.min(xs.length, ys.length);
		const out: [number, number | null][] = new Array(len);
		for (let i = 0; i < len; i++) {
			const y = ys[i];
			out[i] = [xs[i] * 1000, Number.isFinite(y) ? y : null];
		}
		return out;
	}

	function buildOption(): EChartsCoreOption {
		const extrema = showRanges
			? series.flatMap(
					(s) =>
						s.buckets?.flatMap((b) =>
							b && b.min != null && b.max != null ? [b.min, b.max] : []
						) ?? []
				)
			: [];
		const rangeMin = extrema.length ? Math.min(...extrema) : Infinity;
		const rangeMax = extrema.length ? Math.max(...extrema) : -Infinity;
		const seriesArr: Record<string, unknown>[] = series.map((s, index) => {
			// Bucket-end duplicates extend the line; they are not extra measurements.
			const isObservation = (i: number) =>
				Number.isFinite(s.data.ys[i]) && (!s.buckets?.[i] || s.data.xs[i] === s.buckets[i]!.start);
			const pointCount = s.data.ys.filter((_, i) => isObservation(i)).length;
			const sparse = pointCount <= 24;
			return {
				type: 'line' as const,
				name: s.name,
				data: zip(s.data.xs, s.data.ys),
				smooth: false,
				step: false,
				symbol: sparse ? 'circle' : 'none',
				symbolSize: (_value: unknown, params: { dataIndex: number }) =>
					sparse && isObservation(params.dataIndex) ? 4 : 0,
				sampling: s.buckets ? undefined : 'lttb',
				animation: false,
				lineStyle: { color: s.color, width: 1.5 },
				itemStyle: { color: s.color },
				areaStyle: s.fill ? { color: gradientFor(s.color), opacity: 1 } : undefined,
				emphasis: { focus: 'series' as const, lineStyle: { width: 2.25 } },
				connectNulls: false,
				markArea:
					s.buckets && showRanges && (series.length <= 3 || index === focusedSeries)
						? {
								silent: true,
								animation: false,
								itemStyle: {
									color: rgbAt(s.color, 0.09),
									borderWidth: 0
								},
								data: s.buckets
									.filter(
										(b, i, all) =>
											b &&
											b.min != null &&
											b.max != null &&
											(i === 0 || all[i - 1]?.start !== b.start)
									)
									.map((b) => [
										{ xAxis: b!.start * 1000, yAxis: b!.min },
										{ xAxis: b!.end * 1000, yAxis: b!.max }
									])
							}
						: undefined,
				tooltip: s.buckets
					? {
							valueFormatter: (v: number, index: number) => {
								const value = valueFormatter ? valueFormatter(v) : String(v);
								const bucket = s.buckets?.[index];
								if (!bucket) return value;
								const fmt = (n: number) => (valueFormatter ? valueFormatter(n) : String(n));
								const interval = `${new Date(bucket.start * 1000).toLocaleTimeString()}–${new Date(bucket.end * 1000).toLocaleTimeString()}`;
								return bucket.min == null || bucket.max == null
									? `${value} · ${m.history_range_unknown()} (${interval})`
									: `${value} · ${m.history_observed_range()}: ${fmt(bucket.min)}–${fmt(bucket.max)} · n=${bucket.count} (${interval})`;
							}
						}
					: undefined
			};
		});

		// Marks must attach to a series, so the overlay rides on the first one.
		if (seriesArr.length > 0 && annotations.length > 0) {
			const lines = annotations.filter((a) => a.endTs == null);
			const bands = annotations.filter((a) => a.endTs != null);
			if (lines.length > 0) {
				seriesArr[0].markLine = {
					symbol: ['none', 'none'],
					animation: false,
					data: lines.map((a) => ({
						xAxis: a.ts * 1000,
						name: a.label,
						lineStyle: { color: ANNOTATION_COLORS[a.severity], type: 'dashed', width: 1 },
						label: {
							show: false,
							formatter: '{b}',
							position: 'insideEndTop',
							color: ANNOTATION_COLORS[a.severity],
							fontSize: 10
						},
						emphasis: { label: { show: true } }
					}))
				};
			}
			if (bands.length > 0) {
				const observed = seriesArr[0].markArea as { data?: unknown[] } | undefined;
				seriesArr[0].markArea = {
					...observed,
					silent: true,
					animation: false,
					data: [
						...(observed?.data ?? []),
						...bands.map((a) => [
							{
								xAxis: a.ts * 1000,
								name: a.label,
								itemStyle: { color: rgbAt(ANNOTATION_COLORS[a.severity], 0.08) }
							},
							{ xAxis: (a.endTs ?? a.ts) * 1000 }
						])
					]
				};
			}
		}

		const palette = chartPalette();
		// One series needs no legend: the card title already names what is plotted.
		const hasLegend = series.length > 1;
		return {
			animation: false,
			// outerBoundsMode 'same' lets the axis labels shrink the plot to fit
			// rather than budgeting a fixed margin wide enough for the worst label.
			//
			// top has to clear the legend AND the topmost y tick, which is centred on
			// the plot's top edge and so sticks half its height above it.
			grid: {
				left: 4,
				right: 10,
				top: hasLegend || hasRanges ? 30 : 10,
				bottom: 4,
				outerBoundsMode: 'same',
				outerBoundsContain: 'axisLabel'
			},
			tooltip: {
				confine: true,
				trigger: 'axis',
				axisPointer: {
					type: 'cross',
					crossStyle: { color: palette.crossLine },
					lineStyle: { color: palette.crossLine },
					label: { backgroundColor: palette.tooltipLabelBg }
				},
				backgroundColor: palette.tooltipBg,
				borderColor: palette.tooltipBorder,
				textStyle: { color: palette.tooltipText, fontSize: 12 },
				valueFormatter: valueFormatter ? (v: unknown) => valueFormatter(v as number) : undefined
			},
			legend: {
				right: hasRanges ? 160 : undefined,
				show: hasLegend,
				// Scrolls instead of wrapping: a second legend row would sit on the plot,
				// because the grid reserves one row's worth of space and no more.
				type: 'scroll',
				top: 0,
				left: 'left',
				textStyle: { color: palette.legendText, fontSize: 11 },
				icon: 'roundRect',
				itemWidth: 10,
				itemHeight: 10,
				itemGap: 14
			},
			xAxis: {
				type: 'time',
				boundaryGap: false,
				axisLine: { lineStyle: { color: palette.axisLine } },
				axisLabel: { color: palette.axisText, fontSize: 10, hideOverlap: true },
				splitLine: { show: false }
			},
			yAxis: {
				type: 'value',
				name: axisLabel,
				nameTextStyle: { color: palette.axisText, fontSize: 10 },
				// scale:true frees the axis from the zero baseline so small deltas are visible.
				scale: relativeScale,
				min:
					yMin ??
					(relativeScale && Number.isFinite(rangeMin)
						? (v: { min: number }) => Math.min(v.min, rangeMin)
						: undefined),
				max:
					yMax ??
					(Number.isFinite(rangeMax)
						? (v: { max: number }) => Math.max(v.max, rangeMax)
						: undefined),
				axisLine: { show: false },
				axisTick: { show: false },
				axisLabel: {
					color: palette.axisText,
					fontSize: 10,
					formatter: tickFormatter ? (v: number) => tickFormatter(v) ?? '' : undefined
				},
				// Without this the crosshair's value label prints a raw number, dot
				// decimal and all, next to axis labels that went through the locale.
				axisPointer: {
					label: {
						formatter: valueFormatter
							? (p: { value: number | string }) => valueFormatter(Number(p.value)) ?? ''
							: undefined
					}
				},
				splitLine: { lineStyle: { color: palette.gridLine } }
			},
			// Drag-to-zoom only; wheel zoom would hijack page scroll. The inside
			// dataZoom stays mounted so brushEnd can dispatch into it.
			dataZoom: [
				{
					type: 'inside',
					filterMode: 'none',
					zoomOnMouseWheel: false,
					moveOnMouseMove: false,
					moveOnMouseWheel: false
				}
			],
			// No toolbox UI: takeGlobalCursor arms the brush so any drag zooms.
			brush: {
				xAxisIndex: 0,
				brushType: 'lineX',
				brushMode: 'single',
				transformable: false,
				throttleType: 'debounce',
				throttleDelay: 100,
				brushStyle: {
					borderWidth: 1,
					color: 'rgba(120,140,180,0.15)',
					borderColor: 'rgba(120,140,180,0.45)'
				}
			},
			// toolbox must exist for `brush` to be addressable, but we hide it.
			toolbox: { show: false, feature: { brush: {} } },
			series: seriesArr
		};
	}

	function enableBrushCursor() {
		chart?.dispatchAction({
			type: 'takeGlobalCursor',
			key: 'brush',
			brushOption: { brushType: 'lineX', brushMode: 'single' }
		});
	}

	function clearBrush() {
		chart?.dispatchAction({ type: 'brush', areas: [] });
	}

	function resetZoom() {
		chart?.dispatchAction({ type: 'dataZoom', start: 0, end: 100 });
		clearBrush();
		enableBrushCursor();
	}

	onMount(() => {
		// Track unmount so a slow dynamic import doesn't init a disposed container.
		let cancelled = false;
		void loadEcharts()
			.then((echarts) => {
				if (cancelled || !container) return;
				chart = echarts.init(container, undefined, { renderer: 'canvas' });
				chart.setOption(buildOption());
				chart.on('mouseover', (params: unknown) => {
					const index = (params as { seriesIndex?: number }).seriesIndex;
					if (index != null && index < series.length) focusedSeries = index;
				});

				// coordRange is in axis units; feed dataZoom, then drop the rect.
				chart.on('brushEnd', (params: unknown) => {
					const p = params as { areas?: Array<{ coordRange?: [number, number] }> };
					const range = p.areas?.[0]?.coordRange;
					if (!range) return;
					const [startValue, endValue] = range;
					chart?.dispatchAction({ type: 'dataZoom', startValue, endValue });
					clearBrush();
					// Re-arm brush cursor so the next drag also zooms.
					enableBrushCursor();
				});

				// zrender dblclick does not fire on touch — detect two quick taps.
				let lastTap = 0;
				chart.getZr().on('click', () => {
					const now = Date.now();
					if (now - lastTap < 320) {
						resetZoom();
						lastTap = 0;
					} else {
						lastTap = now;
					}
				});
				enableBrushCursor();

				if (group) {
					chart.group = group;
					echarts.connect(group);
				}
				observer = new ResizeObserver(() => chart?.resize());
				observer.observe(container);
			})
			.catch(() => {
				/* echarts import failed; the chart just stays unrendered */
			});
		return () => {
			cancelled = true;
			observer?.disconnect();
			chart?.dispose();
			chart = null;
		};
	});

	$effect(() => {
		// Touch sources before the early return so $effect tracks them even when chart is null.
		void series.length;
		void annotations.length;
		void showRanges;
		void focusedSeries;
		for (const s of series) {
			void s.data.xs.length;
			void s.data.ys.length;
		}
		const visible = tabVisible();
		if (!chart || !visible) return;
		chart.setOption(buildOption(), { replaceMerge: ['series'] });
	});
</script>

<div class="relative {klass}">
	{#if hasRanges}
		<button
			type="button"
			class="text-2xs absolute top-0 right-2 z-10 rounded px-1.5 py-0.5 text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-hover)]"
			aria-pressed={showRanges}
			title={m.history_range_explanation()}
			onclick={() => (rangeMode = showRanges ? 'hide' : 'auto')}
		>
			{showRanges ? '▣' : '□'}
			{m.history_observed_range()}
		</button>
	{/if}
	<!-- height={0} opts into a fill-parent container so the chart can size to a flex/grid cell. -->
	<div
		bind:this={container}
		style="width: 100%; height: {height > 0 ? `${height}px` : '100%'};"
	></div>
</div>
