
export const DEFAULT_ACCENT = '#c2410c';

export interface AccentPreset {
	name: string;
	hex: string;
	strong: string;
	hover: string;
}

export const ACCENT_PRESETS: AccentPreset[] = [
	{ name: 'Rust',    hex: '#c2410c', strong: '#9a3412', hover: '#ea580c' },
	{ name: 'Sky',     hex: '#38bdf8', strong: '#0284c7', hover: '#7dd3fc' },
	{ name: 'Indigo',  hex: '#818cf8', strong: '#6366f1', hover: '#a5b4fc' },
	{ name: 'Teal',    hex: '#2dd4bf', strong: '#0d9488', hover: '#5eead4' },
	{ name: 'Emerald', hex: '#34d399', strong: '#059669', hover: '#6ee7b7' },
	{ name: 'Lime',    hex: '#a3e635', strong: '#65a30d', hover: '#bef264' },
	{ name: 'Amber',   hex: '#fbbf24', strong: '#d97706', hover: '#fcd34d' },
	{ name: 'Orange',  hex: '#f97316', strong: '#c2410c', hover: '#fb923c' },
	{ name: 'Rose',    hex: '#fb7185', strong: '#e11d48', hover: '#fda4af' },
	{ name: 'Pink',    hex: '#f472b6', strong: '#db2777', hover: '#f9a8d4' },
	{ name: 'Fuchsia', hex: '#d946ef', strong: '#a21caf', hover: '#e879f9' },
	{ name: 'Slate',   hex: '#94a3b8', strong: '#475569', hover: '#cbd5e1' }
];

export function isValidHex(s: string): boolean {
	return /^#[0-9a-f]{6}$/i.test(s);
}

function parseHex(hex: string): [number, number, number] {
	const m = hex.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
	if (!m) return [0, 0, 0];
	return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

function luminance([r, g, b]: [number, number, number]): number {
	// Quick perceptual luminance — enough to pick black vs white text.
	return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

export function accentFg(hex: string): string {
	if (!isValidHex(hex)) return '#ffffff';
	return luminance(parseHex(hex)) > 0.55 ? '#0a0a0b' : '#ffffff';
}

export function applyAccent(hex: string): void {
	if (!isValidHex(hex)) return;
	const preset = ACCENT_PRESETS.find((p) => p.hex.toLowerCase() === hex.toLowerCase());
	const [r, g, b] = parseHex(hex);
	const fg = luminance([r, g, b]) > 0.55 ? '#0a0a0b' : '#ffffff';
	const root = document.documentElement.style;
	root.setProperty('--color-accent', hex);
	root.setProperty('--color-accent-strong', preset?.strong ?? hex);
	root.setProperty('--color-accent-hover', preset?.hover ?? hex);
	root.setProperty('--color-accent-fg', fg);
	root.setProperty('--color-accent-bg', `rgba(${r}, ${g}, ${b}, 0.10)`);
	root.setProperty('--color-accent-glow', `rgba(${r}, ${g}, ${b}, 0.45)`);
}

export function clearAccent(): void {
	const root = document.documentElement.style;
	root.removeProperty('--color-accent');
	root.removeProperty('--color-accent-strong');
	root.removeProperty('--color-accent-hover');
	root.removeProperty('--color-accent-fg');
	root.removeProperty('--color-accent-bg');
	root.removeProperty('--color-accent-glow');
}
