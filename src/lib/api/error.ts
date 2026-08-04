import type { ApiErrorCode, ErrorResponseBody } from '$lib/types/api';

export class ApiError extends Error {
	readonly code: ApiErrorCode | 'NETWORK' | 'TIMEOUT' | 'PARSE' | 'CORS_OR_OFFLINE';
	readonly status: number;
	readonly userMessage: string;
	readonly serverMessage: string;

	constructor(args: {
		code: ApiError['code'];
		status: number;
		userMessage: string;
		serverMessage?: string;
	}) {
		super(args.serverMessage ?? args.userMessage);
		this.name = 'ApiError';
		this.code = args.code;
		this.status = args.status;
		this.userMessage = args.userMessage;
		this.serverMessage = args.serverMessage ?? args.userMessage;
	}

	get isAuthError(): boolean {
		return (
			this.code === 'UNAUTHORIZED' ||
			this.code === 'INVALID_TOKEN' ||
			this.code === 'DEVICE_NOT_FOUND' ||
			this.code === 'DEVICE_INACTIVE'
		);
	}

	/** credential is invalid server-side; user must re-pair */
	get needsRepair(): boolean {
		return (
			this.code === 'DEVICE_NOT_FOUND' ||
			this.code === 'DEVICE_INACTIVE' ||
			this.code === 'INVALID_TOKEN'
		);
	}

	/** 501: feature not available on this platform / init backend. */
	get isNotSupported(): boolean {
		return this.code === 'NOT_SUPPORTED' || this.status === 501;
	}

	/** 403: authenticated but caller lacks privilege (systemd PolicyKit / Windows UAC). */
	get isForbidden(): boolean {
		return this.code === 'FORBIDDEN' || this.status === 403;
	}

	/** Plain-text 429 from tower-governor on /auth/* — code lives only in HTTP status. */
	get isRateLimited(): boolean {
		return this.status === 429;
	}

	/**
	 * 409 raised because the request named the monitoring agent itself —
	 * killing its own pid from the process list, or stopping/restarting its
	 * own unit from the services list. The deliberate way through is the
	 * agent lifecycle section in settings.
	 *
	 * Matched on the message: the server answers plain `CONFLICT` for this and
	 * for ordinary state conflicts alike, so there is no code to key off. A
	 * phrasing change on the server costs the tailored copy and nothing else —
	 * the server's own text is what gets shown either way.
	 */
	get isSelfTarget(): boolean {
		return this.code === 'CONFLICT' && /remon-server itself/i.test(this.serverMessage);
	}
}

/** @see ApiError.isSelfTarget — same test, applied before the ApiError exists. */
function isSelfTargetMessage(code: ApiErrorCode, message: string): boolean {
	return code === 'CONFLICT' && /remon-server itself/i.test(message);
}

export async function errorFromResponse(res: Response): Promise<ApiError> {
	const status = res.status;

	let body: ErrorResponseBody | null = null;
	let textBody: string | null = null;
	try {
		const ct = res.headers.get('content-type') ?? '';
		if (ct.includes('application/json')) {
			body = (await res.json()) as ErrorResponseBody;
		} else {
			textBody = await res.text();
		}
	} catch {
		// Body unreadable — fall through to defaults below.
	}

	if (body && body.error) {
		return new ApiError({
			code: body.error.code,
			status,
			userMessage: humanize(body.error.code, body.error.message),
			serverMessage: body.error.message
		});
	}

	if (status === 429) {
		// tower-governor returns plain text — body has no JSON `code` field.
		return new ApiError({
			code: 'INTERNAL_ERROR',
			status,
			userMessage: 'Too many requests. Slow down for a moment.',
			serverMessage: textBody ?? 'rate limited'
		});
	}

	return new ApiError({
		code: 'INTERNAL_ERROR',
		status,
		userMessage: `Server returned ${status}.`,
		serverMessage: textBody ?? `HTTP ${status}`
	});
}

function humanize(code: ApiErrorCode, fallback: string): string {
	switch (code) {
		case 'UNAUTHORIZED':
			return 'Authentication required.';
		case 'INVALID_TOKEN':
			return 'Session expired. Please sign in again.';
		case 'DEVICE_NOT_FOUND':
			return 'This device is not registered with the server.';
		case 'DEVICE_INACTIVE':
			return 'This device has been deactivated by the server.';
		case 'PAIRING_EXPIRED':
			return 'Pairing code expired or wrong. Restart the pairing flow.';
		case 'ALREADY_EXISTS':
			return 'A pairing window is already open. Wait for it to expire or finish it.';
		case 'CONFLICT':
			// The server's text names REST endpoints ("use POST /system/restart"),
			// which is the right answer for an API caller and the wrong one for
			// someone who just pressed a button. Point at the UI instead.
			if (isSelfTargetMessage(code, fallback)) {
				return 'That is the monitoring agent itself. Use the agent lifecycle controls in Settings to restart or stop it.';
			}
			return fallback || 'The request conflicts with the current state.';
		case 'DOCKER_UNAVAILABLE':
			return 'Docker is not available on this server.';
		case 'FORBIDDEN':
			return fallback || 'Forbidden — the server rejected this action.';
		case 'NOT_SUPPORTED':
			return fallback || 'Not supported on this platform.';
		case 'SERVICE_UNAVAILABLE':
			// Server-side text is deliberately client-safe and actionable
			// ("assistant provider is rate-limited; try again in a minute").
			return fallback || 'That feature is switched off or not configured on this server.';
		case 'NOT_FOUND':
		case 'BAD_REQUEST':
			return fallback;
		default:
			return fallback || 'Something went wrong.';
	}
}

export function errorFromThrown(e: unknown): ApiError {
	if (e instanceof ApiError) return e;
	const message = e instanceof Error ? e.message : String(e);
	// `AbortSignal.timeout` reports TimeoutError, a caller-side cancel reports
	// AbortError. Same code, different sentence.
	if (e instanceof DOMException && (e.name === 'TimeoutError' || e.name === 'AbortError')) {
		return new ApiError({
			code: 'TIMEOUT',
			status: 0,
			userMessage: e.name === 'TimeoutError' ? 'Request timed out.' : 'Request cancelled.',
			serverMessage: message
		});
	}
	return new ApiError({
		code: 'CORS_OR_OFFLINE',
		status: 0,
		userMessage:
			'Cannot reach the server. Check the URL, network, and that CORS is enabled on remon-server.',
		serverMessage: message
	});
}
