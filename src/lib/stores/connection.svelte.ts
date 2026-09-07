// Refresh ~60s before exp, broadcast to sibling tabs: rotation wipes all
// sessions, so whoever wins shares the result.

import { ApiClient } from '$lib/api/client';
import { ApiError } from '$lib/api/error';
import type { ServerProfile } from '$lib/types/profile';
import type { SystemInfoResponse } from '$lib/types/api';
import { LiveStats } from './livestats.svelte';

/** Refresh slightly before exp so an in-flight request never sees an expired token. */
const REFRESH_LEAD_MS = 60_000;
/** Max random jitter added to scheduled refreshes (ms). Reduces same-instant races between tabs. */
const REFRESH_JITTER_MS = 8_000;

interface BroadcastTokens {
	type: 'tokens';
	accessToken: string;
	refreshToken: string;
	/** Absolute epoch ms (so receivers don't need to recompute from `expires_in`). */
	expiresAt: number;
	/** Sender id; receivers ignore their own messages (BroadcastChannel already does this, but kept for safety across browsers). */
	from: string;
}

const TAB_ID = crypto.randomUUID();

export type ConnectionStatus = 'idle' | 'authenticating' | 'authenticated' | 'error';

interface ConnectionState {
	status: ConnectionStatus;
	accessToken: string | null;
	refreshToken: string | null;
	/** Epoch ms when the access token expires. */
	expiresAt: number;
	error: ApiError | null;
}

export class Connection {
	private profile: ServerProfile;
	readonly client: ApiClient;
	private state = $state<ConnectionState>({
		status: 'idle',
		accessToken: null,
		refreshToken: null,
		expiresAt: 0,
		error: null
	});
	private refreshTimer: ReturnType<typeof setTimeout> | null = null;
	private _live: LiveStats | null = null;
	private channel: BroadcastChannel | null = null;
	private _systemInfo = $state<{ data: SystemInfoResponse; fetchedAt: number } | null>(null);
	private _systemInfoInflight: Promise<SystemInfoResponse> | null = null;
	private offEnv: Array<() => void> = [];
	private loginPending: Promise<void> | null = null;
	private refreshPending: Promise<void> | null = null;
	private revision = 0;
	private disposed = false;

	constructor(profile: ServerProfile) {
		this.profile = profile;
		this.client = new ApiClient(profile.baseUrl, () => this.state.accessToken);

		if (typeof BroadcastChannel !== 'undefined') {
			this.channel = new BroadcastChannel(`remon-conn:${profile.id}`);
			this.channel.addEventListener('message', (ev) => {
				const msg = ev.data as BroadcastTokens | undefined;
				if (!msg || msg.type !== 'tokens' || msg.from === TAB_ID) return;
				// Apply without re-broadcasting; the sender already broadcast.
				this.applyTokensFromBroadcast(msg);
			});
		}

		// Retry sign-in on connectivity/visibility change, but only for
		// network-class errors — auth failures need user action.
		if (typeof window !== 'undefined' && typeof document !== 'undefined') {
			const tryRecover = () => this.maybeAutoRetry();
			const onOnline = () => tryRecover();
			const onVisibility = () => {
				if (document.visibilityState === 'visible') tryRecover();
			};
			const onFocus = () => tryRecover();
			window.addEventListener('online', onOnline);
			document.addEventListener('visibilitychange', onVisibility);
			window.addEventListener('focus', onFocus);
			this.offEnv.push(
				() => window.removeEventListener('online', onOnline),
				() => document.removeEventListener('visibilitychange', onVisibility),
				() => window.removeEventListener('focus', onFocus)
			);
		}
	}

	private maybeAutoRetry() {
		if (this.state.status !== 'error') return;
		const err = this.state.error;
		if (!err) {
			void this.login().catch(() => {});
			return;
		}
		if (err.code === 'CORS_OR_OFFLINE' || err.code === 'TIMEOUT') {
			void this.login().catch(() => {});
		}
	}

	/** Lazy live-stats handle. Use `live.acquire()` / `live.release()` to drive it. */
	get live(): LiveStats {
		if (!this._live) this._live = new LiveStats(this);
		return this._live;
	}

	/** Cached system info, or null if never fetched / not yet returned. Reactive. */
	get systemInfo(): { data: SystemInfoResponse; fetchedAt: number } | null {
		return this._systemInfo;
	}

	async fetchSystemInfo(): Promise<SystemInfoResponse> {
		if (this._systemInfo) return this._systemInfo.data;
		if (this._systemInfoInflight) return this._systemInfoInflight;
		this._systemInfoInflight = this.client
			.systemInfo()
			.then((data) => {
				this._systemInfo = { data, fetchedAt: Date.now() };
				return data;
			})
			.finally(() => {
				this._systemInfoInflight = null;
			});
		return this._systemInfoInflight;
	}

	async refreshSystemInfo(): Promise<SystemInfoResponse> {
		this._systemInfo = null;
		return this.fetchSystemInfo();
	}

	get serverId(): string {
		return this.profile.id;
	}

	get baseUrl(): string {
		return this.profile.baseUrl;
	}

	get status(): ConnectionStatus {
		return this.state.status;
	}

	get accessToken(): string | null {
		return this.state.accessToken;
	}

	get expiresAt(): number {
		return this.state.expiresAt;
	}

	get error(): ApiError | null {
		return this.state.error;
	}

	get isAuthenticated(): boolean {
		return this.state.status === 'authenticated' && Date.now() < this.state.expiresAt;
	}

	// also handles 'error' state — branching only on 'idle' left stuck connections after outages
	async ensureSignedIn(): Promise<void> {
		if (this.isAuthenticated) return;
		return this.login();
	}

	login(): Promise<void> {
		if (this.disposed) return Promise.resolve();
		if (this.loginPending) return this.loginPending;
		this.loginPending = this.performLogin().finally(() => {
			this.loginPending = null;
		});
		return this.loginPending;
	}

	private async performLogin(): Promise<void> {
		const revision = this.revision;
		this.state.status = 'authenticating';
		this.state.error = null;
		try {
			const tokens = await this.client.login({
				device_id: this.profile.deviceId,
				device_token: this.profile.deviceToken
			});
			if (revision === this.revision) this.applyTokens(tokens);
		} catch (e) {
			if (revision !== this.revision) return;
			this.state.status = 'error';
			this.state.error = e instanceof ApiError ? e : null;
			throw e;
		}
	}

	refresh(): Promise<void> {
		if (this.disposed) return Promise.resolve();
		if (this.refreshPending) return this.refreshPending;
		const revision = this.revision;
		const run = async () => {
			// A sibling may have published the rotated pair while we waited
			// for the browser's cross-tab lock.
			if (revision !== this.revision) return;
			const refreshToken = this.state.refreshToken;
			if (!refreshToken) throw new Error('No refresh token; call login() first');
			try {
				try {
					const tokens = await this.client.refresh({ refresh_token: refreshToken });
					if (revision === this.revision) this.applyTokens(tokens);
				} catch (e) {
					if (revision !== this.revision) return;
					// Broadcast delivery can lag behind lock release. A consumed
					// refresh token is recoverable using the paired credential;
					// revoked/inactive devices still fail the server's login checks.
					if (!(e instanceof ApiError) || e.code !== 'INVALID_TOKEN') throw e;
					await this.login();
				}
			} catch (e) {
				if (revision !== this.revision) return;
				this.tearDown();
				this.state.status = 'error';
				this.state.error = e instanceof ApiError ? e : null;
				throw e;
			}
		};
		const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
		const operation = locks
			? locks.request(`remon-refresh:${this.client.baseUrl}:${this.profile.deviceId}`, run)
			: run();
		this.refreshPending = operation.finally(() => {
			this.refreshPending = null;
		});
		return this.refreshPending;
	}

	async logout(): Promise<void> {
		const logout = this.state.accessToken ? this.client.logout() : Promise.resolve();
		// Invalidate in-flight authentication immediately, even while the
		// best-effort network logout is still waiting for a response.
		this.tearDown();
		try {
			await logout;
		} catch {
			// Best-effort; server may already have revoked us.
		}
	}

	private applyTokens(t: { access_token: string; refresh_token: string; expires_in: number }) {
		if (this.disposed) return;
		this.revision++;
		this.client.clearCache();
		const expiresAt = Date.now() + t.expires_in * 1000;
		this.state.accessToken = t.access_token;
		this.state.refreshToken = t.refresh_token;
		this.state.expiresAt = expiresAt;
		this.state.status = 'authenticated';
		this.state.error = null;
		this.scheduleRefresh();

		this.channel?.postMessage({
			type: 'tokens',
			accessToken: t.access_token,
			refreshToken: t.refresh_token,
			expiresAt,
			from: TAB_ID
		} satisfies BroadcastTokens);
	}

	private applyTokensFromBroadcast(msg: BroadcastTokens) {
		if (this.disposed) return;
		// Drop stale broadcasts: if our current expiresAt is already further
		// in the future, the message is older than what we have.
		if (msg.expiresAt <= this.state.expiresAt) return;
		this.revision++;
		this.client.clearCache();
		this.state.accessToken = msg.accessToken;
		this.state.refreshToken = msg.refreshToken;
		this.state.expiresAt = msg.expiresAt;
		this.state.status = 'authenticated';
		this.state.error = null;
		this.scheduleRefresh();
	}

	private scheduleRefresh() {
		if (this.refreshTimer) clearTimeout(this.refreshTimer);
		const baseDelay = Math.max(this.state.expiresAt - Date.now() - REFRESH_LEAD_MS, 0);
		const jitter = Math.floor(Math.random() * REFRESH_JITTER_MS);
		this.refreshTimer = setTimeout(() => {
			// Skip if a sibling tab already pushed fresher tokens while we waited.
			if (this.state.expiresAt - Date.now() > REFRESH_LEAD_MS) {
				this.scheduleRefresh();
				return;
			}
			this.refresh().catch(() => {
				/* surfaced via state.error already */
			});
		}, baseDelay + jitter);
	}

	private tearDown() {
		this.revision++;
		this.client.clearCache();
		if (this.refreshTimer) {
			clearTimeout(this.refreshTimer);
			this.refreshTimer = null;
		}
		this.state.accessToken = null;
		this.state.refreshToken = null;
		this.state.expiresAt = 0;
		this.state.status = 'idle';
	}

	dispose(): void {
		this.disposed = true;
		this._live?.dispose();
		this.channel?.close();
		this.channel = null;
		for (const off of this.offEnv) off();
		this.offEnv = [];
		this.tearDown();
	}
}
