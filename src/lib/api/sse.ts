// EventSource cannot send headers; this lib uses fetch + ReadableStream, and
// the token thunk means reconnects pick up a rotated token.
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
		// Stay open when hidden so the dashboard is current on return.
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
			// A number is the retry delay; throwing would end the loop for good.
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
