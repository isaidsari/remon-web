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

	interface Props {
		series: Series[];
		height?: number;
		yMin?: number;
		yMax?: number;
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
		valueFormatter,
		axisLabel,
		group,
		class: klass = ''
	}: Props = $props();

	let container: HTMLDivElement | null = $state(null);
	let chart: ECharts | null = null;
	let observer: ResizeObserver | null = null;

	function rgbAt(c: string, alpha: number): string {
		if (c.startsWith('rgb(')) return c.replace('rgb(', 'rgba(').replace(')', `, ${alpha})`);
		if (c.startsWith('rgba(')) return c.replace(/, *[0-9.]+\)$/, `, ${alpha})`);
		if (c.startsWith('hsl(')) return c.replace('hsl(', 'hsla(').replace(')', ` / ${alpha})`);
		if (c.startsWith('hsla(')) return c.replace(/\/ *[0-9.]+\)$/, `/ ${alpha})`);
		return c;
	}

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
			grid: { left: 56, right: 16, top: 28, bottom: 56 },
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
				valueFormatter: valueFormatter
					? (v: unknown) => valueFormatter(v as number)
					: undefined
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
				min: yMin ?? undefined,
				max: yMax ?? undefined,
				axisLine: { show: false },
				axisTick: { show: false },
				axisLabel: {
					color: palette.axisText,
					fontSize: 10,
					formatter: valueFormatter
						? (v: number) => valueFormatter(v) ?? ''
						: undefined
				},
				splitLine: { lineStyle: { color: palette.gridLine } }
			},
			dataZoom: [
				{
					type: 'inside',
					filterMode: 'none',
					zoomOnMouseWheel: true,
					moveOnMouseMove: false,
					moveOnMouseWheel: false
				},
				{
					type: 'slider',
					height: 18,
					bottom: 6,
					backgroundColor: palette.gridLine,
					fillerColor: 'rgba(120,140,180,0.15)',
					borderColor: 'transparent',
					handleStyle: { color: 'rgb(120,140,180)' },
					moveHandleStyle: { color: 'rgb(120,140,180)' },
					textStyle: { color: palette.axisText, fontSize: 10 },
					labelFormatter: ''
				}
			],
			series: seriesArr
		};
	}

	onMount(() => {
		// Track unmount so a slow dynamic import doesn't init a disposed container.
		let cancelled = false;
		void loadEcharts().then((echarts) => {
			if (cancelled || !container) return;
			chart = echarts.init(container, undefined, { renderer: 'canvas' });
			chart.setOption(buildOption());
			if (group) {
				chart.group = group;
				echarts.connect(group);
			}
			observer = new ResizeObserver(() => chart?.resize());
			observer.observe(container);
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

<div bind:this={container} class={klass} style="width: 100%; height: {height}px;"></div>
