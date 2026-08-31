/**
 * Post-build shape checks on `build/`.
 *
 * These exist because of a bug that shipped: SvelteKit's `paths.relative`
 * default made the service worker register as `./sw.js`, which resolves under
 * whatever path the page is on. From the root it worked; from `/servers/{id}/…`
 * it fetched `/servers/{id}/sw.js`, which the SPA fallback answers with
 * index.html, and the browser rejected an HTML document as a worker script.
 * Nothing in the type checker, the unit tests or the build could see it — but
 * the registration URL is a build-time constant, so it is cheap to assert.
 *
 * Run from `postbuild`, before anything is deployed.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const BUILD = 'build';
const failures = [];

function fail(what, detail) {
	failures.push(`${what}\n    ${detail}`);
}

/** Every .js under build/, recursively. */
function jsFiles(dir) {
	const out = [];
	for (const entry of readdirSync(dir)) {
		const p = join(dir, entry);
		if (statSync(p).isDirectory()) out.push(...jsFiles(p));
		else if (entry.endsWith('.js')) out.push(p);
	}
	return out;
}

if (!existsSync(BUILD)) {
	console.error(`verify-build: no ${BUILD}/ directory — run the build first.`);
	process.exit(1);
}

// 1. The worker itself has to be emitted at the root, because that is the only
//    place a root-scoped registration can load it from.
if (!existsSync(join(BUILD, 'sw.js'))) {
	fail('service worker missing', `expected ${BUILD}/sw.js`);
}

// 2. The shell must reference assets absolutely. A relative `./_app/…` works
//    from `/` and 404s from every deeper route.
const indexPath = join(BUILD, 'index.html');
if (!existsSync(indexPath)) {
	fail('shell missing', `expected ${indexPath}`);
} else {
	const html = readFileSync(indexPath, 'utf8');
	const relative = [...html.matchAll(/["'(]\.{1,2}\/_app\//g)];
	if (relative.length > 0) {
		fail(
			'index.html references assets relatively',
			`${relative.length} occurrence(s) of "./_app/" — set kit.paths.relative = false`
		);
	}
}

// 3. The service-worker registration must be absolute, script and scope both.
//    This is the exact defect the file was written for.
const bundles = jsFiles(join(BUILD, '_app'));
const swRefs = bundles.filter((f) => readFileSync(f, 'utf8').includes('sw.js'));

if (swRefs.length === 0) {
	fail('no service-worker registration found', 'expected a bundle referencing sw.js');
}

for (const file of swRefs) {
	const code = readFileSync(file, 'utf8');
	// Quote style is a minifier detail, so accept any of the three.
	const relScript = code.match(/(['"`])\.{1,2}\/sw\.js\1/);
	if (relScript) {
		fail(`relative worker script in ${file}`, `found ${relScript[0]} — expected "/sw.js"`);
	}
	const relScope = code.match(/scope\s*:\s*(['"`])\.{1,2}\/\1/);
	if (relScope) {
		fail(`relative worker scope in ${file}`, `found ${relScope[0]} — expected "/"`);
	}
}

if (failures.length > 0) {
	console.error('verify-build: the build is not deployable\n');
	for (const f of failures) console.error(`  ✗ ${f}\n`);
	process.exit(1);
}

console.log(`verify-build: ok (${swRefs.length} bundle(s) reference the worker)`);
