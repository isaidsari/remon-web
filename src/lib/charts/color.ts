// Re-alpha a CSS color (hex/rgb/hsl) for ECharts gradient stops; unknown forms
// pass through. Shared by Sparkline and HistoryChart so the hex path can't regress.
export function rgbAt(c: string, alpha: number): string {
	if (c.startsWith('#')) {
		let hex = c.slice(1);
		// Expand shorthand (#abc / #abcf) to full form.
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
