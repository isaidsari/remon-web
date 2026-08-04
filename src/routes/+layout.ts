// Pure SPA: the API lives on each remon-server and the vault is decrypted in
// the browser, so there is nothing for the SvelteKit server to do.
export const ssr = false;
export const prerender = false;
export const trailingSlash = 'never';
