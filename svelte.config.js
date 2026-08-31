import adapter from '@sveltejs/adapter-static';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	compilerOptions: {
		// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
		runes: ({ filename }) => (filename.split(/[/\\]/).includes('node_modules') ? undefined : true)
	},
	kit: {
		adapter: adapter({
			fallback: 'index.html',
			strict: false
		}),
		alias: {
			$lib: 'src/lib'
		},
		// SvelteKit 2 defaults `relative` to true, which makes vite's base
		// relative — and vite-plugin-pwa then registers the worker as
		// `./sw.js`. Below the root that resolves to e.g.
		// /servers/{id}/sw.js, which the SPA fallback answers with
		// index.html; a service worker script served as text/html is
		// rejected, and Firefox reports it as a bare SecurityError. The app
		// is always served from the origin root, so absolute paths are both
		// correct and the only ones the worker can register from.
		paths: {
			relative: false
		}
	}
};

export default config;
