import { afterEach, beforeEach, expect, test } from 'bun:test';
import { openSseStream, type SseSubscription } from './sse';

const originalFetch = globalThis.fetch;
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
let subscription: SseSubscription | undefined;
beforeEach(() => {
	Object.defineProperty(globalThis, 'window', {
		configurable: true,
		value: { setTimeout, clearTimeout }
	});
	Object.defineProperty(globalThis, 'document', { configurable: true, value: new EventTarget() });
});
afterEach(() => {
	subscription?.close();
	subscription = undefined;
	globalThis.fetch = originalFetch;
	for (const [name, descriptor] of [
		['window', originalWindow],
		['document', originalDocument]
	] as const) {
		if (descriptor) Object.defineProperty(globalThis, name, descriptor);
		else Reflect.deleteProperty(globalThis, name);
	}
});

test('reconnects after server EOF and sends the current token', async () => {
	let token = 'old';
	const headers: (string | null)[] = [];
	const messages: string[] = [];
	globalThis.fetch = (async (_url, init) => {
		headers.push(new Headers(init?.headers).get('authorization'));
		return new Response(
			new ReadableStream({
				start(controller) {
					controller.enqueue(new TextEncoder().encode(`data: sample-${headers.length}\n\n`));
					if (headers.length === 1) controller.close();
				}
			}),
			{ headers: { 'content-type': 'text/event-stream' } }
		);
	}) as typeof fetch;
	subscription = openSseStream({
		url: 'https://server.test/sse/stats',
		getAccessToken: () => token,
		reconnectDelayMs: 1,
		handlers: {
			onMessage: (data) => messages.push(data),
			onClose: () => {
				token = 'new';
			}
		}
	});
	for (let i = 0; i < 50 && messages.length < 2; i++) await Bun.sleep(5);
	expect(messages).toEqual(['sample-1', 'sample-2']);
	expect(headers).toEqual(['Bearer old', 'Bearer new']);
	subscription.close();
	await Bun.sleep(10);
	expect(headers).toHaveLength(2);
});

test('closing during the retry delay prevents reconnecting', async () => {
	let calls = 0;
	globalThis.fetch = (async () => {
		calls++;
		throw new TypeError('offline');
	}) as typeof fetch;
	subscription = openSseStream({
		url: 'https://server.test/sse/stats',
		getAccessToken: () => 'token',
		reconnectDelayMs: 20,
		handlers: { onMessage() {} }
	});
	await Bun.sleep(5);
	subscription.close();
	await Bun.sleep(30);
	expect(calls).toBe(1);
});
