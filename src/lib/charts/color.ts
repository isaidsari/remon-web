// Re-alpha a CSS color (hex/rgb/hsl) for ECharts gradient stops; unknown forms
// pass through. Shared by Sparkline and HistoryChart so the hex path can't regress.
export function rgbAt(c: string, alpha: number): string {
	if (c.startsWith('#')) {
		let hex = c.slice(1);
		if (hex.length === 3 || hex.length === 4)
			hex = hex
				.split('')
				.map((ch) => ch + ch)
				.join('');
		if (hex.length === 6 || hex.length === 8) {
			const r = parseInt(hex.slice(0, 2), 16);
			const g = parseInt(hex.slice(2, 4), 16);
			const b = parseInt(hex.slice(4, 6), 16);
			if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b))
				return `rgba(${r}, ${g}, ${b}, ${alpha})`;
		}
		return c;
	}
	if (c.startsWith('rgb(')) return c.replace('rgb(', 'rgba(').replace(')', `, ${alpha})`);
	if (c.startsWith('rgba(')) return c.replace(/, *[0-9.]+\)$/, `, ${alpha})`);
	if (c.startsWith('hsl(')) return c.replace('hsl(', 'hsla(').replace(')', ` / ${alpha})`);
	if (c.startsWith('hsla(')) return c.replace(/\/ *[0-9.]+\)$/, `/ ${alpha})`);
	return c;
}

function clamp(v: number, lo: number, hi: number): number {
	return v < lo ? lo : v > hi ? hi : v;
}

/** WCAG relative luminance of #rrggbb. */
export function luminance(hex: string): number {
	const m = hex.match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
	if (!m) return 0;
	const [r, g, b] = [m[1], m[2], m[3]]
		.map((h) => parseInt(h, 16) / 255)
		.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
	const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
	return (hi + 0.05) / (lo + 0.05);
}

/** #rrggbb → [h 0-360, s 0-100, l 0-100]. Unparseable input reads as black. */
export function hexToHsl(hex: string): [number, number, number] {
	const m = hex.match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
	if (!m) return [0, 0, 0];
	const r = parseInt(m[1], 16) / 255;
	const g = parseInt(m[2], 16) / 255;
	const b = parseInt(m[3], 16) / 255;
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	const l = (max + min) / 2;
	const d = max - min;
	if (d === 0) return [0, 0, l * 100];
	const s = d / (1 - Math.abs(2 * l - 1));
	let h: number;
	if (max === r) h = ((g - b) / d) % 6;
	else if (max === g) h = (b - r) / d + 2;
	else h = (r - g) / d + 4;
	h *= 60;
	if (h < 0) h += 360;
	return [h, s * 100, l * 100];
}

/** Inverse of `hexToHsl`; h wraps, s and l clamp. */
export function hslToHex(h: number, s: number, l: number): string {
	const hh = ((h % 360) + 360) % 360;
	const ss = clamp(s, 0, 100) / 100;
	const ll = clamp(l, 0, 100) / 100;
	const c = (1 - Math.abs(2 * ll - 1)) * ss;
	const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
	const mm = ll - c / 2;
	const seg = Math.floor(hh / 60) % 6;
	const rgb = [
		[c, x, 0],
		[x, c, 0],
		[0, c, x],
		[0, x, c],
		[x, 0, c],
		[c, 0, x]
	][seg];
	const hex = rgb.map((v) =>
		Math.round((v + mm) * 255)
			.toString(16)
			.padStart(2, '0')
	);
	return `#${hex.join('')}`;
}
