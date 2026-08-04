import type { Connection } from '$lib/stores/connections.svelte';

export type LiveTone = 'online' | 'connecting' | 'offline' | 'idle' | 'warning';

// Shared so the card badge and the summary pills that count by tone agree.
export function connectionTone(conn: Connection): LiveTone {
	if (!conn.isAuthenticated) {
		return conn.status === 'authenticating' ? 'connecting' : 'offline';
	}
	const s = conn.live.status;
	if (s === 'open') return 'online';
	if (s === 'connecting' || s === 'reconnecting') return 'connecting';
	// 'idle' (not yet acquired) or 'closed' (released) — authenticated and
	// reachable; stream starts when a component acquires it.
	return 'idle';
}
