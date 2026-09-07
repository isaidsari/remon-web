import { afterEach, expect, test } from 'bun:test';
import { ApiClient } from './client';

const originalFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = originalFetch;
});

test('a successful mutation makes the next service list fresh', async () => {
	let running = false;
	globalThis.fetch = (async (_url, options) => {
		if (options?.method === 'POST') {
			running = true;
			return new Response(null, { status: 204 });
		}
		return Response.json({ running });
	}) as typeof fetch;
	const client = new ApiClient('https://server.test', () => 'token');
	expect(await client.request('/services')).toEqual({ running: false });
	await client.request('/services/demo/start', { method: 'POST' });
	expect(await client.request('/services')).toEqual({ running: true });
});

test('a read started before a mutation cannot refill the cache with old data', async () => {
	let resolveOld!: (response: Response) => void;
	let reads = 0;
	globalThis.fetch = (async (_url, options) => {
		if (options?.method === 'POST') return new Response(null, { status: 204 });
		if (++reads === 1)
			return new Promise<Response>((resolve) => {
				resolveOld = resolve;
			});
		return Response.json({ running: true });
	}) as typeof fetch;
	const client = new ApiClient('https://server.test', () => 'token');
	const oldRead = client.request('/services');
	await client.request('/services/demo/start', { method: 'POST' });
	expect(await client.request('/services')).toEqual({ running: true });
	resolveOld(Response.json({ running: false }));
	await oldRead;
	expect(await client.request('/services')).toEqual({ running: true });
	expect(reads).toBe(2);
});

test('concurrent reads still share a request', async () => {
	let reads = 0;
	globalThis.fetch = (async () => {
		reads++;
		return Response.json({ ok: true });
	}) as typeof fetch;
	const client = new ApiClient('https://server.test', () => 'token');
	await Promise.all([client.request('/services'), client.request('/services')]);
	expect(reads).toBe(1);
});
