// Regenerates the static icons from src/lib/brand/mark.ts: bun scripts/gen-icons.ts
import { writeFileSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';
import { faviconSvg, tileSvg } from '../src/lib/brand/mark';

const out = (name: string) => new URL(`../static/${name}`, import.meta.url);

function png(svg: string, size: number, name: string) {
	const img = new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render();
	writeFileSync(out(name), img.asPng());
}

writeFileSync(out('icon.svg'), tileSvg() + '\n');
writeFileSync(out('favicon.svg'), faviconSvg() + '\n');
png(tileSvg(), 192, 'icon-192.png');
png(tileSvg(), 512, 'icon-512.png');
png(tileSvg(undefined, { bleed: true }), 512, 'icon-maskable-512.png');
// iOS masks its own corners and shows transparency as black, so it gets the bleed.
png(tileSvg(undefined, { bleed: true }), 180, 'apple-touch-icon.png');
