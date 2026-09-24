import { afterEach, expect, test } from 'bun:test';
import { ApiClient } from './client';

const originalFetch = globalThis.fetch;

test('history requests retain the beginning of a day of minute buckets and a week of five-minute buckets', async () => {
	globalThis.fetch = (async (input) => {
		const url = new URL(String(input));
		const count = Number(url.searchParams.get('end')) === 86400 ? 1440 : 2016;
		const limit = Number(url.searchParams.get('limit') ?? 1000);
		const points = Array.from({ length: count }, (_, timestamp) => ({ timestamp })).slice(-limit);
		return Response.json(
			url.pathname.endsWith('/batch') ? { series: [{ resource: 'cpu', points }] } : { points }
		);
	}) as typeof fetch;
	const client = new ApiClient('https://server.test', () => 'token');
	const day = await client.metricsBatch({ resources: 'cpu', start: 0, end: 86400 });
	expect(day.series[0].points).toHaveLength(1440);
	expect(day.series[0].points[0].timestamp).toBe(0);
	const week = await client.pressureHistory('cpu', { start: 0, end: 604800 });
	expect(week.points).toHaveLength(2016);
	expect(week.points[0].timestamp).toBe(0);
	const limited = await client.cpuHistory({ start: 0, end: 86400, limit: 20 });
	expect(limited.points).toHaveLength(20);
});
afterEach(() => {
	globalThis.fetch = originalFetch;
});

test('chart budgets are forwarded independently of the stored resolution and row limit', async () => {
	const urls: URL[] = [];
	globalThis.fetch = (async (input) => {
		urls.push(new URL(String(input)));
		return Response.json({ points: [], series: [] });
	}) as typeof fetch;
	const client = new ApiClient('https://server.test', () => 'token');
	await client.cpuHistory({ start: 100, end: 3700, max_points: 300 });
	await client.metricsBatch({ resources: 'cpu,memory', max_points: 600 });
	expect(urls.map((url) => url.searchParams.get('max_points'))).toEqual(['300', '600']);
	expect(urls.every((url) => !url.searchParams.has('resolution'))).toBe(true);
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
