// ECharts is canvas-rendered; reads CSS variables at build time, not runtime.

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
	tooltipBg: 'rgba(18,18,22,0.96)',
	tooltipBorder: 'rgba(255,255,255,0.08)',
	tooltipLabelBg: 'rgba(20,20,24,0.95)',
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
