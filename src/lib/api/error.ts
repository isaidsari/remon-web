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
		case 'DOCKER_UNAVAILABLE':
			return 'Docker is not available on this server.';
		case 'FORBIDDEN':
			return fallback || 'Forbidden — the server rejected this action.';
		case 'NOT_SUPPORTED':
			return fallback || 'Not supported on this platform.';
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
	if (e instanceof DOMException && e.name === 'AbortError') {
		return new ApiError({
			code: 'TIMEOUT',
			status: 0,
			userMessage: 'Request timed out.',
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
