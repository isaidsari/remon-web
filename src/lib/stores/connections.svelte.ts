// Refresh: scheduled ~60s before exp with up to 8s jitter. Result is broadcast
// via BroadcastChannel so sibling tabs skip their own refresh — server rotation
// wipes all sessions; whoever wins broadcasts, others apply without re-fetching.

import { ApiClient } from '$lib/api/client';
import { ApiError } from '$lib/api/error';
import type { ServerProfile } from '$lib/types/profile';
import type { SystemInfoResponse } from '$lib/types/api';
import { vault } from '$lib/vault/store.svelte';
import { LiveStats } from './livestats.svelte';
import { profiles } from './profiles.svelte';

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

const TAB_ID =
	typeof crypto !== 'undefined' && 'randomUUID' in crypto
		? crypto.randomUUID()
		: Math.random().toString(36).slice(2);

export type ConnectionStatus = 'idle' | 'authenticating' | 'authenticated' | 'error';

interface ConnectionState {
	status: ConnectionStatus;
	accessToken: string | null;
	refreshToken: string | null;
	/** Epoch ms when the access token expires. */
	expiresAt: number;
	error: ApiError | null;
}

class Connection {
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

		// Auto-recover from transient network outages: when the browser
		// reports a connectivity change OR the tab becomes visible after
		// being backgrounded, retry sign-in if we're stuck on a network-
		// class error. Auth-class failures (DEVICE_NOT_FOUND etc.) are NOT
		// retried — those need user action to repair.
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
		if (this.state.status === 'authenticating') return;
		return this.login();
	}

	async login(): Promise<void> {
		this.state.status = 'authenticating';
		this.state.error = null;
		try {
			const tokens = await this.client.login({
				device_id: this.profile.deviceId,
				device_token: this.profile.deviceToken
			});
			this.applyTokens(tokens);
		} catch (e) {
			this.state.status = 'error';
			this.state.error = e instanceof ApiError ? e : null;
			throw e;
		}
	}

	async refresh(): Promise<void> {
		if (!this.state.refreshToken) {
			throw new Error('No refresh token; call login() first');
		}
		try {
			const tokens = await this.client.refresh({ refresh_token: this.state.refreshToken });
			this.applyTokens(tokens);
		} catch (e) {
			this.tearDown();
			this.state.status = 'error';
			this.state.error = e instanceof ApiError ? e : null;
			throw e;
		}
	}

	async logout(): Promise<void> {
		try {
			if (this.state.accessToken) await this.client.logout();
		} catch {
			// Best-effort; server may already have revoked us.
		}
		this.tearDown();
	}

	private applyTokens(t: { access_token: string; refresh_token: string; expires_in: number }) {
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
		// Drop stale broadcasts: if our current expiresAt is already further
		// in the future, the message is older than what we have.
		if (msg.expiresAt <= this.state.expiresAt) return;
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
		this.channel?.close();
		this.channel = null;
		for (const off of this.offEnv) off();
		this.offEnv = [];
		this.tearDown();
	}
}

const map = new Map<string, Connection>();

export const connections = {
	connect(profile: ServerProfile): Connection {
		let c = map.get(profile.id);
		if (!c) {
			c = new Connection(profile);
			map.set(profile.id, c);
		}
		return c;
	},

	get(id: string): Connection | undefined {
		return map.get(id);
	},

	/** Tear down a single connection (revoking its access jti server-side). */
	async disconnect(id: string): Promise<void> {
		const c = map.get(id);
		if (!c) return;
		await c.logout();
		c.dispose();
		map.delete(id);
	},

	/**
	 * Drop a connection from the cache without trying to revoke it server-
	 * side. Used during re-pair when the existing credential is already
	 * invalid (so /auth/logout would 401 anyway). The next `connect()` will
	 * lazily build a fresh Connection bound to the updated profile.
	 */
	evict(id: string): void {
		const c = map.get(id);
		if (!c) return;
		c.dispose();
		map.delete(id);
	},

	/** Tear down everything. Called on vault lock and when wiping the vault. */
	disconnectAll(): void {
		for (const c of map.values()) {
			void c.logout();
			c.dispose();
		}
		map.clear();
	}
};

// Lock event → drop every live session.
$effect.root(() => {
	$effect(() => {
		if (vault.state !== 'open') connections.disconnectAll();
	});
});

// Profile delete → drop the orphaned Connection. Without this hook, removing
// a server from the vault leaves its Connection in the cache (slow leak —
// SSE stream stays open, refresh timer keeps firing) until the page reloads.
$effect.root(() => {
	$effect(() => {
		const activeIds = new Set(profiles.list.map((p) => p.id));
		for (const id of [...map.keys()]) {
			if (activeIds.has(id)) continue;
			const c = map.get(id);
			if (!c) continue;
			// Best-effort logout: the server-side jti revocation is courteous,
			// not load-bearing — connection is leaving the cache regardless.
			void c.logout().catch(() => {});
			c.dispose();
			map.delete(id);
		}
	});
});

export type { Connection };
