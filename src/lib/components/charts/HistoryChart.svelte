<script lang="ts" module>
	import type { TimeSeries } from '$lib/stores/livestats.svelte';

	export interface Series {
		name: string;
		data: TimeSeries;
		color: string;
		fill?: boolean;
	}
</script>

<script lang="ts">
	import { onMount } from 'svelte';
	import type { ECharts, EChartsCoreOption, LinearGradientObject } from 'echarts/core';
	import { loadEcharts } from '$lib/charts/echarts-lazy';
	import { chartPalette } from '$lib/charts/chart-theme';
	import { rgbAt } from '$lib/charts/color';

	interface Props {
		series: Series[];
		height?: number;
		yMin?: number;
		yMax?: number;
		/** Let the y-axis fit the data range instead of anchoring at zero — surfaces small changes on a large baseline. */
		relativeScale?: boolean;
		valueFormatter?: (v: number | null) => string;
		axisLabel?: string;
		/** Same string on every chart on the page to sync crosshair hover. */
		group?: string;
		class?: string;
	}

	let {
		series,
		height = 280,
		yMin,
		yMax,
		relativeScale = false,
		valueFormatter,
		axisLabel,
		group,
		class: klass = ''
	}: Props = $props();

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
		const seriesArr = series.map((s) => ({
			type: 'line' as const,
			name: s.name,
			data: zip(s.data.xs, s.data.ys),
			smooth: 0.55,
			smoothMonotone: 'x' as const,
			symbol: 'none',
			sampling: 'lttb',
			animation: false,
			lineStyle: { color: s.color, width: 1.5 },
			itemStyle: { color: s.color },
			areaStyle: s.fill ? { color: gradientFor(s.color), opacity: 1 } : undefined,
			emphasis: { focus: 'series' as const, lineStyle: { width: 2.25 } },
			connectNulls: false
		}));

		const palette = chartPalette();
		return {
			animation: false,
			grid: { left: 56, right: 16, top: 28, bottom: 28 },
			tooltip: {
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
				show: series.length > 1,
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
				min: yMin ?? undefined,
				max: yMax ?? undefined,
				axisLine: { show: false },
				axisTick: { show: false },
				axisLabel: {
					color: palette.axisText,
					fontSize: 10,
					formatter: valueFormatter ? (v: number) => valueFormatter(v) ?? '' : undefined
				},
				splitLine: { lineStyle: { color: palette.gridLine } }
			},
			// Drag-to-zoom is the only zoom gesture (wired via the brush below).
			// Wheel zoom is off so scrolling the page over a chart never
			// hijacks into a zoom. The inside dataZoom stays mounted only so
			// brushEnd can dispatch a dataZoom action into it.
			dataZoom: [
				{
					type: 'inside',
					filterMode: 'none',
					zoomOnMouseWheel: false,
					moveOnMouseMove: false,
					moveOnMouseWheel: false
				}
			],
			// Brush is configured with no toolbox UI; we drive it
			// programmatically via takeGlobalCursor so dragging anywhere on
			// the chart starts a horizontal selection without a click-into
			// "zoom mode" first. brushEnd then triggers dataZoom below.
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

				// brushEnd carries the selected coordRange in axis units; feed it
				// straight into the inside-dataZoom and then drop the brush rect
				// so the chart isn't decorated with the selection afterwards.
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

				// Double-tap / double-click to reset. zrender's 'dblclick' doesn't
				// fire on touch, so detect two quick taps via 'click' instead —
				// works the same on mouse and touch.
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
		for (const s of series) {
			void s.data.xs.length;
			void s.data.ys.length;
		}
		if (!chart) return;
		chart.setOption(buildOption(), { replaceMerge: ['series'] });
	});
</script>

<div class={klass}>
	<!-- height={0} opts into a fill-parent container so the chart can size to a flex/grid cell. -->
	<div
		bind:this={container}
		style="width: 100%; height: {height > 0 ? `${height}px` : '100%'};"
	></div>
</div>
