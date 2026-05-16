// Pure SPA: no SSR, no prerender. The API lives on each remon-server, and the
// vault decryption happens in the browser only — there is nothing for the
// SvelteKit server to do.
export const ssr = false;
export const prerender = false;
export const trailingSlash = 'never';
