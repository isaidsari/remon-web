// ECharts is canvas-rendered; reads CSS variables at build time, not runtime.
import { contrastRatio, hexToHsl, hslToHex } from './color';

export type ChartTheme = 'light' | 'dark';

function activeTheme(): ChartTheme {
	if (typeof document === 'undefined') return 'dark';
	const declared = document.documentElement.dataset.theme;
	if (declared === 'light') return 'light';
	if (declared === 'dark' || declared === undefined || declared === '') return 'dark';
	// 'auto' — follow OS
	if (
		typeof window !== 'undefined' &&
		window.matchMedia?.('(prefers-color-scheme: light)').matches
	) {
		return 'light';
	}
	return 'dark';
}

export interface ChartPalette {
	gridLine: string;
	axisLine: string;
	crossLine: string;
	tooltipBg: string;
	tooltipBorder: string;
	tooltipLabelBg: string;
	tooltipText: string;
	legendText: string;
	axisText: string;
}

const DARK: ChartPalette = {
	gridLine: 'rgba(255,255,255,0.05)',
	axisLine: 'rgba(255,255,255,0.12)',
	crossLine: 'rgba(255,255,255,0.18)',
	tooltipBg: 'rgba(31,31,36,0.96)',
	tooltipBorder: 'rgba(255,255,255,0.08)',
	tooltipLabelBg: 'rgba(42,42,49,0.95)',
	tooltipText: 'rgb(220,220,228)',
	legendText: 'rgb(180,180,188)',
	axisText: 'rgb(140,140,150)'
};

const LIGHT: ChartPalette = {
	gridLine: 'rgba(0,0,0,0.06)',
	axisLine: 'rgba(0,0,0,0.14)',
	crossLine: 'rgba(0,0,0,0.22)',
	tooltipBg: 'rgba(255,255,255,0.97)',
	tooltipBorder: 'rgba(0,0,0,0.08)',
	tooltipLabelBg: 'rgba(240,240,242,0.95)',
	tooltipText: 'rgb(40,40,46)',
	legendText: 'rgb(82,82,88)',
	axisText: 'rgb(100,100,108)'
};

export function chartPalette(): ChartPalette {
	return activeTheme() === 'light' ? LIGHT : DARK;
}

/* Data colours live here, not in CSS: ECharts draws on canvas, where a
   var() never resolves. They are deliberately independent of --color-accent,
   which belongs to the things you can click. */

export type MetricKey = 'cpu' | 'memory' | 'disk' | 'network' | 'probe';

/** One hue per metric, the same on every page, and none of them close to the
 *  status hues below — an amber line has to mean "watch this". */
const METRIC_HUES: Record<ChartTheme, Record<MetricKey, string>> = {
	dark: {
		cpu: '#60a5fa',
		memory: '#a78bfa',
		disk: '#22d3ee',
		network: '#e879f9',
		probe: '#818cf8'
	},
	light: {
		cpu: '#2563eb',
		memory: '#7c3aed',
		disk: '#0e7490',
		network: '#c026d3',
		probe: '#4f46e5'
	}
};

const NEUTRAL: Record<ChartTheme, string> = { dark: '#8c8c94', light: '#71717a' };

const STATUS: Record<ChartTheme, { info: string; warn: string; error: string }> = {
	dark: { info: '#94a3b8', warn: '#fbbf24', error: '#f87171' },
	light: { info: '#64748b', warn: '#b45309', error: '#dc2626' }
};

/** Steps for series that share one metric's hue — CPU user/system/iowait,
 *  one line per disk, rx against tx. Each is a small turn of the hue and a
 *  place in the legible contrast band below: alternating light and dark keeps
 *  neighbours apart, and going by contrast rather than HSL lightness keeps a
 *  pale cyan from landing next to a pale blue. */
const RAMP: { turn: number; level: number }[] = [
	{ turn: 0, level: 0 }, // the metric's own colour
	{ turn: -8, level: 0.95 },
	{ turn: 8, level: 0.25 },
	{ turn: -17, level: 0.65 },
	{ turn: 17, level: 0.1 },
	{ turn: -25, level: 0.45 }
];

/** The card the series is drawn on, and how far a colour may drift from it. */
const SURFACE: Record<ChartTheme, { bg: string; min: number; max: number }> = {
	dark: { bg: '#17171b', min: 3.2, max: 12.5 },
	light: { bg: '#ffffff', min: 3, max: 11 }
};

/** Re-lightens a hue until it sits `level` of the way up the card's legible
 *  contrast band. Luminance rises with lightness, so a bisection lands it. */
function atLevel(h: number, s: number, level: number, theme: ChartTheme): string {
	const { bg, min, max } = SURFACE[theme];
	const want = min + level * (max - min);
	let lo = 4;
	let hi = 96;
	let best = hslToHex(h, s, 50);
	for (let i = 0; i < 18; i++) {
		const mid = (lo + hi) / 2;
		best = hslToHex(h, s, mid);
		const ratio = contrastRatio(best, bg);
		const tooDim = theme === 'dark' ? ratio < want : ratio > want;
		if (tooDim) lo = mid;
		else hi = mid;
	}
	return best;
}

export function metricColor(key: MetricKey): string {
	return METRIC_HUES[activeTheme()][key];
}

/** Grey for the series that is only there for context. */
export function neutralColor(): string {
	return NEUTRAL[activeTheme()];
}

/** Thresholds, annotations, incident bands — never plain data. */
export function statusColors() {
	return STATUS[activeTheme()];
}

export function metricRamp(key: MetricKey, count: number): string[] {
	const theme = activeTheme();
	const base = METRIC_HUES[theme][key];
	const [h, s] = hexToHsl(base);
	return Array.from({ length: count }, (_, i) => {
		if (i === 0) return base;
		const step = RAMP[i % RAMP.length];
		const wrap = Math.floor(i / RAMP.length) * 9;
		return atLevel(h + step.turn + wrap, s, step.level, theme);
	});
}

/** Unrelated things in one chart — sensors, probe metrics, mount points.
 *  Walks the metric hues first, then further turns of them. */
export function categoricalColors(count: number): string[] {
	// Probe's hue sits close to CPU's, so it stays out of the cycle.
	const keys: MetricKey[] = ['cpu', 'memory', 'disk', 'network'];
	const theme = activeTheme();
	return Array.from({ length: count }, (_, i) => {
		const base = METRIC_HUES[theme][keys[i % keys.length]];
		const round = Math.floor(i / keys.length);
		if (round === 0) return base;
		const [h, s] = hexToHsl(base);
		const step = RAMP[round % RAMP.length];
		return atLevel(h + step.turn, s, step.level, theme);
	});
}
