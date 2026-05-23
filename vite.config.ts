import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import Icons from 'unplugin-icons/vite';
import { paraglideVitePlugin } from '@inlang/paraglide-js';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit(),
		VitePWA({
			strategies: 'injectManifest',
			srcDir: 'src',
			filename: 'sw.ts',
			// manifest is served from static/manifest.json; app.html links it
			manifest: false,
			// SW registration is handled by useRegisterSW in +layout.svelte
			injectRegister: null,
			devOptions: { enabled: false }
		}),
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
