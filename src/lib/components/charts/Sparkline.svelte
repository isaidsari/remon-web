<script lang="ts">
	import { onMount } from 'svelte';
	import type { ECharts, EChartsCoreOption, LinearGradientObject } from 'echarts/core';
	import { loadEcharts } from '$lib/charts/echarts-lazy';
	import { chartPalette } from '$lib/charts/chart-theme';
	import type { TimeSeries } from '$lib/stores/livestats.svelte';

	interface ExtraSeries {
		data: TimeSeries;
		color: string;
	}

	interface Props {
		data: TimeSeries;
		color?: string;
		/** Optional second series rendered on the same x-axis (e.g. tx vs rx). */
		extra?: ExtraSeries;
		window?: number;
		height?: number;
		min?: number;
		max?: number;
		fill?: boolean;
		/** Slide-in animation duration ms; match to SSE tick. Default 2000 ms = remon-server cadence. */
		updateMs?: number;
		/** Drop ECharts grid padding so chart bleeds edge-to-edge in its container. */
		tight?: boolean;
		class?: string;
	}

	let {
		data,
		color = '#818cf8',
		extra,
		window = 30,
		height = 64,
		min,
		max,
		fill = true,
		updateMs = 2000,
		tight = false,
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
				{ offset: 0, color: rgbAt(c, 0.65) },
				{ offset: 0.2, color: rgbAt(c, 0.5) },
				{ offset: 0.35, color: rgbAt(c, 0.18) },
				{ offset: 0.7, color: rgbAt(c, 0.04) },
				{ offset: 1, color: rgbAt(c, 0) }
			],
			global: false
		};
	}

	function tail(arr: number[]): number[] {
		return arr.length <= window ? arr.slice() : arr.slice(-window);
	}

	// 10 s is safely past a few delayed ticks but flags a real stream gap.
	const GAP_THRESHOLD_MS = 10_000;

	function zip(xs: number[], ys: number[]): [number, number | null][] {
		const sx = tail(xs);
		const sy = tail(ys);
		const len = Math.min(sx.length, sy.length);
		const out: [number, number | null][] = [];
		let lastTs = 0;
		for (let i = 0; i < len; i++) {
			const ts = sx[i] * 1000;
			const y = sy[i];
			if (lastTs > 0 && ts - lastTs > GAP_THRESHOLD_MS) {
				out.push([lastTs + 1, null]); // null marker breaks the line at gaps (connectNulls: false)
			}
			out.push([ts, Number.isFinite(y) ? y : null]);
			lastTs = ts;
		}
		return out;
	}

	function buildSeries(c: string, ts: TimeSeries) {
		return {
			type: 'line' as const,
			data: zip(ts.xs, ts.ys),
			smooth: 0.5,
			smoothMonotone: 'x' as const,
			symbol: 'none',
			sampling: 'lttb',
			connectNulls: false,
			lineStyle: { color: c, width: 1.75 },
			areaStyle: fill ? { color: gradientFor(c) } : undefined
		};
	}

	// Grows-only y-axis ceiling so bursts don't cause a visible rescale jump.
	let stableMax: number | undefined = undefined;

	function effectiveMax(): number | undefined {
		if (max !== undefined) return max;
		let peak = 0;
		for (const y of tail(data.ys)) if (Number.isFinite(y) && y > peak) peak = y;
		if (extra) for (const y of tail(extra.data.ys)) if (Number.isFinite(y) && y > peak) peak = y;
		if (peak <= 0) return stableMax;
		const target = peak * 1.25;
		if (stableMax === undefined || target > stableMax) {
			stableMax = target;
		} else if (target < stableMax * 0.5) {
			stableMax = target; // burst scrolled out — let scale shrink
		}
		return stableMax;
	}

	function buildOption(): EChartsCoreOption {
		const seriesArr: Record<string, unknown>[] = [
			{ ...buildSeries(color, data), z: 2 }
		];
		if (extra) {
			seriesArr.push({ ...buildSeries(extra.color, extra.data), z: 1 });
		}
		return {
			animation: false,
			animationDurationUpdate: updateMs,
			animationEasingUpdate: 'linear' as const,
			grid: tight
				? { left: 0, right: 0, top: 1, bottom: 0, containLabel: false }
				: { left: 0, right: 0, top: 4, bottom: 4, containLabel: false },
			xAxis: {
				type: 'time',
				show: false,
				boundaryGap: false,
				splitLine: { show: false }
			},
			yAxis: {
				type: 'value',
				show: false,
				min: min ?? undefined,
				max: effectiveMax(),
				scale: false,
				splitLine: {
					show: !tight,
					lineStyle: { color: chartPalette().gridLine, width: 1, type: 'solid' }
				}
			},
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
		void data.xs.length;
		void data.ys.length;
		if (extra) {
			void extra.data.xs.length;
			void extra.data.ys.length;
		}
		if (!chart) return;
		const updates: { data: [number, number | null][] }[] = [{ data: zip(data.xs, data.ys) }];
		if (extra) updates.push({ data: zip(extra.data.xs, extra.data.ys) });
		chart.setOption({ series: updates, yAxis: { max: effectiveMax() } });
	});
</script>

<div bind:this={container} class={klass} style="width: 100%; height: {height}px;"></div>
