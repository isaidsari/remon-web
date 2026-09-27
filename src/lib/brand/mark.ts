// The remon mark: three rack units whose fills are CPU, memory and disk use,
// with a status lamp on the top unit. Pure strings so the build script and the
// live favicon draw the same thing.

export type MarkStatus = 'ok' | 'warn' | 'crit' | 'off';

/** CPU, memory, disk, each 0..100. */
export type MarkValues = readonly [number, number, number];

export const STATUS_COLOR: Record<MarkStatus, string> = {
	ok: '#f97316',
	warn: '#f59e0b',
	crit: '#ef4444',
	off: '#8c8c94'
};

/** A calm, healthy box; the app icon is this moment. */
export const RESTING: MarkValues = [35, 60, 45];

const TILE_BG = '#111113';
const TILE_FG = '#ededf0';

interface Geometry {
	ys: readonly number[];
	h: number;
	x: number;
	rail: number;
	max: number;
	rx: number;
	led: { cx: number; r: number };
}

const TILE: Geometry = {
	ys: [15, 27.5, 40],
	h: 9.5,
	x: 11,
	rail: 42,
	max: 30,
	rx: 3,
	led: { cx: 47.5, r: 3.2 }
};
// Edge to edge, for 16px tabs where a tile's padding costs a fifth of the space.
const BARE: Geometry = {
	ys: [3, 24, 45],
	h: 16,
	x: 2,
	rail: 60,
	max: 42,
	rx: 4,
	led: { cx: 54, r: 6 }
};

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Fill width; floored at an eighth so an idle unit still reads as one. */
export function fillWidth(max: number, v: number): number {
	const clamped = Math.min(100, Math.max(0, Number.isFinite(v) ? v : 0));
	return r2(max * (0.12 + (0.88 * clamped) / 100));
}

function units(g: Geometry, values: MarkValues, status: MarkStatus, fg: string): string {
	const dim = status === 'off' ? ' opacity=".3"' : '';
	return g.ys
		.map((y, i) => {
			const cy = r2(y + g.h / 2);
			const lamp =
				i === 0
					? `<circle cx="${g.led.cx}" cy="${cy}" r="${g.led.r}" fill="${STATUS_COLOR[status]}"/>`
					: `<circle cx="${g.led.cx}" cy="${cy}" r="${g.led.r}" fill="${fg}" opacity=".45"/>`;
			return (
				`<rect x="${g.x}" y="${y}" width="${g.rail}" height="${g.h}" rx="${g.rx}" fill="${fg}" opacity=".16"/>` +
				`<rect x="${g.x}" y="${y}" width="${fillWidth(g.max, values[i])}" height="${g.h}" rx="${g.rx}" fill="${fg}"${dim}/>` +
				lamp
			);
		})
		.join('');
}

/** App icon: dark rounded tile. `bleed` fills the square and shrinks the
 *  mark into the maskable safe zone, for launchers that crop their own shape. */
export function tileSvg(values: MarkValues = RESTING, opts: { bleed?: boolean } = {}): string {
	const bg = opts.bleed
		? `<rect width="64" height="64" fill="${TILE_BG}"/>`
		: `<rect width="64" height="64" rx="14" fill="${TILE_BG}"/>`;
	const body = units(TILE, values, 'ok', TILE_FG);
	const mark = opts.bleed
		? `<g transform="translate(32 32) scale(.8) translate(-32 -32)">${body}</g>`
		: body;
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${bg}${mark}</svg>`;
}

/** Tab icon: no tile, and the units follow the browser's light or dark chrome. */
export function faviconSvg(values: MarkValues = RESTING, status: MarkStatus = 'ok'): string {
	return (
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
		`<style>:root{color:#18181b}@media (prefers-color-scheme:dark){:root{color:#ededf0}}</style>` +
		units(BARE, values, status, 'currentColor') +
		`</svg>`
	);
}

export function svgDataUrl(svg: string): string {
	return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
