import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import Icons from 'unplugin-icons/vite';
import { paraglideVitePlugin } from '@inlang/paraglide-js';

export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit(),
		Icons({
			compiler: 'svelte',
			autoInstall: false
		}),
		// localStorage → preferredLanguage → baseLocale: saved choice first,
		// then browser language, then English. No URL-based routing.
		paraglideVitePlugin({
			project: './project.inlang',
			outdir: './src/lib/paraglide',
			strategy: ['localStorage', 'preferredLanguage', 'baseLocale'],
			localStorageKey: 'remon.lang'
		})
	],
	define: {
		__BUILD_TIME__: JSON.stringify(Math.floor(Date.now() / 1000))
	}
});
