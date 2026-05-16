// Token appended as ?access_token= query (browser WS API can't set headers;
// server redacts it from span logs). No auto-reconnect by design — a PTY
// session can't be resumed; reconnecting would silently open a second shell.

export interface WsSubscription {
	send(data: string | ArrayBuffer | ArrayBufferView | Blob): void;
	close(code?: number, reason?: string): void;
	readonly readyState: number;
}

export interface WsHandlers {
	onOpen?: () => void;
	onMessage: (data: string | ArrayBuffer | Blob) => void;
	onError?: (err: unknown) => void;
	onClose?: (ev: CloseEvent) => void;
}

export interface OpenWsOptions {
	url: string;
	getAccessToken: () => string | null;
	query?: Record<string, string | number | boolean | undefined>;
	handlers: WsHandlers;
	binaryType?: 'arraybuffer' | 'blob';
}

export function openWsStream(opts: OpenWsOptions): WsSubscription {
	const url = buildUrl(opts.url, opts.query, opts.getAccessToken());
	const ws = new WebSocket(url);
	if (opts.binaryType) ws.binaryType = opts.binaryType;

	ws.addEventListener('open', () => opts.handlers.onOpen?.());
	ws.addEventListener('message', (ev) => opts.handlers.onMessage(ev.data));
	ws.addEventListener('error', (ev) => opts.handlers.onError?.(ev));
	ws.addEventListener('close', (ev) => opts.handlers.onClose?.(ev));

	return {
		send(data) {
			if (ws.readyState === WebSocket.OPEN) {
				// TS 5.6 narrowed BufferSource to exclude SharedArrayBuffer views;
				// cast through unknown to keep the public signature broad.
				(ws.send as (d: unknown) => void)(data);
			}
		},
		close(code, reason) {
			if (ws.readyState !== WebSocket.CLOSED && ws.readyState !== WebSocket.CLOSING) {
				ws.close(code, reason);
			}
		},
		get readyState() {
			return ws.readyState;
		}
	};
}

function buildUrl(
	rawUrl: string,
	extra: Record<string, string | number | boolean | undefined> | undefined,
	token: string | null
): string {
	let s = rawUrl;
	if (s.startsWith('http://')) s = 'ws://' + s.slice('http://'.length);
	else if (s.startsWith('https://')) s = 'wss://' + s.slice('https://'.length);
	const u = new URL(s);
	if (extra) {
		for (const [k, v] of Object.entries(extra)) {
			if (v === undefined || v === null || v === '') continue;
			u.searchParams.set(k, String(v));
		}
	}
	if (token) u.searchParams.set('access_token', token);
	return u.toString();
}
