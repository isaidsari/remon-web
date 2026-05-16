// EventSource can't send custom headers; @microsoft/fetch-event-source uses
// fetch + ReadableStream instead. getAccessToken thunk means every reconnect
// picks up the latest rotated token automatically.
import { fetchEventSource } from '@microsoft/fetch-event-source';

export interface SseSubscription {
	close(): void;
}

export interface SseHandlers {
	onOpen?: () => void;
	onMessage: (data: string, event: string) => void;
	onError?: (err: unknown) => void;
	onClose?: () => void;
}

export interface OpenSseOptions {
	url: string;
	getAccessToken: () => string | null;
	handlers: SseHandlers;
	reconnectDelayMs?: number;
}

export function openSseStream(opts: OpenSseOptions): SseSubscription {
	const ctrl = new AbortController();
	const reconnectDelay = opts.reconnectDelayMs ?? 3000;

	void fetchEventSource(opts.url, {
		signal: ctrl.signal,
		// Keep the stream open even when the tab is hidden — we want
		// the dashboard to be current when the user comes back. Browser
		// throttling will slow timers but the SSE still drains.
		openWhenHidden: true,
		fetch: (input, init) => {
			const headers = new Headers(init?.headers);
			const token = opts.getAccessToken();
			if (token) headers.set('Authorization', `Bearer ${token}`);
			return fetch(input, { ...init, headers });
		},
		async onopen(res) {
			const ct = res.headers.get('content-type') ?? '';
			if (res.ok && ct.includes('text/event-stream')) {
				opts.handlers.onOpen?.();
				return;
			}
			// Non-2xx or wrong content type → throw triggers onerror, which
			// returns the retry delay.
			throw new Error(`SSE handshake failed: ${res.status} ${res.statusText}`);
		},
		onmessage(msg) {
			if (msg.data) opts.handlers.onMessage(msg.data, msg.event || 'message');
		},
		onerror(err) {
			opts.handlers.onError?.(err);
			// Returning a number tells the lib how long to wait before retrying.
			// Throwing would stop the loop forever — we never want that here;
			// `close()` (AbortController) is the only stop signal.
			return reconnectDelay;
		},
		onclose() {
			opts.handlers.onClose?.();
		}
	}).catch((err) => {
		// Surfaces the AbortError when the consumer calls close().
		if ((err as { name?: string }).name !== 'AbortError') {
			opts.handlers.onError?.(err);
		}
	});

	return {
		close() {
			ctrl.abort();
		}
	};
}
