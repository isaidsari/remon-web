import { Connection } from './connection.svelte';
import type { ServerProfile } from '$lib/types/profile';
import { vault } from '$lib/vault/store.svelte';
import { profiles } from './profiles.svelte';

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

	/** Drop without revoking: used when the credential is already invalid. */
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

// Without this, a deleted profile leaks its Connection (SSE + refresh timer).
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
