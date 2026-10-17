<script lang="ts" module>
	import type { TimeSeries } from '$lib/stores/livestats.svelte';
	import type { ObservedBucket } from '$lib/charts/cpu-history';
	import type { BaselineBand } from '$lib/charts/baseline';

	export interface Series {
		name: string;
		data: TimeSeries;
		color: string;
		fill?: boolean;
		/** Plotted below zero, labelled by magnitude (TX under RX). */
		mirror?: boolean;
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
		/** The learned usual range for this time of day, shaded behind the line. */
		baseline?: BaselineBand | null;
	}

	/** An instant, or a shaded band when `endTs` is set. Unix seconds. */
	export interface ChartAnnotation {
		ts: number;
		endTs?: number;
		label: string;
		severity: 'info' | 'warn' | 'error';
	}
</script>

<script lang="ts">
	import { onMount } from 'svelte';
	import type { ECharts, EChartsCoreOption, LinearGradientObject } from 'echarts/core';
	import { loadEcharts } from '$lib/charts/echarts-lazy';
	import { chartPalette, statusColors } from '$lib/charts/chart-theme';
	import { rgbAt } from '$lib/charts/color';
	import { bandOver, outsideBand } from '$lib/charts/baseline';
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
		timeWindow?: { start: number; end: number };
		/** Compact overview presentation; keep range controls on detail pages. */
		compact?: boolean;
		showAllRanges?: boolean;
		rangeOpacity?: number;
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
		timeWindow,
		compact = false,
		showAllRanges = false,
		rangeOpacity,
		class: klass = ''
	}: Props = $props();

	let hasMirror = $derived(series.some((s) => s.mirror));
	const magnitude =
		(f: ((v: number | null) => string) | undefined) =>
		(v: number | null): string =>
			f ? f(v == null ? v : Math.abs(v)) : String(v == null ? '' : Math.abs(v));
	let fmtValue = $derived(hasMirror ? magnitude(valueFormatter) : valueFormatter);
	let tickFormatter = $derived(
		hasMirror ? magnitude(axisFormatter ?? valueFormatter) : (axisFormatter ?? valueFormatter)
	);
	let rangeMode = $state<'auto' | 'hide'>('auto');
	let focusedSeries = $state(0);
	let hasRanges = $derived(series.some((s) => s.buckets?.some((b) => b != null)));
	let showRanges = $derived(rangeMode !== 'hide');
	let hasBaseline = $derived(series.some((s) => s.baseline));
	let showBaseline = $state(true);
	// Same rule as the observed ranges: past three series, only the focused one.
	const bandVisible = (index: number) => series.length <= 3 || index === focusedSeries;

	let container: HTMLDivElement | null = $state(null);
	let chart: ECharts | null = null;
	let observer: ResizeObserver | null = null;

	// Mirrored fills are densest at the peak too, so the gradient runs bottom-up.
	function gradientFor(c: string, mirrored = false): LinearGradientObject {
		const k = chartPalette().fillScale;
		return {
			type: 'linear',
			x: 0,
			y: mirrored ? 1 : 0,
			x2: 0,
			y2: mirrored ? 0 : 1,
			colorStops: [
				{ offset: 0, color: rgbAt(c, 0.45 * k) },
				{ offset: 0.6, color: rgbAt(c, 0.12 * k) },
				{ offset: 1, color: rgbAt(c, 0) }
			],
			global: false
		};
	}

	function negated(s: Series): Series {
		if (!s.mirror) return s;
		return {
			...s,
			data: { xs: s.data.xs, ys: s.data.ys.map((y) => -y) },
			buckets: s.buckets?.map(
				(b) =>
					b && {
						...b,
						min: b.max == null ? null : -b.max,
						max: b.min == null ? null : -b.min
					}
			)
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
		const plotted = series.map(negated);
		const extrema = showRanges
			? plotted.flatMap(
					(s) =>
						s.buckets?.flatMap((b) =>
							b && b.min != null && b.max != null ? [b.min, b.max] : []
						) ?? []
				)
			: [];
		// The usual range must fit on the axis too, or its edge is clipped away.
		if (showBaseline) {
			series.forEach((s, i) => {
				if (!s.baseline || !bandVisible(i)) return;
				for (const p of s.baseline.points) {
					if (s.mirror) extrema.push(-p.high, -p.low);
					else extrema.push(p.low, p.high);
				}
			});
		}
		const rangeMin = extrema.length ? Math.min(...extrema) : Infinity;
		const rangeMax = extrema.length ? Math.max(...extrema) : -Infinity;
		const seriesArr: Record<string, unknown>[] = plotted.map((s, index) => {
			const source = series[index];
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
				areaStyle: s.fill ? { color: gradientFor(s.color, s.mirror), opacity: 1 } : undefined,
				emphasis: { focus: 'series' as const, lineStyle: { width: 2.25 } },
				connectNulls: false,
				markArea:
					s.buckets &&
					showRanges &&
					(showAllRanges || series.length <= 3 || index === focusedSeries)
						? {
								silent: true,
								animation: false,
								itemStyle: {
									color: rgbAt(s.color, rangeOpacity ?? (compact ? 0.08 : 0.16)),
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
										{ xAxis: b!.start * 1000, yAxis: b!.min, emphasis: { disabled: true } },
										{ xAxis: b!.end * 1000, yAxis: b!.max }
									])
							}
						: undefined,
				tooltip:
					s.buckets || source.baseline
						? {
								// Older buckets without extrema show only the available value.
								valueFormatter: (v: number, dataIndex: number) => {
									const value = fmtValue ? fmtValue(v) : String(v);
									const bucket = source.buckets?.[dataIndex];
									const fmt = (n: number) => (valueFormatter ? valueFormatter(n) : String(n));
									const observed =
										!bucket || bucket.min == null || bucket.max == null
											? value
											: compact
												? m.overview_history_values({
														avg: value,
														min: fmt(bucket.min),
														max: fmt(bucket.max)
													})
												: `${value} (${fmt(bucket.min)}–${fmt(bucket.max)})`;
									const x = source.data.xs[dataIndex];
									const usual =
										source.baseline && showBaseline && bandVisible(index) && x != null
											? bandOver(source.baseline, bucket?.start ?? x, bucket?.end ?? x + 1)
											: null;
									return usual
										? `${observed} · ${m.history_usual_range_value({ low: fmt(usual.low), high: fmt(usual.high) })}`
										: observed;
								}
							}
						: undefined
			};
		});

		const palette = chartPalette();
		if (hasMirror && seriesArr.length > 0) {
			seriesArr[0].markLine = {
				symbol: ['none', 'none'],
				silent: true,
				animation: false,
				data: [
					{
						yAxis: 0,
						lineStyle: { color: palette.axisLine, type: 'solid', width: 1 },
						label: { show: false },
						emphasis: { disabled: true }
					}
				]
			};
		}

		// Marks must attach to a series, so the overlay rides on the first one.
		if (seriesArr.length > 0 && annotations.length > 0) {
			const severityColor = statusColors();
			const lines = annotations.filter((a) => a.endTs == null);
			const bands = annotations.filter((a) => a.endTs != null);
			if (lines.length > 0) {
				const zero = seriesArr[0].markLine as { data?: unknown[] } | undefined;
				seriesArr[0].markLine = {
					symbol: ['none', 'none'],
					animation: false,
					data: [
						...(zero?.data ?? []),
						...lines.map((a) => ({
							xAxis: a.ts * 1000,
							name: a.label,
							lineStyle: { color: severityColor[a.severity], type: 'dashed', width: 1 },
							label: {
								show: false,
								formatter: '{b}',
								position: 'insideEndTop',
								color: severityColor[a.severity],
								fontSize: 10
							},
							emphasis: { label: { show: true } }
						}))
					]
				};
			}
			if (bands.length > 0) {
				const observed = seriesArr[0].markArea as { data?: unknown[] } | undefined;
				// A band's name is printed at the top of the plot by default, and
				// bands close in time printed theirs over one another. Like the
				// instants, a band names itself only while hovered — one at a time.
				seriesArr[0].markArea = {
					...observed,
					silent: false,
					animation: false,
					data: [
						...(observed?.data ?? []),
						...bands.map((a) => [
							{
								xAxis: a.ts * 1000,
								name: a.label,
								itemStyle: { color: rgbAt(severityColor[a.severity], 0.08) },
								label: { show: false },
								emphasis: {
									label: {
										show: true,
										position: 'insideTop',
										color: severityColor[a.severity],
										fontSize: 10
									},
									itemStyle: { color: rgbAt(severityColor[a.severity], 0.16) }
								}
							},
							{ xAxis: (a.endTs ?? a.ts) * 1000 }
						])
					]
				};
			}
		}

		// The usual range rides behind its series as a stacked pair (low, then the
		// height above it) so ECharts fills between the two edges. Each point holds
		// until the next, so the edges are steps, not slopes. `all` lets a mirrored
		// band stack its negative low and positive height.
		const bandSeries: Record<string, unknown>[] = [];
		if (showBaseline) {
			series.forEach((source, index) => {
				const band = source.baseline;
				if (!band || band.points.length === 0 || !bandVisible(index)) return;
				const edges = band.points.map((p) =>
					source.mirror ? ([-p.high, -p.low] as const) : ([p.low, p.high] as const)
				);
				edges.push(edges[edges.length - 1]);
				const xs = [
					...band.points.map((p) => p.ts),
					band.points[band.points.length - 1].ts + band.step
				];
				const edge = {
					type: 'line' as const,
					stack: `baseline-${index}`,
					stackStrategy: 'all',
					step: 'end',
					symbol: 'none',
					silent: true,
					animation: false,
					z: 1,
					tooltip: { show: false },
					emphasis: { disabled: true },
					lineStyle: { color: rgbAt(source.color, 0.35), width: 1, type: 'dashed' }
				};
				bandSeries.push(
					{
						...edge,
						name: `baseline-low-${index}`,
						data: xs.map((x, i) => [x * 1000, edges[i][0]])
					},
					{
						...edge,
						name: `baseline-high-${index}`,
						data: xs.map((x, i) => [x * 1000, edges[i][1] - edges[i][0]]),
						areaStyle: { color: rgbAt(source.color, compact ? 0.06 : 0.1) }
					}
				);

				// Where the line stays outside long enough to mean something, it is
				// redrawn over itself in the warning colour.
				const runs = outsideBand(source.data.xs, source.data.ys, source.buckets, band);
				if (runs.length === 0) return;
				const line = plotted[index];
				const inside = (x: number) => runs.some((r) => x >= r.start && x <= r.end);
				bandSeries.push({
					type: 'line' as const,
					name: `baseline-outside-${index}`,
					data: line.data.xs.map((x, i) => [
						x * 1000,
						inside(x) && Number.isFinite(line.data.ys[i]) ? line.data.ys[i] : null
					]),
					symbol: 'none',
					silent: true,
					animation: false,
					connectNulls: false,
					z: 3,
					tooltip: { show: false },
					emphasis: { disabled: true },
					lineStyle: { color: statusColors().warn, width: 2.25 }
				});
			});
		}

		// One series needs no legend: the card title already names what is plotted.
		const hasLegend = series.length > 1;
		const hasToggles = (hasRanges || hasBaseline) && !compact;
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
				top: hasLegend || hasToggles ? 30 : 10,
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
				// ECharts sets values at 900 otherwise; too heavy for the avg/min/max line.
				textStyle: { color: palette.tooltipText, fontSize: 12, fontWeight: 500 },
				valueFormatter: fmtValue ? (v: unknown) => fmtValue(v as number) : undefined
			},
			legend: {
				right: hasToggles ? (hasRanges && hasBaseline ? 280 : 160) : undefined,
				show: hasLegend,
				// Only the plotted series; the band's own series are not things to toggle.
				data: series.map((s) => s.name),
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
				min: timeWindow ? timeWindow.start * 1000 : undefined,
				max: timeWindow ? timeWindow.end * 1000 : undefined,
				boundaryGap: false,
				// onZero would drag the time labels up to the mirror's midline.
				axisLine: { onZero: !hasMirror, lineStyle: { color: palette.axisLine } },
				axisLabel: { color: palette.axisText, fontSize: 10, hideOverlap: true },
				splitLine: { show: false }
			},
			yAxis: {
				type: 'value',
				name: axisLabel,
				nameTextStyle: { color: palette.axisText, fontSize: 10 },
				// scale:true frees the axis from the zero baseline so small deltas are visible.
				scale: relativeScale,
				// A zero floor would clip the mirrored half.
				min:
					(hasMirror ? undefined : yMin) ??
					((relativeScale || hasMirror) && Number.isFinite(rangeMin)
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
						formatter: fmtValue
							? (p: { value: number | string }) => fmtValue(Number(p.value)) ?? ''
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
			series: [...seriesArr, ...bandSeries]
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
		void showBaseline;
		void focusedSeries;
		for (const s of series) {
			void s.data.xs.length;
			void s.data.ys.length;
			void s.baseline?.points.length;
		}
		const visible = tabVisible();
		if (!chart || !visible) return;
		chart.setOption(buildOption(), { replaceMerge: ['series'] });
	});
</script>

<div class="relative {klass}">
	{#if (hasRanges || hasBaseline) && !compact}
		<div class="absolute top-0 right-2 z-10 flex gap-1">
			{#if hasBaseline}
				<button
					type="button"
					class="text-2xs rounded px-1.5 py-0.5 text-[var(--color-fg-muted)] hover:bg-[var(--color-surface-2)]"
					aria-pressed={showBaseline}
					title={m.history_usual_range_explanation()}
					onclick={() => (showBaseline = !showBaseline)}
				>
					{showBaseline ? '▣' : '□'}
					{m.history_usual_range()}
				</button>
			{/if}
			{#if hasRanges}
				<button
					type="button"
					class="text-2xs rounded px-1.5 py-0.5 text-[var(--color-fg-muted)] hover:bg-[var(--color-surface-2)]"
					aria-pressed={showRanges}
					title={m.history_range_explanation()}
					onclick={() => (rangeMode = showRanges ? 'hide' : 'auto')}
				>
					{showRanges ? '▣' : '□'}
					{m.history_observed_range()}
				</button>
			{/if}
		</div>
	{/if}
	<!-- height={0} opts into a fill-parent container so the chart can size to a flex/grid cell. -->
	<div
		bind:this={container}
		style="width: 100%; height: {height > 0 ? `${height}px` : '100%'};"
	></div>
</div>
